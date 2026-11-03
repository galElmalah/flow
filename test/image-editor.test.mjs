import { viewerParams } from "../shared/viewer-routes.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import sharp from "sharp";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { ImageEditors } from "../server/image-editor/service.mjs";
import { registerProjectRoutes } from "../server/routes/projects.mjs";
import { registerImageEditorRoutes } from "../server/routes/image-editors.mjs";
import { FlowClient } from "../client/index.mjs";
import {
  toggleRegion,
  editBrief,
  editTargets,
} from "../shared/image-editor.mjs";
import { validateGraph } from "../shared/graph.mjs";
import { Queue } from "../server/queue.mjs";
import { galleryItems } from "../server/search/documents.mjs";

test("SAM editor API preserves originals, scopes ownership, serializes segmentation and prepares replayable masked edit workflows", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "flow-editor-"));
  const dataRoot = path.join(temporaryRoot, ".flow");
  const store = new Store(dataRoot);
  await store.init();
  const projects = new ProjectService(store);
  for (const id of ["quotes", "other"]) {
    await mkdir(path.join(dataRoot, id));
    await projects.create({ id, name: id, root: path.join(dataRoot, id) });
  }
  const original = await sharp({
    create: { width: 16, height: 12, channels: 3, background: "#333" },
  })
    .png()
    .toBuffer();
  const input = path.join(dataRoot, "uploads", "source.png");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(input, original);
  let calls = 0;
  const observedProgress = [];
  const model = {
    variant: "sam2-fixture",
    status: async () => ({ ready: true, model: model.variant }),
    async run({ directory, point, onProgress }) {
      calls++;
      for (const event of [
        { stage: "encoding", message: "Encoding image" },
        {
          stage: "sampling",
          message: "Finding objects",
          completed: 3,
          total: 25,
        },
      ]) {
        onProgress?.(event);
        observedProgress.push(editors.list()[0].segmentation.progress);
      }
      await mkdir(directory, { recursive: true });
      const id = "region-" + randomUUID();
      const mask = Buffer.alloc(16 * 12);
      for (let y = 2; y < 10; y++)
        for (let x = 3; x < 9; x++) mask[y * 16 + x] = 255;
      await sharp(mask, { raw: { width: 16, height: 12, channels: 1 } })
        .png()
        .toFile(path.join(directory, id + ".png"));
      return {
        model: model.variant,
        device: "fixture",
        width: 16,
        height: 12,
        regions: [
          {
            id,
            file: id + ".png",
            path: "M3 2L9 2L9 10L3 10Z",
            bbox: [3, 2, 6, 8],
            area: 48,
            score: 0.99,
          },
        ],
      };
    },
  };
  const assetPath = (url) => {
    if (
      ["/files/uploads/source.png", "/files/uploads/legacy.png"].includes(url)
    )
      return input;
    if (/^\/files\/editors\/[a-f0-9]{32}\/[a-zA-Z0-9-]+\.png$/.test(url))
      return path.join(dataRoot, url.slice(7));
    throw new Error("Upload local images first");
  };
  let preflightError = "Not authenticated",
    preflights = 0;
  const providers = {
    async preflight(jobs) {
      preflights++;
      assert.equal(jobs[0].images.length, 3);
      if (preflightError) throw new Error(preflightError);
    },
  };
  const queue = new Queue(store, {
    resolveAsset: assetPath,
    adapter: async ({ directory }) => {
      await writeFile(path.join(directory, "output.png"), original);
    },
  });
  const editors = new ImageEditors({
    store,
    projects,
    assetPath,
    dataRoot,
    model,
    queue,
    providers,
  });
  const app = express();
  app.use(express.json());
  registerImageEditorRoutes(app, { editors });
  registerProjectRoutes(app, { projects });
  app.use((err, req, res, next) =>
    res.status(err.status || 400).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = new FlowClient({ url, projectId: "quotes" }),
    foreign = new FlowClient({ url, projectId: "other" });
  t.after(async () => {
    await editors.close();
    await queue.stop();
    await new Promise((r) => server.close(r));
    await store.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  const editor = await client.openImageEditor({
    source: "/files/uploads/source.png",
  });
  assert.equal(editor.source.projectId, "quotes");
  assert.equal(
    (await client.openImageEditor({ source: editor.source.url })).id,
    editor.id,
  );
  await assert.rejects(foreign.imageEditor(editor.id), /ownership/);
  assert.equal((await foreign.imageEditors()).length, 0);
  await assert.rejects(
    client.openImageEditor({ source: "https://bad.example/image.png" }),
    /local images/,
  );
  await assert.rejects(
    client.openImageEditor({
      source: editor.source.url,
      runId: "wrong",
      jobId: "wrong",
    }),
    /does not match/,
  );
  await Promise.all([
    client.segmentImage(editor.id),
    client.segmentImage(editor.id),
  ]);
  await editors.pending;
  let doc = await client.imageEditor(editor.id);
  assert.equal(observedProgress[1].completed, 3);
  assert.equal(observedProgress[1].total, 25);
  assert.equal(doc.segmentation.progress.stage, "ready");
  assert.ok(doc.segmentation.startedAt);
  assert.equal(calls, 1);
  assert.equal(doc.regions.length, 1);
  const region = doc.regions[0];
  doc = await client.patchImageEditor(editor.id, {
    revision: doc.revision,
    layer: { id: region.id, label: "Olive branch" },
  });
  await assert.rejects(
    client.patchImageEditor(editor.id, {
      revision: 0,
      layer: { id: region.id, label: "Lost update" },
    }),
    /changed elsewhere/,
  );
  doc = await client.patchImageEditor(editor.id, {
    revision: doc.revision,
    comment: {
      regionIds: [region.id],
      text: "Make this branch silver; preserve the vase.",
      anchor: { x: 0.4, y: 0.6 },
    },
  });
  doc = await client.patchImageEditor(editor.id, {
    revision: doc.revision,
    layer: { id: region.id, locked: true },
  });
  await assert.rejects(
    client.prepareImageEdit(editor.id, {
      mode: "region",
      revision: doc.revision,
      regionIds: [region.id],
    }),
    /Unlock/,
  );
  doc = await client.patchImageEditor(editor.id, {
    revision: doc.revision,
    layer: { id: region.id, locked: false },
  });
  await assert.rejects(
    client.patchImageEditor(editor.id, {
      revision: doc.revision,
      order: [region.id, region.id],
    }),
    /exactly once/,
  );
  await assert.rejects(
    client.patchImageEditor(editor.id, {
      revision: doc.revision,
      comment: { regionIds: ["missing"], text: "Bad region" },
    }),
    /not found/,
  );
  const attempts = await Promise.allSettled([
    client.prepareImageEdit(editor.id, {
      mode: "region",
      revision: doc.revision,
      regionIds: [region.id],
      providerId: "codex",
      count: 4,
    }),
    client.prepareImageEdit(editor.id, {
      mode: "region",
      revision: doc.revision,
      regionIds: [region.id],
    }),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const prepared = attempts.find((r) => r.status === "fulfilled").value;
  assert.match(prepared.request.prompt, /branch silver/);
  assert.equal(prepared.request.strictInpainting, false);
  assert.deepEqual(prepared.request.comments[0].anchor, { x: 0.4, y: 0.6 });
  assert.match(prepared.request.prompt, /40%, 60%/);
  assert.equal(store.runs.size, 0, "preparation never starts inference");
  const waiting = await client.imageVariations(editor.id);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].status, "prepared");
  assert.equal(
    waiting[0].count,
    prepared.workflow.nodes.find((n) => n.type === "generate").data.count,
  );
  assert.equal(waiting[0].projectId, "quotes");
  assert.deepEqual(waiting[0].comments[0].anchor, { x: 0.4, y: 0.6 });
  await assert.rejects(foreign.imageVariations(editor.id), /ownership/);
  assert.equal(
    store.workflows.size,
    1,
    "a conflicting request cannot create a duplicate workflow",
  );
  const graph = validateGraph(prepared.workflow).graph;
  assert.equal(graph.projectId, "quotes");
  assert.equal(
    graph.nodes.find((n) => n.type === "generate").data.edit.editorId,
    editor.id,
  );
  assert.equal(
    graph.nodes.find((n) => n.type === "image").data.images.length,
    3,
  );
  const maskPath = await editors.file(
    editor.id,
    path.basename(prepared.request.mask),
  );
  const { data } = await sharp(maskPath)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(data[0], 0);
  assert.equal(data[5 * 16 + 5], 255);
  const cutout = await sharp(
    await editors.file(editor.id, path.basename(prepared.request.cutout)),
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(cutout[3], 0);
  assert.equal(cutout[(5 * 16 + 5) * 4 + 3], 255);
  assert.deepEqual(await readFile(input), original);
  await assert.rejects(
    editors.file(editor.id, "../../private.json"),
    /not found/,
  );
  assert.equal((await fetch(url + prepared.request.mask)).status, 200);
  const viewer = await client.viewer({ editorId: editor.id });
  assert.equal(new URL(viewer.url).search, "");
  assert.match(new URL(viewer.url).pathname, /^\/project\/quotes\/editor\//);
  assert.equal(viewerParams(new URL(viewer.url)).get("editor"), editor.id);
  model.variant = "sam2-detailed-fixture";
  await client.segmentImage(editor.id);
  await editors.pending;
  const upgraded = await client.imageEditor(editor.id);
  assert.equal(upgraded.regions.length, 2);
  assert.equal(
    upgraded.regions.find((r) => r.id === region.id).label,
    "Olive branch",
  );
  assert.equal(upgraded.comments[0].id, doc.comments[0].id);
  assert.equal(upgraded.segmentation.autoModel, "sam2-detailed-fixture");
  const callsAfterUpgrade = calls;
  await client.segmentImage(editor.id);
  await editors.pending;
  assert.equal(
    calls,
    callsAfterUpgrade,
    "same-checkpoint automatic masks are cached",
  );
  await client.segmentImage(editor.id, { point: { x: 0.3, y: 0.5 } });
  await editors.pending;
  assert.equal((await client.imageEditor(editor.id)).regions.length, 3);
  await client.segmentImage(editor.id);
  await editors.pending;
  assert.equal(
    calls,
    callsAfterUpgrade + 1,
    "point prompts do not invalidate automatic masks",
  );
  await store.saveRun({
    id: "legacy-run",
    workflowId: "legacy-workflow",
    status: "completed",
    createdAt: new Date().toISOString(),
    jobs: [
      {
        id: "legacy-job",
        kind: "image",
        status: "completed",
        output: "/files/uploads/legacy.png",
      },
    ],
  });
  const legacy = await client.openImageEditor({
    source: "/files/uploads/legacy.png",
    runId: "legacy-run",
    jobId: "legacy-job",
  });
  assert.equal(
    legacy.projectId,
    "quotes",
    "new editors can belong to the active project without rewriting historical ownership",
  );
  assert.equal(legacy.source.projectId, undefined);
  assert.equal(store.runs.get("legacy-run").projectId, undefined);
  await assert.rejects(foreign.imageEditor(legacy.id), /ownership/);
  await client.segmentImage(legacy.id);
  await editors.pending;
  const legacyReady = await client.imageEditor(legacy.id);
  const legacyEdit = await client.prepareImageEdit(legacy.id, {
    revision: legacyReady.revision,
    regionIds: [legacyReady.regions[0].id],
    instructions: "Warmer light",
  });
  assert.equal(legacyEdit.workflow.projectId, "quotes");
  assert.equal(
    (await client.viewer({ editorId: legacy.id })).projectId,
    "quotes",
  );
  assert.equal(
    store.runs.size,
    1,
    "preparing a legacy-image edit never starts inference",
  );
  await assert.rejects(
    foreign.sendImageEdit(editor.id, prepared.request.id),
    /ownership/,
  );
  await writeFile(input, Buffer.from("changed source"));
  await assert.rejects(
    client.sendImageEdit(editor.id, prepared.request.id),
    /source file changed/,
  );
  await writeFile(input, original);
  await assert.rejects(
    client.sendImageEdit(editor.id, prepared.request.id),
    /Not authenticated/,
  );
  assert.equal(
    store.runs.size,
    1,
    "preflight failure never schedules generation",
  );
  preflightError = null;
  await store.saveWorkflow({
    ...prepared.workflow,
    name: "Edited later, not the prepared request",
  });
  const sent = await Promise.all([
    client.sendImageEdit(editor.id, prepared.request.id),
    client.sendImageEdit(editor.id, prepared.request.id),
  ]);
  assert.equal(sent[0].run.id, sent[1].run.id);
  assert.equal(
    preflights,
    2,
    "one failed preflight and one successful dispatch despite duplicate callers",
  );
  assert.equal(store.runs.size, 2);
  assert.equal(
    sent[0].run.name,
    prepared.workflow.name,
    "dispatch runs the immutable prepared snapshot",
  );
  assert.deepEqual(sent[0].request.comments[0].anchor, { x: 0.4, y: 0.6 });
  for (
    let i = 0;
    i < 100 && store.runs.get(sent[0].run.id).status !== "completed";
    i++
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.runs.get(sent[0].run.id).status, "completed");
  const variations = await client.imageVariations(editor.id);
  assert.equal(variations[0].runId, sent[0].run.id);
  assert.equal(variations[0].status, "completed");
  assert.equal(variations[0].jobs.length, waiting[0].count);
  for (const job of variations[0].jobs) {
    assert.ok(job.output);
    assert.equal(job.projectId, "quotes");
    assert.equal(job.edit.source, editor.source.url);
    assert.equal(job.edit.editorId, editor.id);
    assert.equal(job.edit.requestId, prepared.request.id);
    assert.deepEqual(job.edit.regionIds, [region.id]);
  }
  assert.equal(
    (await client.sendImageEdit(editor.id, prepared.request.id)).run.id,
    sent[0].run.id,
    "completed requests are also idempotent",
  );
  assert.deepEqual(await readFile(input), original);
  await store.flush();
  const restartedStore = new Store(dataRoot);
  await restartedStore.init();
  const restored = new ImageEditors({
    store: restartedStore,
    projects: new ProjectService(restartedStore),
    assetPath,
    dataRoot,
    model,
  });
  assert.equal(restored.get(editor.id).comments[0].text, doc.comments[0].text);
  assert.equal(restored.get(editor.id).requests[0].mask, prepared.request.mask);
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored.variations(editor.id, "quotes"))),
    variations,
  );
  assert.equal(
    (await restored.send(editor.id, prepared.request.id, "quotes")).run.id,
    sent[0].run.id,
    "restart cannot dispatch a second run",
  );
  await restored.close();
  await restartedStore.close();
});

test("region selection and edit briefs preserve explicit multi-selection and resolved comment semantics", () => {
  assert.deepEqual(toggleRegion([], "a"), ["a"]);
  assert.deepEqual(toggleRegion(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(toggleRegion(["a", "b"], "a", true), ["b"]);
  assert.deepEqual(toggleRegion(["a", "b"], null), []);
  const editor = {
    regions: [
      { id: "a", label: "Face" },
      { id: "b", label: "Backdrop" },
    ],
    comments: [
      { regionIds: ["a"], text: "Different person", resolved: false },
      { regionIds: ["b"], text: "Do not include this", resolved: false },
      { regionIds: ["a"], text: "Resolved idea", resolved: true },
    ],
  };
  const brief = editBrief(editor, {
    mode: "region",
    regionIds: ["a"],
    instructions: "Keep the pose.",
  });
  assert.match(brief, /Different person/);
  assert.doesNotMatch(brief, /Resolved idea|Do not include/);
  assert.deepEqual(
    editTargets(editor, [], { text: "New instruction", regionIds: ["b"] }),
    ["a", "b"],
  );
  assert.deepEqual(
    editTargets(
      { ...editor, comments: editor.comments.filter((c) => c.resolved) },
      ["b"],
      { text: "  ", regionIds: ["a"] },
    ),
    ["b"],
  );
  assert.throws(
    () =>
      editBrief(
        { ...editor, comments: [] },
        { mode: "region", regionIds: ["a"], instructions: "" },
      ),
    /Add instructions/,
  );
});

test("historical edit outputs recover original-image lineage from their recorded graph", () => {
  const edit = {
    editorId: "old-editor",
    requestId: "old-request",
    source: "/files/uploads/original.png",
  };
  const run = {
    id: "old-run",
    projectId: "quotes",
    graph: { nodes: [{ id: "image-edit", data: { edit } }] },
    jobs: [
      {
        id: "image",
        nodeId: "image-edit",
        status: "completed",
        output: "/files/runs/old-run/image/output.png",
      },
      { id: "pending", nodeId: "image-edit", status: "running" },
    ],
  };
  const images = galleryItems([run]);
  assert.equal(images.length, 1);
  assert.deepEqual(images[0].edit, edit);
  assert.equal(images[0].projectId, "quotes");
  assert.equal(
    run.jobs[0].edit,
    undefined,
    "historical jobs are never rewritten",
  );
});
