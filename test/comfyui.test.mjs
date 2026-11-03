import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { ComfyMedia } from "../harness-integrations/comfyui/index.mjs";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { Store } from "../server/store.mjs";
import { Assets } from "../server/assets.mjs";
import { Queue } from "../server/queue.mjs";
import { createImageWorkflow } from "../client/workflows.mjs";
import {
  createCheckpointProfile,
  comfyProfileSchema,
  loopbackEndpointSchema,
} from "../shared/local-models.mjs";

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const recipe = (imageToImage = false) =>
  createCheckpointProfile({
    id: "sd-local",
    name: "Local SD",
    checkpoint: "model.safetensors",
    imageToImage,
  });
function nodeInfo(profile) {
  return Object.fromEntries(
    Object.values(profile.graph).map((node) => [
      node.class_type,
      {
        input: {
          required: Object.fromEntries(
            Object.entries(node.inputs).map(([key, value]) => [
              key,
              key === "ckpt_name"
                ? [["model.safetensors"]]
                : [
                    Array.isArray(value)
                      ? "ANY"
                      : typeof value === "number"
                        ? "INT"
                        : "STRING",
                  ],
            ]),
          ),
        },
      },
    ]),
  );
}
async function fixture(
  t,
  { profile = recipe(), kind = profile.kind, custom, Socket = null } = {},
) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "flow-comfy-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const image = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "#888" },
  })
    .png()
    .toBuffer();
  const calls = [],
    config = { baseUrl: "http://127.0.0.1:8188" };
  const runtimes = {
    getConfig: async () => config,
    status: async () => ({
      installed: true,
      running: true,
      baseUrl: config.baseUrl,
    }),
  };
  let posts = 0;
  const fetcher = async (value, options = {}) => {
    const url = new URL(value),
      call = { route: url.pathname, url, ...options };
    calls.push(call);
    const override = await custom?.(call);
    if (override) return override;
    if (url.pathname === "/object_info") return json(nodeInfo(profile));
    if (url.pathname === "/system_stats")
      return json({
        system: { comfyui_version: "fixture-1" },
        devices: [{ name: "fixture CPU", type: "cpu" }],
      });
    if (url.pathname === "/models/checkpoints")
      return json(["model.safetensors"]);
    if (url.pathname === "/upload/image")
      return json({ name: "uploaded.png", subfolder: "flow", type: "input" });
    if (url.pathname === "/prompt") {
      posts++;
      return json({ prompt_id: "local_prompt_1" });
    }
    if (url.pathname === "/history/local_prompt_1")
      return json({
        local_prompt_1: {
          status: { completed: true, status_str: "success" },
          outputs: {
            [profile.output.nodeId]: {
              [profile.output.field]: [
                {
                  filename: kind === "video" ? "result.mp4" : "result.png",
                  subfolder: "",
                  type: "output",
                },
              ],
            },
          },
        },
      });
    if (url.pathname === "/view")
      return new Response(
        kind === "video"
          ? await readFile(
              new URL("./fixtures/tiny-video.mp4", import.meta.url),
            )
          : image,
      );
    throw new Error(`Unexpected ${url}`);
  };
  const adapter = new ComfyMedia({
    dataRoot,
    runtimes,
    fetch: fetcher,
    pollMs: 0,
    WebSocket: Socket,
  });
  await adapter.saveProfile(profile);
  const job = {
    providerId: `comfyui-${kind}`,
    kind,
    model: profile.id,
    prompt: "Monochrome athlete",
    seed: 42,
    ratio: "2:1",
    images: [],
  };
  const checkpoints = [];
  const checkpoint = async (event) => {
    checkpoints.push(structuredClone(event));
    if (event.providerOperation === null) delete job.providerOperation;
    else if (event.providerOperation)
      job.providerOperation = structuredClone(event.providerOperation);
  };
  const context = {
    job,
    directory: path.join(dataRoot, "output"),
    imagePaths: [],
    checkpoint,
  };
  return {
    adapter,
    dataRoot,
    image,
    calls,
    config,
    runtimes,
    fetcher,
    context,
    job,
    checkpoints,
    posts: () => posts,
  };
}

test("local profiles reject non-loopback URLs, frontend save graphs, link bindings, and known cloud nodes", async (t) => {
  for (const value of [
    "https://example.com",
    "http://127.0.0.1:8188/path",
    "http://user:pass@localhost:8188",
    "http://127.0.0.2:8188",
  ])
    assert.equal(loopbackEndpointSchema.safeParse(value).success, false);
  assert.equal(
    loopbackEndpointSchema.safeParse("http://[::1]:8188").success,
    true,
  );
  assert.equal(
    comfyProfileSchema.safeParse({ id: "a", nodes: [] }).success,
    false,
  );
  const profile = recipe();
  profile.bindings.prompt = { nodeId: "3", input: "model" };
  assert.equal(comfyProfileSchema.safeParse(profile).success, false);
  const f = await fixture(t);
  const cloud = recipe();
  cloud.graph["6"].class_type = "OpenAIGenerateImage";
  assert.throws(() => f.adapter.saveProfile(cloud), /Cloud\/API/);
});

test("core image workflow binds prompt, dimensions, and seed, validates actual media, and records frozen lineage", async (t) => {
  const f = await fixture(t);
  const result = await f.adapter.run(f.context);
  assert.equal(result.kind, "image");
  assert.deepEqual(await readFile(result.path), f.image);
  const post = JSON.parse(
    f.calls.find((call) => call.route === "/prompt").body,
  );
  assert.equal(post.prompt["6"].inputs.text, "Monochrome athlete");
  assert.equal(post.prompt["3"].inputs.seed, 42);
  assert.equal(post.prompt["5"].inputs.width, 768);
  assert.equal(post.prompt["5"].inputs.height, 384);
  assert.equal(result.metadata.seedMode, "parameter");
  assert.equal(result.metadata.actualModel, undefined);
  assert.equal(
    result.metadata.effectiveSettings.comfyGraph["6"].inputs.text,
    f.job.prompt,
  );
  assert.equal(result.metadata.effectiveSettings.runtime.version, "fixture-1");
  assert.equal(
    result.metadata.effectiveSettings.modelFacts[0].hashVerified,
    false,
  );
  assert.equal(result.metadata.comfyGraphSha256.length, 64);
  assert.equal(f.checkpoints[0].providerOperation.state, "submitting");
  assert.equal(f.checkpoints[1].providerOperation.state, "accepted");
  assert.equal(f.posts(), 1);
});

test("image-to-image uploads bytes in profile order and refuses silent dropped references", async (t) => {
  const f = await fixture(t, { profile: recipe(true) });
  f.job.images = ["/files/source.png"];
  const seed = path.join(f.dataRoot, "seed.png");
  await writeFile(seed, f.image);
  f.context.imagePaths = [seed];
  const result = await f.adapter.run(f.context);
  const upload = f.calls.find((call) => call.route === "/upload/image");
  assert.deepEqual(
    Buffer.from(await upload.body.get("image").arrayBuffer()),
    f.image,
  );
  const post = JSON.parse(
    f.calls.find((call) => call.route === "/prompt").body,
  );
  assert.equal(post.prompt["10"].inputs.image, "flow/uploaded.png");
  assert.equal(result.metadata.comfyProfile.bindings.images.length, 1);
  f.job.images.push("/files/extra.png");
  await assert.rejects(f.adapter.preflight(f.job), /exactly 1 source/);
});

test("missing models and unsupported custom nodes fail before any generation submission", async (t) => {
  const f = await fixture(t, {
    custom: async ({ route }) =>
      route === "/models/checkpoints" ? json([]) : null,
  });
  const validation = await f.adapter.validateProfile("sd-local");
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /Missing model/);
  await assert.rejects(f.adapter.run(f.context), /Missing model/);
  assert.equal(f.posts(), 0);
  const missing = recipe();
  missing.graph["6"].class_type = "MissingLocalTextEncoder";
  await f.adapter.saveProfile(missing);
  const status = await f.adapter.validateProfile("sd-local");
  assert.match(status.errors.join(" "), /Missing node MissingLocalTextEncoder/);
});

test("offline runtime is actionable and does not imply model inference readiness", async (t) => {
  const f = await fixture(t, {
    custom: async () => {
      throw new Error("connection refused");
    },
  });
  const validation = await f.adapter.validateProfile("sd-local");
  assert.equal(validation.valid, false);
  assert.match(validation.errors[0], /offline/);
  await assert.rejects(f.adapter.run(f.context), /offline/);
  assert.equal(f.posts(), 0);
});

test("accepted prompt resumes after adapter restart using frozen profile even if the library profile changes", async (t) => {
  let broken = true;
  const f = await fixture(t, {
    custom: async ({ route }) => {
      if (route.startsWith("/history/") && broken)
        throw new Error("disconnected");
    },
  });
  await assert.rejects(f.adapter.run(f.context), /offline/);
  assert.equal(f.job.providerOperation.state, "accepted");
  const edited = recipe();
  edited.graph["7"].inputs.text = "Changed library instructions";
  await f.adapter.saveProfile(edited);
  broken = false;
  const restarted = new ComfyMedia({
    dataRoot: f.dataRoot,
    runtimes: f.runtimes,
    fetch: f.fetcher,
    pollMs: 0,
    WebSocket: null,
  });
  const result = await restarted.run(f.context);
  assert.equal(f.posts(), 1);
  assert.equal(
    result.metadata.comfyProfile.graph["7"].inputs.text,
    "text, watermark",
  );
  assert.equal(result.metadata.comfyGraph["7"].inputs.text, "text, watermark");
  f.config.baseUrl = "http://localhost:8199";
  await assert.rejects(restarted.run(f.context), /changed endpoint/);
  assert.equal(f.posts(), 1);
});

test("uncertain prompt submission is retained and never silently duplicated", async (t) => {
  let attempted = 0;
  const f = await fixture(t, {
    custom: async ({ route }) => {
      if (route === "/prompt") {
        attempted++;
        throw new Error("response lost");
      }
    },
  });
  await assert.rejects(f.adapter.run(f.context), /offline/);
  assert.equal(f.job.providerOperation.state, "submitting");
  await assert.rejects(f.adapter.run(f.context), /uncertain submission/);
  assert.equal(attempted, 1);
});

test("known rejection clears receipt but accepted missing queue/history stays explicit", async (t) => {
  const f = await fixture(t, {
    custom: async ({ route }) =>
      route === "/prompt"
        ? json(
            {
              error: { type: "prompt_outputs_failed_validation" },
              node_errors: { 4: {} },
            },
            400,
          )
        : null,
  });
  await assert.rejects(f.adapter.run(f.context), /nodes 4/);
  assert.equal(f.job.providerOperation, undefined);
  const lost = await fixture(t, {
    custom: async ({ route }) =>
      route.startsWith("/history/")
        ? json({})
        : route === "/queue"
          ? json({ queue_pending: [], queue_running: [] })
          : null,
  });
  await assert.rejects(lost.adapter.run(lost.context), /no longer has/);
  assert.equal(lost.job.providerOperation.state, "accepted");
  assert.equal(lost.posts(), 1);
});

test("video API profile validates real MP4 output and rejects a GIF masquerading as video", async (t) => {
  const profile = recipe();
  profile.kind = "video";
  profile.output.field = "videos";
  const f = await fixture(t, { profile });
  const result = await f.adapter.run(f.context);
  assert.equal(result.kind, "video");
  assert.ok(result.metadata.width > 0);
  assert.match(result.path, /\.mp4$/);
  const bad = await fixture(t, {
    profile,
    custom: async ({ route }) =>
      route === "/view" ? new Response("GIF89a fake") : null,
  });
  await assert.rejects(bad.adapter.run(bad.context), /valid MP4/);
});

test("saved profile removal and catalog preserve explicit image/video capability", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.adapter.catalog("image"))[0].id, "sd-local");
  assert.deepEqual(await f.adapter.catalog("video"), []);
  assert.equal((await f.adapter.status("video")).ready, false);
  await f.adapter.removeProfile("sd-local");
  assert.deepEqual(await f.adapter.profiles(), []);
  await assert.rejects(f.adapter.preflight(f.job), /saved ComfyUI profile/);
});

test("live execution events expose observed node steps without fabricating whole-job percentages", async (t) => {
  let socket;
  class Socket {
    constructor() {
      socket = this;
      this.listeners = {};
    }
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
    emit(value) {
      this.listeners.message({ data: JSON.stringify(value) });
    }
    close() {
      this.closed = true;
    }
  }
  const f = await fixture(t, {
    Socket,
    custom: async ({ route }) => {
      if (route.startsWith("/history/")) {
        socket.emit({
          type: "progress",
          data: { prompt_id: "another_job", node: "3", value: 19, max: 20 },
        });
        socket.emit({
          type: "progress",
          data: { prompt_id: "local_prompt_1", node: "3", value: 4, max: 20 },
        });
      }
    },
  });
  await f.adapter.run(f.context);
  assert.ok(
    f.checkpoints.some(
      (entry) => entry.message === "ComfyUI node 3 · 4/20 steps",
    ),
  );
  assert.ok(!f.checkpoints.some((entry) => entry.message?.includes("19/20")));
  assert.equal(socket.closed, true);
});

async function registry(f) {
  const providers = new ProviderRegistry({
    root: path.resolve(import.meta.dirname, ".."),
    dataRoot: f.dataRoot,
    definitions: [],
    runtimes: f.runtimes,
    comfy: f.adapter,
    ollama: { catalog: async () => [], status: async () => ({ ready: false }) },
    codexHealth: async () => ({ ready: false }),
  });
  await providers.reload();
  return providers;
}

test("registry resumes a removed Comfy profile and retains its native lineage through normalization", async (t) => {
  let broken = true;
  const f = await fixture(t, {
    custom: async ({ route }) => {
      if (route.startsWith("/history/") && broken)
        throw new Error("connection lost");
    },
  });
  const providers = await registry(f);
  await assert.rejects(providers.run(f.context), /offline/);
  assert.equal(f.job.providerOperation.state, "accepted");
  await f.adapter.removeProfile(f.job.model);
  await providers.reload();
  assert.deepEqual(providers.get("comfyui-image").models, []);
  broken = false;
  const result = await providers.run(f.context);
  assert.equal(f.posts(), 1);
  assert.equal(result.metadata.providerId, "comfyui-image");
  assert.equal(result.metadata.requestedModel, "sd-local");
  assert.equal(result.metadata.actualModel, undefined);
  assert.equal(
    result.metadata.effectiveSettings.comfyGraphSha256,
    f.job.providerOperation.requestHash,
  );
  assert.equal(result.metadata.effectiveSettings.comfyProfile.id, "sd-local");
  assert.equal(result.metadata.effectiveSettings.runtime.version, "fixture-1");
  assert.match(result.metadata.originalFile, /^original-attempt-1\.png$/);
  assert.deepEqual(
    await readFile(
      path.join(f.context.directory, result.metadata.originalFile),
    ),
    f.image,
  );
  assert.equal(result.path, path.join(f.context.directory, "output.png"));
});

test("registry resume uses frozen image bindings when library profile capabilities changed", async (t) => {
  let broken = true;
  const f = await fixture(t, {
    profile: recipe(true),
    custom: async ({ route }) => {
      if (route.startsWith("/history/") && broken)
        throw new Error("connection lost");
    },
  });
  const source = path.join(f.dataRoot, "source.png");
  await writeFile(source, f.image);
  f.context.imagePaths = [source];
  f.job.images = ["/files/source.png"];
  const providers = await registry(f);
  await assert.rejects(providers.run(f.context), /offline/);
  await f.adapter.saveProfile(recipe(false));
  await providers.reload();
  broken = false;
  const result = await providers.run(f.context);
  assert.equal(f.posts(), 1);
  assert.equal(
    result.metadata.effectiveSettings.comfyProfile.bindings.images.length,
    1,
  );
});

test("registry and queue persist Comfy source snapshots, provider original, and exact graph in dataset lineage", async (t) => {
  const f = await fixture(t, { profile: recipe(true) });
  const providers = await registry(f),
    store = new Store(f.dataRoot);
  await store.init();
  const resolveAsset = (url) =>
    path.join(f.dataRoot, url.replace("/files/", ""));
  const assets = new Assets({ store, resolveAsset });
  const url = "/files/uploads/source.png";
  await writeFile(resolveAsset(url), f.image);
  const source = await assets.captureUpload({ url, name: "source.png" });
  const queue = new Queue(store, {
    adapter: (context) => providers.run(context),
    assets,
    resolveAsset,
  });
  t.after(async () => {
    await queue.stop();
    await store.close();
  });
  const graph = createImageWorkflow({
    prompt: "Monochrome athlete",
    images: [url],
    providerId: "comfyui-image",
    model: "sd-local",
    ratio: "2:1",
    seed: 42,
  });
  const run = await queue.create(graph);
  for (let i = 0; i < 200 && !["failed", "completed"].includes(run.status); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(run.status, "completed", JSON.stringify(run.jobs));
  const job = run.jobs[0],
    lineage = assets.lineage(job.assetId);
  assert.ok(lineage.ancestors.some((entry) => entry.id === source.id));
  assert.ok(
    lineage.ancestors.some((entry) => entry.origin.type === "job-input"),
  );
  assert.ok(
    lineage.ancestors.some(
      (entry) => entry.origin.role === "provider-original",
    ),
  );
  const dataset = await assets.dataset({ runId: run.id });
  const row = dataset.rows.find((entry) => entry.asset.id === job.assetId);
  assert.equal(
    row.asset.provenance.effective.settings.comfyGraphSha256,
    job.providerOperation.requestHash,
  );
  assert.equal(
    row.asset.provenance.effective.settings.comfyGraph["6"].inputs.text,
    job.prompt,
  );
  assert.equal(row.asset.provenance.effective.seed.effective, 42);
  assert.equal(row.asset.provenance.effective.model, null);
});

test("lineage records verified weight hashes only for the managed server using those weights", async (t) => {
  const f = await fixture(t),
    digest = "a".repeat(64);
  f.runtimes.status = async () => ({
    installed: true,
    running: true,
    managed: true,
    baseUrl: f.config.baseUrl,
    models: [
      {
        folder: "checkpoints",
        filename: "model.safetensors",
        source: "managed",
        hashVerified: true,
        sha256: digest,
        sizeBytes: 1234,
      },
    ],
  });
  const validation = await f.adapter.validateProfile("sd-local");
  assert.equal(validation.valid, true);
  assert.equal(validation.modelFacts[0].sha256, digest);
  assert.equal(validation.modelFacts[0].hashVerified, true);
  const result = await f.adapter.run(f.context);
  assert.equal(result.metadata.effectiveSettings.modelFacts[0].sha256, digest);
  f.runtimes.status = async () => ({
    installed: true,
    running: true,
    managed: false,
    baseUrl: f.config.baseUrl,
    models: [
      {
        folder: "checkpoints",
        filename: "model.safetensors",
        source: "managed",
        hashVerified: true,
        sha256: digest,
      },
    ],
  });
  const external = await f.adapter.validateProfile("sd-local");
  assert.equal(external.modelFacts[0].hashVerified, false);
  assert.equal(external.modelFacts[0].sha256, undefined);
});

test("MOSS uses native model components, full prompt and 16-aligned dimensions, with frozen weight requirements", async (t) => {
  const { createPresetProfile } =
    await import("../shared/local-model-presets.mjs");
  const profile = createPresetProfile("moss-image-sft-int8");
  const { adapter, job, context, calls } = await fixture(t, {
    profile,
    custom: ({ route }) =>
      route.startsWith("/models/")
        ? json(
            profile.requiredModels
              .filter((entry) => route === `/models/${entry.folder}`)
              .map((entry) => entry.filename),
          )
        : undefined,
  });
  job.prompt = "A monochrome cyclist. The sign reads FLOW.";
  job.seed = 0;
  job.ratio = "16:9";
  const result = await adapter.run(context);
  const submitted = JSON.parse(
    calls.find((call) => call.route === "/prompt").body,
  ).prompt;
  assert.equal(submitted["2"].inputs.type, "moss_image");
  assert.equal(submitted["4"].inputs.text, job.prompt);
  assert.equal(submitted["7"].inputs.seed, 0);
  assert.equal(submitted["6"].inputs.width, 1024);
  assert.equal(submitted["6"].inputs.height, 576);
  assert.equal(profile.bindings.images, undefined);
  assert.equal(result.metadata.comfyProfile.requiredModels.length, 3);
  assert.ok(
    result.metadata.comfyProfile.requiredModels.every(
      (weight) => weight.sha256.length === 64,
    ),
  );
  assert.deepEqual(result.metadata.comfyGraph, submitted);
  await assert.rejects(
    adapter.preflight({
      ...job,
      providerOperation: undefined,
      images: ["/files/reference.png"],
    }),
    /exactly 0 source images/,
  );
});
