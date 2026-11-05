import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import {
  finalizeImage,
  verifyStaticSvg,
} from "../harness-integrations/shared/image-output.mjs";
import { imageSettingsSchema } from "../shared/generation-modes.mjs";
import { createImageWorkflow } from "../client/workflows.mjs";
import { prepareWorkflow } from "../cli/workflow-input.mjs";
import { planWorkflow } from "../server/graph.mjs";
import { mediaArtifact } from "../shared/media.mjs";
import { Store } from "../server/store.mjs";
import { Queue } from "../server/queue.mjs";
import { Assets } from "../server/assets.mjs";
import express from "express";
import { registerRunRoutes } from "../server/routes/runs.mjs";

const root = path.resolve(import.meta.dirname, "..");
async function directory(t) {
  const value = await mkdtemp(path.join(tmpdir(), "flow-image-output-"));
  t.after(() => rm(value, { recursive: true, force: true }));
  return value;
}
async function sheet() {
  return sharp({
    create: { width: 48, height: 32, channels: 4, background: "red" },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 24, height: 16, channels: 4, background: "blue" },
        })
          .png()
          .toBuffer(),
        left: 24,
        top: 0,
      },
      {
        input: await sharp({
          create: { width: 24, height: 16, channels: 4, background: "green" },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 16,
      },
      {
        input: await sharp({
          create: { width: 24, height: 16, channels: 4, background: "yellow" },
        })
          .png()
          .toBuffer(),
        left: 24,
        top: 16,
      },
    ])
    .png()
    .toBuffer();
}
const image = { outputFormat: "gif", frameCount: 4, frameDurationMs: 250 };

test("sprite assembly preserves frame order, delays, original sheet and animation bytes", async (t) => {
  const dir = await directory(t),
    source = path.join(dir, "sheet.png");
  await writeFile(source, await sheet());
  const result = await finalizeImage(
    source,
    dir,
    { image },
    { spriteSheet: true },
  );
  const meta = await sharp(result.path, { animated: true }).metadata();
  assert.equal(meta.pages, 4);
  assert.equal(meta.pageHeight, 16);
  assert.equal(meta.width, 24);
  assert.deepEqual(meta.delay, [250, 250, 250, 250]);
  assert.equal(meta.loop, 0);
  assert.equal(result.metadata.durationMs, 1000);
  assert.equal(result.metadata.animationMethod, "sprite-sheet");
  assert.deepEqual(result.metadata.spriteSheet, {
    width: 48,
    height: 32,
    columns: 2,
    rows: 2,
  });
  const { data } = await sharp(result.path, { animated: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const firstPixels = [0, 1, 2, 3].map((i) => [
    ...data.subarray(i * 24 * 16 * 3, i * 24 * 16 * 3 + 3),
  ]);
  assert.deepEqual(firstPixels, [
    [255, 0, 0],
    [0, 0, 255],
    [0, 128, 0],
    [255, 255, 0],
  ]);
  assert.deepEqual(
    await readFile(path.join(dir, result.metadata.originalFile)),
    await sheet(),
  );
  const bad = path.join(dir, "bad.png");
  await writeFile(
    bad,
    await sharp({
      create: { width: 49, height: 33, channels: 3, background: "red" },
    })
      .png()
      .toBuffer(),
  );
  await assert.rejects(
    finalizeImage(bad, dir, { image }, { spriteSheet: true }),
    /equal columns/,
  );
});

test("format schema and provider preflight reject unsupported output, API references and Codex-only control claims", async (t) => {
  for (const settings of [
    { frameCount: 4 },
    { outputFormat: "gif", frameCount: 17 },
    { outputFormat: "gif", frameDurationMs: 25 },
    { outputFormat: "gif", background: "transparent" },
  ])
    assert.equal(imageSettingsSchema.safeParse(settings).success, false);
  const registry = new ProviderRegistry({
    root,
    dataRoot: await directory(t),
    codexHealth: async () => ({ ready: true }),
  });
  await registry.reload();
  const job = {
    kind: "image",
    providerId: "codex",
    model: "native",
    images: [],
    image,
  };
  await registry.preflight([job]);
  await assert.rejects(
    registry.preflight([{ ...job, image: { outputFormat: "svg" } }]),
    /does not support SVG/,
  );
  await assert.rejects(
    registry.preflight([{ ...job, image: { complexity: "low" } }]),
    /does not expose/,
  );
  await assert.rejects(
    registry.preflight([
      { ...job, providerId: "local-color", model: "color-study" },
    ]),
    /does not support GIF/,
  );
  await assert.rejects(
    registry.preflight([
      { ...job, images: [{ asset: "/files/runs/a/b/output.gif" }] },
    ]),
    /raster references/,
  );
  const catalog = await registry.catalog();
  assert.equal(
    catalog.find((p) => p.id === "codex").modelDetails[0].animationMethod,
    "sprite-sheet",
  );
});

test("native API GIF runs retain animated artifacts, lineage and ZIP names across store reload", async (t) => {
  const dir = await directory(t),
    setupDir = path.join(dir, "setup");
  await mkdir(setupDir);
  const source = path.join(setupDir, "sheet.png");
  await writeFile(source, await sheet());
  const assembled = await finalizeImage(
    source,
    setupDir,
    { image },
    { spriteSheet: true },
  );
  const bytes = await readFile(assembled.path),
    requests = [];
  const api = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      url: req.url,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }));
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => api.close(r)));
  const registry = new ProviderRegistry({
    root,
    dataRoot: dir,
    codexHealth: async () => ({ ready: false }),
    definitions: [
      {
        id: "gif-api",
        kind: "image-api",
        name: "Synthetic API",
        baseUrl: `http://127.0.0.1:${api.address().port}/v1`,
        models: ["gpt-image-2.6-flare"],
        parameters: { stream: true, partial_images: 3, output_compression: 50 },
      },
    ],
  });
  await registry.reload();
  const graph = createImageWorkflow({
    prompt: "A waving mascot",
    providerId: "gif-api",
    model: "gpt-image-2.6-flare",
    image: { ...image, complexity: "low" },
    count: 2,
  });
  const plan = planWorkflow(graph);
  assert.equal(plan.imageJobs, 2);
  assert.equal(plan.videoJobs, 0);
  await registry.preflight(plan.jobs);
  await assert.rejects(
    registry.preflight([
      { ...plan.jobs[0], images: [{ asset: "/assets/seed.png" }] },
    ]),
    /does not support GIF output on image edits/,
  );
  let store = new Store(dir);
  await store.init();
  let assets = new Assets({
    store,
    resolveAsset: () => {
      throw new Error("No input files expected");
    },
  });
  const queue = new Queue(store, { assets, adapter: (c) => registry.run(c) });
  const run = await queue.create(graph, {}, plan);
  for (let i = 0; i < 500 && !["completed", "failed"].includes(run.status); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    run.status,
    "completed",
    JSON.stringify(run.jobs.map((j) => j.error)),
  );
  for (const job of run.jobs) {
    assert.ok(job.output.endsWith("output.gif"));
    assert.equal(mediaArtifact(job).mimeType, "image/gif");
    assert.deepEqual(await readFile(assets.file(job.output)), bytes);
    const asset = assets.get(job.assetId);
    assert.equal(asset.mimeType, "image/gif");
    assert.equal(asset.provenance.requested.image.complexity, "low");
    assert.equal(asset.provenance.effective.artifact.animationMethod, "native");
    assert.equal(asset.provenance.effective.artifact.frameCount, 4);
    assert.ok(asset.parents.some((p) => p.role === "provider-original"));
  }
  assert.equal(requests[0].url, "/v1/images/generations");
  assert.equal(requests[0].body.output_format, "gif");
  assert.equal(requests[0].body.frame_count, 4);
  assert.equal(requests[0].body.frame_duration_ms, 250);
  assert.equal(requests[0].body.size, "auto");
  assert.equal(requests[0].body.complexity, "low");
  assert.equal(requests[0].body.stream, undefined);
  assert.equal(requests[0].body.output_compression, undefined);
  await queue.stop();
  await store.close();
  store = new Store(dir);
  await store.init();
  t.after(() => store.close());
  assets = new Assets({
    store,
    resolveAsset: () => {
      throw new Error("Not needed");
    },
  });
  const restored = store.runs.get(run.id);
  assert.equal(restored.jobs[0].metadata.frameCount, 4);
  assert.deepEqual(await readFile(assets.file(restored.jobs[0].output)), bytes);
  const app = express();
  registerRunRoutes(app, {
    store,
    dataRoot: dir,
    projects: { assertWorkflow() {} },
    assets,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/runs/${run.id}/download`,
  );
  assert.equal(response.status, 200);
  const zip = Buffer.from(await response.arrayBuffer());
  assert.ok(zip.includes(Buffer.from(".gif")));
  assert.ok(zip.includes(Buffer.from("assets.jsonl")));
});

test("SVG validation accepts static vector paths and rejects active or external content", () => {
  const vector =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M0 0L32 32" stroke="red"/></svg>';
  verifyStaticSvg(Buffer.from(vector));
  for (const content of [
    "<script>alert(1)</script>",
    "<foreignObject/>",
    '<path onload="alert(1)"/>',
    '<use href="https://evil.example/a.svg#x"/>',
    '<path fill="url(https://evil.example/x)"/>',
    "<style>path{fill:red}</style>",
  ])
    assert.throws(() =>
      verifyStaticSvg(
        Buffer.from(
          vector.replace('<path d="M0 0L32 32" stroke="red"/>', content),
        ),
      ),
    );
  assert.throws(() =>
    verifyStaticSvg(
      Buffer.from('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>'),
    ),
  );
});

test("Image 2.6 still formats preserve transparency and SVG output remains vector data", async (t) => {
  const dir = await directory(t);
  const png = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M0 0L32 32" stroke="red"/></svg>',
  );
  let unsafe = false;
  const requests = [];
  const api = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const fields = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(fields);
    const bytes =
      fields.output_format === "svg"
        ? unsafe
          ? Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            )
          : svg
        : png;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }));
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => api.close(r)));
  const registry = new ProviderRegistry({
    root,
    dataRoot: dir,
    codexHealth: async () => ({ ready: false }),
    definitions: [
      {
        id: "formats",
        kind: "image-api",
        name: "Synthetic formats",
        baseUrl: `http://127.0.0.1:${api.address().port}/v1`,
        models: ["gpt-image-2.6-sunburst"],
      },
    ],
  });
  await registry.reload();
  const provider = (await registry.catalog()).find((p) => p.id === "formats");
  assert.ok(provider.modelDetails[0].outputFormats.includes("svg"));
  assert.deepEqual(provider.modelDetails[0].complexityLevels, [
    "low",
    "medium",
    "high",
  ]);
  for (const format of ["png", "jpeg", "webp", "svg"]) {
    const job = {
      kind: "image",
      providerId: "formats",
      model: "gpt-image-2.6-sunburst",
      prompt: "A mark",
      images: [],
      ratio: "1:1",
      quality: "high",
      image: {
        outputFormat: format,
        complexity: "medium",
        ...(["png", "webp"].includes(format)
          ? { background: "transparent" }
          : {}),
      },
    };
    const result = await registry.run({
      job,
      directory: path.join(dir, format),
      imagePaths: [],
      signal: new AbortController().signal,
    });
    assert.equal(result.metadata.outputFormat, format);
    const meta = await sharp(result.path).metadata();
    assert.equal(meta.format, format);
    assert.equal(meta.width, 32);
    if (format === "png" || format === "webp")
      assert.equal(meta.hasAlpha, true);
    if (format === "svg") assert.deepEqual(await readFile(result.path), svg);
    assert.equal(result.metadata.effectiveSettings.output_format, format);
  }
  assert.equal(requests[0].background, "transparent");
  unsafe = true;
  await assert.rejects(
    registry.run({
      job: {
        kind: "image",
        providerId: "formats",
        model: "gpt-image-2.6-sunburst",
        prompt: "A mark",
        images: [],
        ratio: "1:1",
        quality: "high",
        image: { outputFormat: "svg" },
      },
      directory: path.join(dir, "unsafe"),
      imagePaths: [],
      signal: new AbortController().signal,
    }),
    /static SVG/,
  );
});

test("CLI and client create GIF workflows without video nodes and preserve per-mode formats", async () => {
  const graph = await prepareWorkflow(
    { projectId: "demo" },
    {
      name: "Loop",
      "output-format": "gif",
      frames: "4",
      "frame-delay": "250",
      prompt: "A wave",
    },
    { create: true },
  );
  const generator = graph.nodes.find((n) => n.type === "generate");
  assert.deepEqual(generator.data.image, image);
  assert.equal(planWorkflow(graph).total, 1);
  const modes = createImageWorkflow({
    prompt: "A wave",
    modes: [
      { id: "still", label: "Still", providerId: "codex", count: 2 },
      { id: "loop", label: "Loop", providerId: "codex", count: 2, image },
    ],
  });
  const jobs = planWorkflow(modes).jobs;
  assert.equal(jobs.length, 4);
  assert.equal(jobs.filter((j) => j.image?.outputFormat === "gif").length, 2);
  await assert.rejects(
    prepareWorkflow({}, { media: "video", "output-format": "gif" }),
    /GIF is an image/,
  );
});

test("markup edits send a separate transparent layer and freeze it in output lineage", async (t) => {
  const dir = await directory(t),
    store = new Store(dir);
  await store.init();
  t.after(() => store.close());
  const source = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const layer = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 8, height: 8, channels: 4, background: "red" },
        })
          .png()
          .toBuffer(),
        left: 8,
        top: 8,
      },
    ])
    .png()
    .toBuffer();
  await writeFile(path.join(dir, "uploads", "source.png"), source);
  await writeFile(path.join(dir, "uploads", "markup.png"), layer);
  const requests = [];
  const api = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, body: Buffer.concat(chunks) });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ data: [{ b64_json: source.toString("base64") }] }),
    );
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => api.close(r)));
  const registry = new ProviderRegistry({
    root,
    dataRoot: dir,
    codexHealth: async () => ({ ready: false }),
    definitions: [
      {
        id: "markup-api",
        kind: "image-api",
        name: "Markup API",
        baseUrl: `http://127.0.0.1:${api.address().port}/v1`,
        models: ["gpt-image-2.6-flare"],
      },
    ],
  });
  await registry.reload();
  const resolveAsset = (url) => path.join(dir, url.replace(/^\/files\//, ""));
  const assets = new Assets({ store, resolveAsset });
  const queue = new Queue(store, {
    assets,
    resolveAsset,
    adapter: (context) => registry.run(context),
  });
  t.after(() => queue.stop());
  const graph = createImageWorkflow({
    prompt: "Recolor the marked area blue; remove annotations.",
    images: ["/files/uploads/source.png"],
    providerId: "markup-api",
    model: "gpt-image-2.6-flare",
    image: { markup: "/files/uploads/markup.png", complexity: "low" },
  });
  const plan = planWorkflow(graph);
  assert.equal(plan.jobs[0].images.at(-1).role, "markup");
  await registry.preflight(plan.jobs);
  const run = await queue.create(graph, {}, plan);
  for (let i = 0; i < 500 && !["completed", "failed"].includes(run.status); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    run.status,
    "completed",
    JSON.stringify(run.jobs.map((j) => j.error)),
  );
  assert.equal(requests[0].url, "/v1/images/edits");
  assert.match(requests[0].body.toString(), /name="image\[\]"/);
  assert.match(
    requests[0].body.toString(),
    /name="markup"; filename="markup.png"/,
  );
  assert.ok(requests[0].body.includes(layer));
  const job = run.jobs[0],
    ref = job.lineage.inputs.find((ref) => ref.role === "annotation-map");
  assert.ok(ref.snapshotFile);
  assert.deepEqual(
    await readFile(
      assets.file(`/files/runs/${run.id}/${job.id}/${ref.snapshotFile}`),
    ),
    layer,
  );
  const output = assets.get(job.assetId);
  assert.ok(output.parents.some((p) => p.role === "annotation-map"));
  await assert.rejects(
    registry.run({
      job: plan.jobs[0],
      directory: path.join(dir, "invalid"),
      imagePaths: [
        resolveAsset("/files/uploads/source.png"),
        resolveAsset("/files/uploads/source.png"),
      ],
      signal: new AbortController().signal,
    }),
    /Markup must be transparent/,
  );
});
