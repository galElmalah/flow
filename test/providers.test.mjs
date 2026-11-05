import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { planWorkflow } from "../server/graph.mjs";
import { starter } from "../server/defaults.mjs";
import { Queue } from "../server/queue.mjs";
import { Store } from "../server/store.mjs";

const root = path.resolve(import.meta.dirname, "..");
const noCodex = async () => ({ ready: false, auth: "Test: no Codex sign-in" });
async function setup(t, definitions = []) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "flow-providers-"));
  const registry = new ProviderRegistry({
    root,
    dataRoot,
    definitions,
    codexHealth: noCodex,
  });
  await registry.reload();
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  return { registry, dataRoot };
}
const imageJob = (overrides = {}) => ({
  id: "test-image",
  providerId: "local-color",
  prompt: "A color study; literal $(touch SHOULD_NOT_EXIST) stays text",
  seed: 43,
  ratio: "1:1",
  quality: "high",
  images: [{ asset: "/assets/paper-seed.png" }],
  ...overrides,
});
const context = (job, directory) => ({
  job,
  directory,
  imagePaths: [path.join(root, "public/assets/paper-seed.png")],
  signal: new AbortController().signal,
});
const waitFor = async (fn) => {
  const until = Date.now() + 10000;
  while (!fn()) {
    if (Date.now() > until) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("local command provider works without Codex sign-in and produces a real normalized image", async (t) => {
  const { registry, dataRoot } = await setup(t);
  const job = imageJob();
  await registry.preflight([job]);
  assert.equal(job.model, "color-study");
  const result = await registry.run(context(job, path.join(dataRoot, "job")));
  assert.equal(result.metadata.providerId, "local-color");
  assert.equal(result.metadata.seedMode, "deterministic");
  assert.equal((await sharp(result.path).metadata()).format, "png");
  assert.equal(result.metadata.width, 1024);
  await assert.rejects(stat(path.join(dataRoot, "job", "SHOULD_NOT_EXIST")));
  const request = JSON.parse(
    await readFile(path.join(dataRoot, "job/request.json"), "utf8"),
  );
  assert.equal(request.prompt, job.prompt);
});
test("provider and model are captured per node, with explicit CLI overrides", () => {
  const g = structuredClone(starter);
  g.nodes.find((n) => n.id === "generate").data.providerId = "local-color";
  g.nodes.find((n) => n.id === "generate").data.model = "duotone";
  const p = planWorkflow(g, { count: 1 });
  assert.ok(
    p.jobs.every(
      (j) => j.providerId === "local-color" && j.model === "duotone",
    ),
  );
  const override = planWorkflow(g, {
    count: 1,
    providerId: "another",
    model: "custom",
  });
  assert.equal(override.jobs[0].providerId, "another");
  assert.equal(override.jobs[0].model, "custom");
});
test("unknown providers, missing references, and unconfigured models fail preflight", async (t) => {
  const { registry } = await setup(t);
  await assert.rejects(
    registry.preflight([imageJob({ providerId: "absent" })]),
    /not configured/,
  );
  await assert.rejects(
    registry.preflight([imageJob({ images: [] })]),
    /Connect a seed/,
  );
  await assert.rejects(
    registry.preflight([imageJob({ model: "absent" })]),
    /not configured/,
  );
  await assert.rejects(
    registry.preflight([imageJob({ providerId: "codex" })]),
    /no Codex/,
  );
});
test("API provider sends generation JSON and image-edit multipart, then decodes original image bytes", async (t) => {
  const png = await sharp({
    create: { width: 24, height: 16, channels: 3, background: "#9d7bba" },
  })
    .png()
    .toBuffer();
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const definition = {
    id: "test-api",
    kind: "image-api",
    name: "Test image endpoint",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    models: ["test-model"],
    seedParameter: "seed",
  };
  const { registry, dataRoot } = await setup(t, [definition]);
  const job = imageJob({
    providerId: "test-api",
    model: "test-model",
    images: [],
  });
  await registry.preflight([job]);
  const result = await registry.run({
    ...context(job, path.join(dataRoot, "generate")),
    imagePaths: [],
  });
  assert.equal(result.metadata.width, 24);
  assert.deepEqual(
    await readFile(
      path.join(dataRoot, "generate", result.metadata.originalFile),
    ),
    png,
  );
  const body = JSON.parse(requests[0].body);
  assert.equal(body.seed, 43);
  assert.equal(body.model, "test-model");
  assert.equal(requests[0].url, "/v1/images/generations");
  await registry.run(
    context(
      { ...job, images: [{ asset: "reference" }] },
      path.join(dataRoot, "edit"),
    ),
  );
  assert.equal(requests[1].url, "/v1/images/edits");
  assert.match(requests[1].headers["content-type"], /multipart\/form-data/);
  assert.match(requests[1].body, /name="image\[\]"/);
  assert.match(requests[1].body, /A color study/);
});
test("mixed-provider dependencies use actual parent outputs and preserve provenance", async (t) => {
  const { registry, dataRoot } = await setup(t, [
    {
      id: "second-command",
      kind: "command",
      name: "Second harness",
      models: ["duotone"],
      command: [
        process.execPath,
        path.join(root, "examples/harnesses/local-color.mjs"),
      ],
      seeded: true,
      requiresImage: true,
    },
  ]);
  const store = new Store(dataRoot);
  await store.init();
  const queue = new Queue(store, {
    concurrency: 2,
    adapter: (c) => registry.run(c),
    resolveAsset: () => path.join(root, "public/assets/paper-seed.png"),
  });
  const g = structuredClone(starter);
  g.nodes.find((n) => n.id === "variations").data.lines = "one study";
  Object.assign(g.nodes.find((n) => n.id === "generate").data, {
    providerId: "local-color",
    model: "color-study",
    count: 1,
  });
  g.nodes.push({
    id: "second",
    type: "generate",
    position: { x: 1400, y: 0 },
    data: {
      label: "Second stage",
      providerId: "second-command",
      model: "duotone",
      text: "Refine the palette",
      count: 1,
    },
  });
  g.edges.push({
    id: "next",
    source: "generate",
    target: "second",
    targetHandle: "image",
  });
  const plan = planWorkflow(g);
  await registry.preflight(plan.jobs);
  const run = await queue.create(g, {}, plan);
  await waitFor(() => ["completed", "failed"].includes(run.status));
  await store.flush();
  assert.equal(run.status, "completed");
  assert.equal(run.provider, "mixed");
  assert.equal(run.jobs[1].metadata.providerName, "Second harness");
  const childInput = JSON.parse(
    await readFile(
      path.join(dataRoot, "runs", run.id, run.jobs[1].id, "request.json"),
      "utf8",
    ),
  );
  assert.equal(
    childInput.images[0],
    path.join(dataRoot, "runs", run.id, run.jobs[0].id, "output.png"),
  );
});
test("a command that exits successfully without a fresh image cannot reuse stale output", async (t) => {
  const { registry, dataRoot } = await setup(t, [
    {
      id: "no-output",
      kind: "command",
      name: "No output",
      models: ["test"],
      command: [process.execPath, "-e", "process.stdin.resume();"],
    },
  ]);
  const dir = path.join(dataRoot, "stale");
  await mkdir(dir);
  await writeFile(
    path.join(dir, "output.png"),
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#111" },
    })
      .png()
      .toBuffer(),
  );
  await assert.rejects(
    registry.run({
      ...context(imageJob({ providerId: "no-output" }), dir),
      imagePaths: [],
    }),
    /ENOENT/,
  );
});
test("command cancellation terminates the process and reports cancellation", async (t) => {
  const { registry, dataRoot } = await setup(t, [
    {
      id: "slow",
      kind: "command",
      name: "Slow harness",
      models: ["test"],
      command: [
        process.execPath,
        "-e",
        "process.stdin.resume(); setTimeout(()=>{},60000);",
      ],
    },
  ]);
  const controller = new AbortController();
  const task = registry.run({
    ...context(imageJob({ providerId: "slow" }), path.join(dataRoot, "cancel")),
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(task, /Cancelled/);
});

test("seeded local processing reproduces its PNG and duotone preserves a colored palette", async (t) => {
  const { registry, dataRoot } = await setup(t);
  const job = imageJob({ model: "duotone", seed: 301 });
  const first = await registry.run(context(job, path.join(dataRoot, "first")));
  const second = await registry.run(
    context(job, path.join(dataRoot, "second")),
  );
  assert.deepEqual(await readFile(first.path), await readFile(second.path));
  const stats = await sharp(first.path).stats();
  assert.ok(
    Math.abs(stats.channels[0].mean - stats.channels[1].mean) > 1,
    "duotone must produce colored pixels",
  );
  const next = await registry.run(
    context({ ...job, seed: 302 }, path.join(dataRoot, "different")),
  );
  assert.notDeepEqual(await readFile(first.path), await readFile(next.path));
});

test("compatible image request IDs are bounded and cannot publish the selected private key", async (t) => {
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const secret = "synthetic-private-request-header-key";
  let requestId, authorization;
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) {
    }
    authorization = req.headers.authorization;
    res.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": requestId,
    });
    res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { registry, dataRoot } = await setup(t);
  await registry.saveConnection(null, {
    name: "Synthetic compatible endpoint",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    models: [{ id: "fixture-image", capabilities: ["image"] }],
    apiKey: { action: "replace", value: secret },
  });
  const providerId = registry.managed[0].id;
  for (const [index, value] of [
    "request_123:abc-def",
    secret,
    `request-${secret}`,
    "r".repeat(201),
    "invalid request id",
  ].entries()) {
    requestId = value;
    const result = await registry.run({
      job: imageJob({ providerId, model: "fixture-image", images: [] }),
      directory: path.join(dataRoot, `request-id-${index}`),
      imagePaths: [],
      signal: new AbortController().signal,
    });
    assert.equal(authorization, `Bearer ${secret}`);
    assert.equal(
      result.metadata.providerRequestId,
      index === 0 ? value : undefined,
    );
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});
