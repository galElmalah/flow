import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import express from "express";
import { Store } from "../server/store.mjs";
import { Assets } from "../server/assets.mjs";
import { Queue } from "../server/queue.mjs";
import { createImageWorkflow } from "../client/workflows.mjs";
import { registerAssetRoutes } from "../server/routes/assets.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function wait(store, id) {
  for (let i = 0; i < 500; i++) {
    const run = store.runs.get(id);
    if (["failed", "completed", "cancelled"].includes(run.status)) return run;
    await sleep(5);
  }
  assert.fail("queue did not finish");
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "flow-assets-"));
  let store = new Store(root);
  await store.init();
  for (const id of ["one", "two"])
    await store.saveProject({
      id,
      name: id,
      root: path.join(root, id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  const resolveAsset = (url) => path.join(root, url.replace("/files/", ""));
  let assets = new Assets({ store, resolveAsset });
  const png = await sharp({
    create: { width: 12, height: 8, channels: 4, background: "#bbaadd" },
  })
    .png()
    .toBuffer();
  const upload = "/files/uploads/seed.png";
  await writeFile(resolveAsset(upload), png);
  const makeQueue = (adapter) =>
    new Queue(store, {
      assets,
      resolveAsset,
      adapter:
        adapter ||
        (async ({ job, directory }) => {
          if (job.kind === "text")
            return {
              kind: "text",
              text: "An expanded scene brief",
              metadata: { providerId: "codex-text", seedMode: "unsupported" },
            };
          await writeFile(path.join(directory, "output.png"), png);
          await copyFile(
            path.join(directory, "output.png"),
            path.join(directory, "original-attempt-1.png"),
          );
          return {
            kind: "image",
            metadata: {
              providerId: job.providerId,
              originalFile: "original-attempt-1.png",
              seedMode: "variation-label",
            },
          };
        }),
    });
  const queue = makeQueue();
  t.after(async () => {
    await queue.stop();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    png,
    upload,
    resolveAsset,
    get store() {
      return store;
    },
    get assets() {
      return assets;
    },
    queue,
    makeQueue,
    async reload() {
      await queue.stop();
      await store.close();
      store = new Store(root);
      await store.init();
      assets = new Assets({ store, resolveAsset });
    },
  };
}

test("assets freeze cross-run inputs and output hashes, keep raw transformations and annotation revisions across restart", async (t) => {
  const f = await fixture(t);
  const upload = await f.assets.captureUpload({
    url: f.upload,
    name: "my seed.png",
    projectId: "one",
  });
  assert.equal(upload.fingerprint.sha256, digest(f.png));
  const graph = createImageWorkflow({
    projectId: "one",
    prompt: "First scene",
    images: [f.upload],
    providerId: "codex",
    count: 1,
  });
  const first = await f.queue.create(graph);
  await wait(f.store, first.id);
  assert.equal(first.status, "completed", JSON.stringify(first.jobs));
  const output = first.jobs[0];
  assert.ok(output.assetId);
  assert.equal(output.lineage.inputs[0].assetId, upload.id);
  assert.equal(output.lineage.output.fingerprint.sha256, digest(f.png));
  const second = await f.queue.create(
    createImageWorkflow({
      projectId: "one",
      prompt: "Second scene",
      images: [output.output],
      providerId: "codex",
    }),
  );
  await wait(f.store, second.id);
  assert.equal(second.status, "completed", JSON.stringify(second.jobs));
  const child = second.jobs[0],
    lineage = f.assets.lineage(child.assetId, "one");
  assert.ok(lineage.ancestors.some((asset) => asset.id === output.assetId));
  assert.ok(lineage.ancestors.some((asset) => asset.id === upload.id));
  assert.equal(lineage.asset.provenance.prompt, "Second scene");
  assert.equal(lineage.asset.generation.runId, second.id);
  const originalSource = lineage.ancestors.find(
    (asset) => asset.id === output.assetId,
  );
  assert.equal(originalSource.provenance.prompt, "First scene");
  assert.equal(originalSource.generation.runId, first.id);
  const copiedInput = lineage.ancestors.find(
    (asset) => asset.origin.type === "job-input",
  );
  assert.ok(copiedInput);
  assert.equal(
    copiedInput.generation,
    undefined,
    "An input snapshot was copied, not generated by its consumer",
  );
  assert.equal(
    lineage.ancestors.find((asset) => asset.id === upload.id).generation,
    undefined,
  );
  assert.ok(
    lineage.ancestors.some(
      (asset) => asset.origin.role === "provider-original",
    ),
  );
  assert.equal(lineage.asset.provenance.effective.model, null);
  assert.equal(lineage.asset.provenance.effective.seed.effective, null);
  assert.equal(
    lineage.asset.provenance.effective.seed.semantics,
    "variation-label",
  );
  const immutableAsset = JSON.stringify(f.store.assetRecord(child.assetId));
  const immutableRun = JSON.stringify(second);
  const edited = f.assets.annotate(
    child.assetId,
    {
      revision: 0,
      caption: "A cyclist",
      decision: "accepted",
      training: { allowed: true, rights: "confirmed" },
    },
    "one",
  );
  assert.equal(edited.annotations.revision, 1);
  assert.equal(
    JSON.stringify(f.store.assetRecord(child.assetId)),
    immutableAsset,
  );
  assert.equal(JSON.stringify(second), immutableRun);
  assert.throws(
    () =>
      f.assets.annotate(
        child.assetId,
        { revision: 0, caption: "stale" },
        "one",
      ),
    { status: 409 },
  );
  assert.throws(() => f.assets.get(child.assetId, "two"), { status: 404 });
  const training = await f.assets.dataset({
    projectId: "one",
    mode: "training",
  });
  assert.deepEqual(
    training.rows.map((row) => row.asset.id),
    [child.assetId],
  );
  assert.ok(
    training.skipped.some((row) =>
      row.reasons.includes("training-not-allowed"),
    ),
  );
  assert.ok(
    (await f.assets.dataset({ projectId: "one", mode: "all" })).rows.length >
      training.rows.length,
  );
  await f.reload();
  assert.equal(
    f.assets.get(child.assetId, "one").annotations.caption,
    "A cyclist",
  );
  assert.ok(
    f.assets
      .lineage(child.assetId, "one")
      .ancestors.some((asset) => asset.id === output.assetId),
  );
});

test("captured input mutation blocks resume before provider dispatch", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const queue = f.makeQueue(async () => {
    calls++;
    throw new Error("Fixture provider failed after capture");
  });
  t.after(() => queue.stop());
  const run = await queue.create(
    createImageWorkflow({
      projectId: "one",
      prompt: "Exact source",
      images: [f.upload],
    }),
  );
  await wait(f.store, run.id);
  assert.equal(calls, 1);
  assert.ok(run.jobs[0].lineage);
  await writeFile(f.resolveAsset(f.upload), Buffer.from("changed source"));
  queue.action(run.id, "retry");
  await wait(f.store, run.id);
  assert.equal(calls, 1);
  assert.match(run.jobs[0].error, /bytes changed/);
});

test("historical assets are explicitly partial and dataset HTTP exports scoped JSONL without auto approval", async (t) => {
  const f = await fixture(t),
    runId = randomUUID(),
    jobId = randomUUID();
  await mkdir(path.join(f.root, "runs", runId, jobId), { recursive: true });
  await writeFile(path.join(f.root, "runs", runId, jobId, "output.png"), f.png);
  const url = `/files/runs/${runId}/${jobId}/output.png`;
  await f.store.saveRun({
    id: runId,
    workflowId: "old-workflow",
    projectId: "one",
    createdAt: new Date().toISOString(),
    status: "completed",
    graph: { nodes: [], edges: [] },
    jobs: [
      {
        id: jobId,
        nodeId: "old",
        kind: "image",
        status: "completed",
        output: url,
        prompt: "Historical prompt",
        images: [],
        dependencies: [],
      },
    ],
  });
  const [old] = await f.assets.list({ projectId: "one", url });
  assert.equal(old.provenance.completeness, "historical-partial");
  assert.equal(old.fingerprint.evidence, "historical-observation");
  assert.equal(old.annotations.training.allowed, false);
  const app = express();
  app.use(express.json());
  registerAssetRoutes(app, { assets: f.assets });
  app.use((err, req, res, next) =>
    res.status(err.status || 400).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(
    `${base}/api/assets/dataset?projectId=one&workflowId=old-workflow`,
  );
  assert.equal(response.status, 200);
  const rows = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].eligibility.reasons.includes("historical-partial"));
  assert.deepEqual(
    await (await fetch(`${base}/api/assets?projectId=unassigned`)).json(),
    [],
  );
  assert.equal(
    (await fetch(`${base}/api/assets/${old.id}?projectId=two`)).status,
    404,
  );
  assert.equal(
    (
      await fetch(`${base}/api/assets/${old.id}/annotations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "one",
          revision: 0,
          tags: ["keeper"],
        }),
      })
    ).status,
    200,
  );
  const training = await fetch(
    `${base}/api/assets/dataset?projectId=one&mode=training`,
  );
  assert.equal(await training.text(), "");
  assert.equal(training.headers.get("X-Flow-Dataset-Skipped"), "1");
});

test("generated prompt assets and provider-operation receipts survive restart with original lineage", async (t) => {
  const f = await fixture(t);
  const graph = createImageWorkflow({
    projectId: "one",
    prompt: "Shared direction",
    records: [{ id: "row", fields: { scene: "cycling" } }],
    template: "{{scene}}",
    promptProviderId: "codex-text",
  });
  const run = await f.queue.create(graph);
  await wait(f.store, run.id);
  assert.equal(run.status, "completed", JSON.stringify(run.jobs));
  const text = run.jobs.find((job) => job.kind === "text"),
    image = run.jobs.find((job) => job.kind === "image");
  assert.ok(text.assetId);
  assert.ok(
    image.lineage.inputs.some(
      (input) =>
        input.assetId === text.assetId && input.role === "generated-prompt",
    ),
  );
  image.videoOperation = {
    state: "accepted",
    interactionId: "old-operation",
    requestHash: "a".repeat(64),
  };
  await f.store.saveRun(run);
  await f.reload();
  const saved = f.store.runs
    .get(run.id)
    .jobs.find((job) => job.id === image.id);
  assert.equal(saved.videoOperation, undefined);
  assert.equal(saved.providerOperation.id, "old-operation");
  assert.equal(saved.providerOperation.providerId, "codex");
  assert.equal(saved.status, "completed");
  const lineage = f.assets.lineage(saved.assetId, "one");
  const generatedPrompt = lineage.ancestors.find(
    (asset) => asset.id === text.assetId,
  );
  assert.equal(
    generatedPrompt.generation.resultText,
    "An expanded scene brief",
  );
  assert.equal(generatedPrompt.generation.instructions, text.instructions);
  assert.equal(generatedPrompt.provenance.prompt, text.prompt);
});

test("provider sees immutable per-job image snapshots and comparison values remain attached to every asset", async (t) => {
  const f = await fixture(t),
    seen = [];
  const queue = f.makeQueue(async ({ job, directory, imagePaths }) => {
    seen.push({
      job,
      file: imagePaths[0],
      bytes: await readFile(imagePaths[0]),
    });
    assert.notEqual(imagePaths[0], f.resolveAsset(f.upload));
    await writeFile(path.join(directory, "output.png"), f.png);
    return {
      kind: "image",
      metadata: {
        providerId: job.providerId,
        actualModel: job.model,
        seedMode:
          job.providerId === "grok-image" ? "unsupported" : "variation-label",
        effectiveSettings: { quality: job.quality },
      },
    };
  });
  t.after(() => queue.stop());
  const graph = createImageWorkflow({
    projectId: "one",
    prompt: "Matched scene",
    images: [f.upload],
    modes: [
      { id: "codex", label: "Codex", providerId: "codex", count: 2 },
      {
        id: "grok",
        label: "Grok",
        providerId: "grok-image",
        model: "fixture-image",
        count: 2,
      },
    ],
  });
  const run = await queue.create(graph);
  await wait(f.store, run.id);
  assert.equal(run.status, "completed", JSON.stringify(run.jobs));
  assert.equal(seen.length, 4);
  assert.equal(new Set(seen.map((item) => item.file)).size, 4);
  for (const { job, bytes } of seen) {
    assert.equal(digest(bytes), job.lineage.inputs[0].fingerprint.sha256);
    const asset = f.assets.get(job.assetId, "one");
    assert.equal(asset.provenance.mode.id, job.mode.id);
    assert.deepEqual(asset.provenance.comparison, job.comparison);
    assert.equal(asset.provenance.requested.providerId, job.providerId);
    assert.equal(asset.provenance.effective.seed.sent, null);
    const snapshot = f.assets
      .lineage(asset.id, "one")
      .ancestors.find((parent) => parent.origin.type === "job-input");
    assert.equal(snapshot.fingerprint.sha256, digest(bytes));
    assert.equal(
      (await readFile(f.assets.file(snapshot.url))).length,
      bytes.length,
    );
  }
});

test("lineage includes only this job’s connected scene and style configuration", async (t) => {
  const f = await fixture(t);
  const graph = createImageWorkflow({
    projectId: "one",
    prompt: "Quote branch scene",
    images: [f.upload],
    count: 2,
  });
  const direction = graph.nodes.find((node) => node.type === "prompt");
  // Existing persisted nodes can carry full applied style snapshots; this test exercises the provenance reader directly.
  direction.data.style = { id: "quote-engraving", name: "Quote engraving" };
  graph.nodes.push({
    id: "cover-scene",
    type: "prompt",
    position: { x: 100, y: 500 },
    data: {
      label: "Unrelated cover",
      text: "Cover should never appear in quote lineage",
      style: { id: "cover-photography", name: "Cover photography" },
    },
  });
  const job = {
    id: randomUUID(),
    nodeId: "generate",
    providerId: "codex",
    kind: "image",
    prompt: "Actual resolved quote scene",
    rules: [],
    records: [],
    seed: 42,
    ratio: "1:1",
    quality: "high",
    mode: { id: "first", count: 2 },
  };
  const provenance = f.assets.provenance(
    { id: randomUUID(), projectId: "one", graph },
    job,
  );
  assert.deepEqual(
    provenance.styles.map((style) => style.id),
    ["quote-engraving"],
  );
  assert.deepEqual(
    provenance.sources.map((source) => source.nodeId),
    [direction.id],
  );
  assert.equal(provenance.sources[0].semantics, "node-configuration");
  assert.equal(provenance.prompt, "Actual resolved quote scene");
  assert.equal(provenance.requested.copiesInMode, 2);
  assert.equal(provenance.requested.outputCount, 1);
});

test("a gallery lookup during final hashing cannot register a new generation as historical", async (t) => {
  const f = await fixture(t),
    complete = f.assets.complete.bind(f.assets);
  let checked = false;
  f.assets.complete = async (run, job, directory) => {
    assert.equal(job.status, "running");
    const observed = await f.assets.list({
      projectId: "one",
      runId: run.id,
      jobId: job.id,
    });
    assert.ok(!observed.some((asset) => asset.origin.role === "final"));
    checked = true;
    return complete(run, job, directory);
  };
  const run = await f.queue.create(
    createImageWorkflow({
      projectId: "one",
      prompt: "Hash before publish",
      images: [f.upload],
    }),
  );
  await wait(f.store, run.id);
  assert.equal(run.status, "completed", JSON.stringify(run.jobs));
  assert.ok(checked);
  assert.equal(
    f.assets.get(run.jobs[0].assetId, "one").provenance.completeness,
    "captured",
  );
});
