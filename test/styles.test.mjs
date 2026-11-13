import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { registerStyleRoutes } from "../server/routes/styles.mjs";
import { StyleLibrary } from "../server/styles.mjs";
import { builtInStyles } from "../shared/styles/catalog.mjs";
import { FlowClient } from "../client/index.mjs";
import { planWorkflow } from "../server/graph.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "flow-styles-"));
  const store = new Store(root);
  await store.init();
  const projects = new ProjectService(store);
  await projects.create({ id: "qa", name: "Style QA", root });
  const assetPath = (url) => {
    if (!url.startsWith("/files/") || url.includes(".."))
      throw new Error("Invalid image path.");
    return path.join(root, url.slice(7));
  };
  const services = { store, projects, assetPath };
  const app = express();
  app.use(express.json());
  app.post(
    "/api/uploads",
    multer({ dest: path.join(root, "uploads") }).array("images", 16),
    (req, res) => {
      res.json(
        req.files.map((file) => ({
          url: `/files/uploads/${file.filename}`,
          name: file.originalname,
        })),
      );
    },
  );
  registerStyleRoutes(app, services);
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    store,
    services,
    client: new FlowClient({
      url: `http://127.0.0.1:${server.address().port}`,
      projectId: "qa",
    }),
  };
}

test("style discovery, favorites and starting a saved project workflow preserve exact snapshots without inference", async (t) => {
  const { store, client, root } = await fixture(t);
  const catalog = await client.styles();
  assert.equal(catalog.total, builtInStyles.length);
  assert.equal(
    new Set(catalog.styles.map((style) => style.id)).size,
    builtInStyles.length,
  );
  assert.equal(catalog.searchMode, "browse");
  const cli = fileURLToPath(new URL("../cli/flow.mjs", import.meta.url));
  const execute = promisify(execFile);
  const cliCatalog = JSON.parse(
    (
      await execute(
        process.execPath,
        [cli, "styles", "--url", client.url, "--json"],
        { cwd: root },
      )
    ).stdout,
  );
  assert.equal(cliCatalog.total, builtInStyles.length);
  const style = catalog.styles[0];
  assert.ok(
    catalog.sourceCollections.some((source) => source.id === "adsoftheworld"),
  );
  const baselineWorkflow = await client.startStyle(style.id);
  const localWorkflow = await client.startStyle(style.id, {
    providerId: "local-color",
    model: "color-study",
  });
  const localGenerator = localWorkflow.nodes.find(
    (node) => node.type === "generate",
  );
  assert.equal(localGenerator.data.providerId, "local-color");
  assert.equal(localGenerator.data.model, "color-study");
  assert.equal(
    baselineWorkflow.nodes.find((node) => node.id === "prompt").data.text,
    style.scene,
  );
  await client.favoriteStyle(style.id, true);
  const cliWorkflow = JSON.parse(
    (
      await execute(
        process.execPath,
        [
          cli,
          "style",
          "start",
          style.id,
          "--subject",
          "A careful local CLI scene",
          "--url",
          client.url,
          "--json",
        ],
        { cwd: root },
      )
    ).stdout,
  );
  assert.equal(
    cliWorkflow.nodes.find((node) => node.id === "prompt").data.text,
    "A careful local CLI scene",
  );

  assert.deepEqual(
    (await client.styles({ favorites: true })).styles.map((entry) => entry.id),
    [style.id],
  );
  const shortFavoriteQuery = await client.request("/api/styles?favorites=1");
  assert.deepEqual(
    shortFavoriteQuery.styles.map((entry) => entry.id),
    [style.id],
  );
  const workflow = await client.startStyle(style.id, {
    subject: "Two friends plant a tree.",
  });
  assert.equal(workflow.projectId, "qa");
  const base = workflow.nodes.find((node) => node.id === "style");
  assert.equal(base.data.text, style.prompt);
  assert.deepEqual(base.data.style, {
    id: style.id,
    name: style.name,
    category: style.category,
    prompt: style.prompt,
    referenceUrls: [],
  });
  assert.equal(
    workflow.nodes.find((node) => node.id === "prompt").data.text,
    "Two friends plant a tree.",
  );
  const plan = planWorkflow(workflow);
  assert.equal(plan.imageJobs, 1);
  assert.equal(plan.textJobs, 0);
  assert.match(plan.jobs[0].prompt, /Two friends plant a tree/);
  assert.equal(store.runs.size, 0);
  assert.throws(
    () => client.startStyle(style.id, { projectId: "foreign" }),
    /must belong/,
  );
  await assert.rejects(
    client.style("missing-style"),
    (error) => error.status === 404,
  );
  await store.close();
  await store.init();
  assert.equal(store.styleLibraryState()[style.id].favorite, true);
  assert.equal(
    store.workflows.get(workflow.id).nodes[0].data.style.id,
    style.id,
  );
});

test("reference jobs expose progress and idempotent bindings validate actual completed image lineage", async (t) => {
  const { root, store, services, client } = await fixture(t);
  const [style, other] = builtInStyles;
  const runId = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";
  const jobId = "cccccccc-1111-2222-3333-dddddddddddd";
  const url = `/files/runs/${runId}/${jobId}/output.png`;
  const file = services.assetPath(url);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "fixture");
  const job = {
    id: jobId,
    status: "running",
    kind: "image",
    records: [
      { id: style.id, nodeId: "records", fields: { styleId: style.id } },
    ],
  };
  const run = {
    id: runId,
    projectId: "qa",
    status: "running",
    createdAt: new Date().toISOString(),
    jobs: [job],
  };
  await store.saveRun(run);
  assert.equal((await client.style(style.id)).referenceStatus, "running");
  assert.equal((await client.importStyleRun(runId)).imported, 0);
  job.status = "completed";
  job.prompt = "The exact image brief recorded for this reference.";
  job.records[0].fields.scene = "A small fishing boat rests in a foggy harbor.";
  job.output = url;
  run.status = "completed";
  await store.saveRun(run);
  assert.equal((await client.style(style.id)).references[0].url, url);
  assert.equal(
    (await client.style(style.id)).referenceScenes[url],
    job.records[0].fields.scene,
  );
  assert.equal(
    (await client.style(style.id)).referencePrompts[url],
    job.prompt,
  );
  await store.saveRun({
    id: "newer-reference-run",
    projectId: "qa",
    status: "running",
    createdAt: new Date(Date.now() + 1000).toISOString(),
    jobs: [
      {
        id: "newer-reference-job",
        kind: "image",
        status: "queued",
        records: job.records,
      },
    ],
  });
  const whileRegenerating = await client.style(style.id);
  assert.equal(
    whileRegenerating.references[0]?.url,
    url,
    "A new pending reference must not hide the previous completed image.",
  );
  assert.equal(
    whileRegenerating.references[0]?.runId,
    runId,
    "Reference provenance belongs to its completed run.",
  );
  assert.equal((await client.importStyleRun(runId)).imported, 1);
  assert.equal((await client.importStyleRun(runId)).imported, 0);
  const reference = (await client.style(style.id)).references[0];
  assert.deepEqual(
    (await client.styleReferences(other.id, [reference])).references[0],
    reference,
    "Explicit reference reuse preserves actual run/job provenance across styles.",
  );
  await assert.rejects(
    client.styleReferences(style.id, [{ ...reference, jobId: "missing" }]),
    /completed image run and job/,
  );
  await assert.rejects(
    client.styleReferences(style.id, [
      {
        url: "https://example.com/image.png",
        kind: "uploaded",
        label: "Remote",
      },
    ]),
    /local image uploader/,
  );
  const workflow = await client.startStyle(style.id);
  assert.equal(
    workflow.nodes.find((node) => node.id === "prompt").data.text,
    job.records[0].fields.scene,
  );
  assert.deepEqual(
    workflow.nodes.find((node) => node.id === "seed").data.images,
    [url],
  );
  assert.deepEqual(workflow.nodes[0].data.style.referenceUrls, [url]);
  const foreign = new FlowClient({ url: client.url, projectId: "foreign" });
  await assert.rejects(
    foreign.importStyleRun(runId),
    (error) => error.status === 409,
  );
  const library = new StyleLibrary({
    ...services,
    search: {
      status: () => ({ state: "ready" }),
      search: async () => ({ items: [{ ...job, runId, similarity: 0.89 }] }),
    },
  });
  const result = await library.list({
    search: "a synonym absent from catalog",
  });
  assert.equal(result.searchMode, "semantic");
  assert.equal(result.styles[0].id, style.id);
  assert.equal(result.styles[0].similarity, 0.89);
});

test("custom styles accept arbitrary local references, editable baselines and durable agent edits without changing workflow snapshots", async (t) => {
  const { store, services, client, root } = await fixture(t);
  const url = "/files/uploads/my-reference.png";
  await mkdir(path.dirname(services.assetPath(url)), { recursive: true });
  await writeFile(services.assetPath(url), "fixture");
  const input = {
    id: "my-editorial-style",
    name: "My editorial",
    category: "My collection",
    description: "Personal references",
    prompt: "Woodcut with rich black ink.",
    scene: "A boat on a quiet lake.",
    tags: ["personal", "woodcut"],
    references: [
      {
        url,
        label: "My image",
        kind: "uploaded",
        scene: "Two boats at dawn.",
        prompt: "An original visual study.",
        source: {
          url: "https://example.com/reference",
          creator: "My studio",
          license: "Original",
        },
      },
    ],
  };
  const style = await client.createStyle(input);
  assert.equal(style.custom, true);
  assert.equal(style.referenceScenes[url], "Two boats at dawn.");
  assert.equal(style.referencePrompts[url], "An original visual study.");
  assert.deepEqual(style.references[0].source, input.references[0].source);
  assert.equal((await client.styles()).total, builtInStyles.length + 1);
  assert.equal(
    (await client.styles({ category: input.category })).styles[0].id,
    input.id,
  );
  assert.ok(
    (await client.styles({ search: "Two boats" })).styles.some(
      (style) => style.id === input.id,
    ),
  );
  assert.ok(
    (await client.styles({ search: "quiet lake" })).styles.some(
      (style) => style.id === input.id,
    ),
  );
  const workflow = await client.startStyle(input.id);
  assert.equal(
    workflow.nodes.find((node) => node.id === "prompt").data.text,
    "Two boats at dawn.",
  );
  assert.deepEqual(
    workflow.nodes.find((node) => node.id === "seed").data.images,
    [url],
  );
  assert.equal(planWorkflow(workflow).imageJobs, 1);
  await client.favoriteStyle(input.id, true);
  const renamed = await client.updateStyle(input.id, {
    name: "Renamed editorial",
  });
  assert.equal(
    renamed.category,
    input.category,
    "Partial edits retain other definition fields.",
  );
  assert.equal(renamed.prompt, input.prompt);
  assert.equal(renamed.favorite, true);
  assert.equal(renamed.references.length, 1);
  await client.updateStyle(input.id, {
    prompt: "Soft graphite.",
    references: [],
  });
  assert.equal((await client.style(input.id)).references.length, 0);
  assert.equal(
    store.workflows.get(workflow.id).nodes[0].data.text,
    input.prompt,
  );
  assert.deepEqual(
    store.workflows.get(workflow.id).nodes[0].data.style.referenceUrls,
    [url],
  );
  await assert.rejects(
    client.createStyle(input),
    (error) => error.status === 409,
  );
  await assert.rejects(
    client.createStyle({ ...input, id: builtInStyles[0].id }),
    (error) => error.status === 409,
  );
  await assert.rejects(
    client.updateStyle(builtInStyles[0].id, { name: "Changed" }),
    /read-only/,
  );
  await assert.rejects(client.updateStyle(input.id, {}), /fields to update/);
  await assert.rejects(
    client.updateStyle(input.id, {
      references: [
        {
          url: "https://example.com/image.png",
          label: "remote",
          kind: "uploaded",
        },
      ],
    }),
    /local image uploader/,
  );
  await assert.rejects(
    client.updateStyle(input.id, {
      references: [
        { ...input.references[0], source: { url: "javascript:alert(1)" } },
      ],
    }),
    /source URL/,
  );
  await assert.rejects(
    client.updateStyle(input.id, {
      references: [
        { ...input.references[0], url: "/files/uploads/missing.png" },
      ],
    }),
  );
  assert.equal((await client.style(input.id)).prompt, "Soft graphite.");
  const file = path.join(root, "style.json");
  await writeFile(file, JSON.stringify({ ...input, id: "cli-custom" }));
  const cli = fileURLToPath(new URL("../cli/flow.mjs", import.meta.url));
  const execute = promisify(execFile);
  const created = JSON.parse(
    (
      await execute(
        process.execPath,
        [
          cli,
          "style",
          "create",
          "--from",
          file,
          "--seed-image",
          services.assetPath(url),
          "--url",
          client.url,
          "--json",
        ],
        { cwd: root },
      )
    ).stdout,
  );
  assert.equal(created.id, "cli-custom");
  assert.equal(created.references.length, 2);
  assert.equal(created.references[1].label, "my-reference.png");
  await writeFile(file, JSON.stringify({ scene: "A mountain campsite." }));
  const updated = JSON.parse(
    (
      await execute(
        process.execPath,
        [
          cli,
          "style",
          "update",
          created.id,
          "--from",
          file,
          "--url",
          client.url,
          "--json",
        ],
        { cwd: root },
      )
    ).stdout,
  );
  assert.equal(updated.scene, "A mountain campsite.");
  assert.equal(updated.prompt, input.prompt);
  await store.close();
  await store.init();
  const persisted = await client.style(input.id);
  assert.equal(persisted.custom, true);
  assert.equal(persisted.name, "Renamed editorial");
  assert.equal(persisted.favorite, true);
  assert.equal((await client.style(created.id)).references[0].url, url);
  assert.equal(store.runs.size, 0, "Library operations never start inference.");
});

test("custom entries can be image-free and explicitly removing references does not resurrect generated images", async (t) => {
  const { client, store, services } = await fixture(t);
  const style = await client.createStyle({ name: "Just a direction" });
  assert.match(style.id, /^custom-/);
  assert.equal(style.custom, true);
  assert.equal(style.category, "Custom");
  assert.deepEqual(style.references, []);
  assert.equal(planWorkflow(await client.startStyle(style.id)).imageJobs, 1);
  const runId = "custom-reference-run",
    jobId = "custom-reference-job";
  const url = `/files/runs/${runId}/${jobId}/output.png`;
  await mkdir(path.dirname(services.assetPath(url)), { recursive: true });
  await writeFile(services.assetPath(url), "fixture");
  await store.saveRun({
    id: runId,
    createdAt: new Date().toISOString(),
    projectId: "qa",
    status: "completed",
    jobs: [
      {
        id: jobId,
        status: "completed",
        output: url,
        prompt: "True recorded prompt",
        records: [{ fields: { styleId: style.id } }],
      },
    ],
  });
  const reference = {
    url,
    kind: "generated",
    label: "My generated reference",
    runId,
    jobId,
    prompt: "Contributor notes",
  };
  assert.equal(
    (await client.styleReferences(style.id, [reference])).referencePrompts[url],
    "True recorded prompt",
  );
  assert.equal(
    (await client.updateStyle(style.id, { references: [] })).references.length,
    0,
  );
  const outcomes = await Promise.allSettled([
    client.createStyle({ id: "race-style", name: "A" }),
    client.createStyle({ id: "race-style", name: "B" }),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.find((outcome) => outcome.status === "rejected").reason.status,
    409,
  );
});
