import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import express from "express";
import { FalMedia } from "../harness-integrations/fal/index.mjs";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { registerProviderRoutes } from "../server/routes/providers.mjs";
import {
  FlowClient,
  createImageWorkflow,
  createVideoWorkflow,
} from "../client/index.mjs";
import { Store } from "../server/store.mjs";
import { Queue } from "../server/queue.mjs";
import { Assets } from "../server/assets.mjs";
import { planWorkflow } from "../server/graph.mjs";
import { falModels, falDefaults } from "../shared/fal.mjs";

const secret = "fal-private-fixture-key",
  root = path.resolve(import.meta.dirname, "..");
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const png = () =>
  sharp({ create: { width: 32, height: 24, channels: 3, background: "#888" } })
    .png()
    .toBuffer();
const accepted = (model, id = "request_1") => {
  const base = `https://queue.fal.run/${model.split("/").slice(0, 2).join("/")}/requests/${id}`;
  return {
    request_id: id,
    status: "IN_QUEUE",
    status_url: `${base}/status`,
    response_url: base,
    cancel_url: `${base}/cancel`,
  };
};
async function fixture(
  t,
  fetcher,
  { model = "fal-ai/flux/schnell", env = { FAL_KEY: secret } } = {},
) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "flow-fal-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const fal = new FalMedia({
    dataRoot,
    env,
    fetch: fetcher,
    pollIntervalMs: 0,
  });
  const detail = falModels.find((m) => m.id === model);
  const job = {
    providerId: `fal-${detail.capabilities[0]}`,
    kind: detail.capabilities[0],
    model,
    prompt: "Monochrome athlete",
    ratio: "16:9",
    quality: "auto",
    images: [],
    seed: 42,
    ...falDefaults(detail),
  };
  const checkpoints = [];
  const context = {
    job,
    directory: path.join(dataRoot, "job"),
    imagePaths: [],
    signal: new AbortController().signal,
    checkpoint: async (event) => {
      checkpoints.push(structuredClone(event));
      if (event.providerOperation === null) delete job.providerOperation;
      else if (event.providerOperation !== undefined)
        job.providerOperation = structuredClone(event.providerOperation);
    },
  };
  return { fal, job, context, checkpoints, dataRoot };
}
function registryFor(f) {
  return new ProviderRegistry({
    root,
    dataRoot: f.dataRoot,
    fal: f.fal,
    definitions: [],
    codexHealth: async () => ({ ready: false, auth: "fixture" }),
  });
}

test("fal queued image generation sends Key auth, uses the app-level status URL and preserves the effective seed", async (t) => {
  const calls = [],
    image = await png();
  let polls = 0;
  const f = await fixture(t, async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === "POST") return json(accepted("fal-ai/flux/schnell"));
    if (url.endsWith("/status"))
      return json(
        ++polls === 1
          ? { status: "IN_QUEUE", queue_position: 3 }
          : { status: "COMPLETED" },
      );
    if (url.startsWith("https://queue.fal.run"))
      return json({
        images: [{ url: "https://v3.fal.media/files/result.png" }],
        seed: 42,
      });
    return new Response(image);
  });
  const result = await f.fal.run(f.context);
  assert.equal(calls[0].url, "https://queue.fal.run/fal-ai/flux/schnell");
  assert.equal(calls[0].headers.Authorization, `Key ${secret}`);
  assert.deepEqual(JSON.parse(calls[0].body), {
    prompt: f.job.prompt,
    image_size: { width: 1368, height: 768 },
    num_images: 1,
    output_format: "png",
    enable_safety_checker: true,
    seed: 42,
  });
  assert.equal(
    calls[1].url,
    "https://queue.fal.run/fal-ai/flux/requests/request_1/status",
  );
  assert.deepEqual(calls.at(-1).headers, {});
  assert.equal(result.metadata.effectiveSeed, 42);
  assert.equal(result.metadata.seedMode, "parameter");
  assert.equal(result.metadata.providerRequestId, "request_1");
  assert.ok(f.checkpoints.some((e) => e.message === "fal queue · 3 ahead"));
  assert.ok(
    !JSON.stringify({ result, checkpoints: f.checkpoints }).includes(secret),
  );
  assert.deepEqual(await readFile(result.path), image);
});

test("Seedance first/end frames and reference images use their documented payloads; video is a real local MP4", async (t) => {
  const clip = await readFile(
    new URL("./fixtures/tiny-video.mp4", import.meta.url),
  );
  for (const mode of ["image", "reference"]) {
    let posted;
    const model = `bytedance/seedance-2.5/${mode}-to-video`;
    const f = await fixture(
      t,
      async (url, options) => {
        if (options.method === "POST") {
          posted = JSON.parse(options.body);
          return json(accepted(model));
        }
        if (url.endsWith("/status")) return json({ status: "COMPLETED" });
        if (url.startsWith("https://queue.fal.run"))
          return json({
            video: {
              url: "https://storage.googleapis.com/falserverless/results/movie.mp4",
            },
            seed: 123,
          });
        return new Response(clip);
      },
      { model },
    );
    const first = path.join(f.dataRoot, "first.png"),
      last = path.join(f.dataRoot, "last.png");
    await writeFile(first, await png());
    await writeFile(last, await png());
    f.context.imagePaths = [first, last];
    f.job.video.durationSeconds = 30;
    const result = await f.fal.run(f.context);
    assert.equal(posted.duration, "30");
    assert.equal(posted.codec, "H264");
    assert.equal(posted.generate_audio, true);
    assert.equal("seed" in posted, false);
    if (mode === "image") {
      assert.ok(posted.image_url.startsWith("data:image/png;base64,"));
      assert.ok(posted.end_image_url);
      assert.equal(posted.aspect_ratio, "auto");
      assert.equal(
        result.metadata.effectiveSettings.secondImageRole,
        "end-frame",
      );
    } else {
      assert.equal(posted.image_urls.length, 2);
      assert.equal(posted.image_url, undefined);
    }
    assert.equal(result.metadata.seedMode, "unsupported");
    assert.equal(result.metadata.effectiveSeed, 123);
    assert.ok(result.metadata.width > 0);
    assert.deepEqual(await readFile(result.path), clip);
  }
});

test("fal preflight rejects incompatible models, references, framing, quality and per-model limits without submitting", async (t) => {
  let submitted = 0;
  const f = await fixture(t, async () => {
    submitted++;
    throw new Error("no inference");
  });
  const base = { ...f.job };
  for (const patch of [
    { model: "unknown" },
    { images: [{}] },
    { quality: "high" },
    { image: { resolution: "2k" } },
    { ratio: "5:2" },
  ])
    assert.throws(() => f.fal.preflight({ ...base, ...patch }));
  const video = {
    ...base,
    kind: "video",
    model: "bytedance/seedance-2.0/text-to-video",
    video: { durationSeconds: 16 },
  };
  assert.throws(() => f.fal.preflight(video), /4–15/);
  assert.throws(
    () => f.fal.preflight({ ...video, video: { resolution: "360p" } }),
    /resolution/,
  );
  const first = {
    ...video,
    model: "bytedance/seedance-2.5/image-to-video",
    images: [{}],
    video: { durationSeconds: 30 },
  };
  assert.throws(() => f.fal.preflight(first), /first-frame video uses auto/);
  assert.doesNotThrow(() => f.fal.preflight({ ...first, ratio: "auto" }));
  assert.throws(
    () =>
      f.fal.preflight({
        ...first,
        ratio: "auto",
        video: { mode: "reference" },
      }),
    /match/,
  );
  assert.equal(submitted, 0);
});

test("accepted fal requests resume after restart without a second paid POST and retain uncertain submission receipts", async (t) => {
  let posts = 0;
  const model = "fal-ai/flux/schnell";
  const f = await fixture(t, async (url, options) => {
    if (options.method === "POST") {
      posts++;
      return json(accepted(model));
    }
    throw new Error(`network failure ${secret}`);
  });
  await assert.rejects(
    f.fal.run(f.context),
    (e) => !e.message.includes(secret) && /resume/i.test(e.message),
  );
  assert.equal(f.job.providerOperation.state, "accepted");
  const image = await png();
  const resumed = new FalMedia({
    dataRoot: f.dataRoot,
    env: { FAL_KEY: secret },
    pollIntervalMs: 0,
    fetch: async (url, options) => {
      assert.notEqual(options.method, "POST");
      if (url.endsWith("/status")) return json({ status: "COMPLETED" });
      if (url.startsWith("https://queue.fal.run"))
        return json({
          images: [{ url: "https://v3.fal.media/result.png" }],
          seed: 42,
        });
      return new Response(image);
    },
  });
  await resumed.run(f.context);
  assert.equal(posts, 1);
  f.job.prompt = "Changed input";
  await assert.rejects(resumed.run(f.context), /uncertain or changed/);
  delete f.job.providerOperation;
  f.fal.fetch = async () => {
    posts++;
    throw new Error("POST outcome unknown");
  };
  await assert.rejects(f.fal.run(f.context));
  assert.equal(f.job.providerOperation.state, "submitting");
  await assert.rejects(f.fal.run(f.context), /uncertain or changed/);
  assert.equal(posts, 2);
});

test("fal never forwards credentials to media, foreign operation URLs, redirects or provider errors", async (t) => {
  for (const attack of [
    "foreign-operation",
    "foreign-media",
    "redirect",
    "filtered",
    "bad-id",
  ]) {
    const calls = [];
    const f = await fixture(t, async (url, options) => {
      calls.push({ url, ...options });
      if (options.method === "POST")
        return json(
          attack === "bad-id"
            ? { request_id: secret }
            : {
                ...accepted("fal-ai/flux/schnell"),
                ...(attack === "foreign-operation"
                  ? { status_url: "https://evil.example/status" }
                  : {}),
              },
        );
      if (url.endsWith("/status")) return json({ status: "COMPLETED" });
      if (url.startsWith("https://queue.fal.run"))
        return json({
          images: [
            {
              url:
                attack === "foreign-media"
                  ? "https://127.0.0.1/internal"
                  : "https://v3.fal.media/result.png",
            },
          ],
          ...(attack === "filtered" ? { has_nsfw_concepts: [true] } : {}),
        });
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/result.png" },
      });
    });
    await assert.rejects(
      f.fal.run(f.context),
      (e) => !e.message.includes(secret),
    );
    assert.equal(
      calls.some((call) => /evil\.example|127\.0\.0\.1/.test(call.url)),
      false,
    );
    assert.equal(
      f.job.providerOperation.state,
      attack === "bad-id" ? "submitting" : "accepted",
    );
  }
});

test("fal private setup is shared by HTTP, client and CLI, while a configured key never claims authentication", async (t) => {
  const f = await fixture(
    t,
    async () => {
      throw new Error("setup must not infer");
    },
    { env: {} },
  );
  const registry = registryFor(f);
  await registry.reload();
  const app = express();
  app.use(express.json());
  const queue = { active: new Map(), concurrency: 4 };
  registerProviderRoutes(app, {
    root,
    dataRoot: f.dataRoot,
    providers: registry,
    queue,
  });
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  t.after(() => new Promise((done) => server.close(done)));
  const url = `http://127.0.0.1:${server.address().port}`,
    client = new FlowClient({ url });
  assert.equal((await client.falConnection()).ready, false);
  const saved = await client.configureFal({ apiKey: secret });
  assert.equal(saved.ready, true);
  assert.equal(saved.authenticated, null);
  assert.equal(
    (await stat(path.join(f.dataRoot, "fal.json"))).mode & 0o777,
    0o600,
  );
  const catalog = await client.providers();
  assert.equal(catalog.find((p) => p.id === "fal-video").models.length, 6);
  assert.ok(!JSON.stringify({ saved, catalog }).includes(secret));
  await assert.rejects(
    client.configureFal({ baseUrl: "https://evil.example" }),
    /Invalid Fal/,
  );
  queue.active.set("job", {});
  await assert.rejects(
    client.configureFal({ apiKey: null }),
    (e) => e.status === 409,
  );
  queue.active.clear();
  assert.equal((await client.configureFal({ apiKey: null })).ready, false);
  const { promisify } = await import("node:util"),
    { execFile } = await import("node:child_process");
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["cli/flow.mjs", "providers", "fal", "--url", url, "--json"],
    { cwd: root },
  );
  assert.equal(JSON.parse(stdout).ready, false);
});

test("four parallel fal jobs pass through the real queue, save distinct request IDs, normalized images and dataset lineage", async (t) => {
  const image = await png();
  let sequence = 0,
    active = 0,
    maxActive = 0;
  const ids = new Set();
  const f = await fixture(t, async (url, options) => {
    if (options.method === "POST") {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(25);
      active--;
      const id = `parallel_${++sequence}`;
      ids.add(id);
      return json(accepted("fal-ai/flux/schnell", id));
    }
    if (url.endsWith("/status")) return json({ status: "COMPLETED" });
    if (url.startsWith("https://queue.fal.run"))
      return json({
        images: [{ url: "https://v3.fal.media/result.png" }],
        seed: 42,
      });
    return new Response(image);
  });
  const registry = registryFor(f);
  await registry.reload();
  const store = new Store(f.dataRoot);
  await store.init();
  t.after(() => store.close());
  const assets = new Assets({
    store,
    resolveAsset: () => {
      throw new Error("No references expected");
    },
  });
  const queue = new Queue(store, {
    concurrency: 4,
    adapter: (c) => registry.run(c),
    assets,
  });
  t.after(() => queue.stop());
  const graph = createImageWorkflow({
    id: "fal-parallel",
    prompt: "An athlete",
    providerId: "fal-image",
    model: "fal-ai/flux/schnell",
    count: 4,
    quality: "auto",
  });
  const plan = planWorkflow(graph);
  await registry.preflight(plan.jobs);
  const run = await queue.create(graph, {}, plan);
  const until = Date.now() + 10_000;
  while (!["completed", "failed"].includes(run.status)) {
    if (Date.now() > until) throw new Error("Queue timed out");
    await delay(10);
  }
  assert.equal(
    run.status,
    "completed",
    JSON.stringify(run.jobs.map((j) => j.error)),
  );
  assert.equal(run.jobs.length, 4);
  assert.equal(ids.size, 4);
  assert.ok(maxActive > 1);
  assert.equal(
    new Set(run.jobs.map((j) => j.metadata.providerRequestId)).size,
    4,
  );
  for (const job of run.jobs) {
    assert.equal(job.metadata.model, "fal-ai/flux/schnell");
    assert.equal(job.metadata.seedMode, "parameter");
    assert.equal(
      (
        await sharp(
          path.join(f.dataRoot, "runs", run.id, job.id, "output.png"),
        ).metadata()
      ).format,
      "png",
    );
  }
  const records = await assets.list({ runId: run.id });
  assert.equal(records.length, 8);
  const finals = records.filter((asset) => asset.origin.role === "final");
  assert.equal(finals.length, 4);
  assert.ok(
    finals.every((asset) =>
      asset.parents.some((parent) => parent.role === "provider-original"),
    ),
  );
  for (const asset of records) {
    assert.equal(asset.provenance.requested.providerId, "fal-image");
    assert.ok(asset.provenance.providerRequestId);
  }
});

test("agent workflow recipes choose usable fal defaults and retain comparison overrides", () => {
  const image = createImageWorkflow({
    providerId: "fal-image",
    prompt: "A runner",
  });
  const generated = image.nodes.find((n) => n.type === "generate").data;
  assert.equal(generated.quality, "auto");
  assert.equal(generated.model, "bytedance/seedream/v5/flash/text-to-image");
  const editing = createImageWorkflow({
    providerId: "fal-image",
    prompt: "Recolor",
    images: ["/files/uploads/seed.png"],
  });
  assert.equal(
    editing.nodes.find((n) => n.type === "generate").data.model,
    "bytedance/seedream/v5/flash/edit",
  );
  const video = createVideoWorkflow({
    providerId: "fal-video",
    prompt: "Animate",
    images: ["/files/uploads/seed.png"],
  });
  const data = video.nodes.find((n) => n.type === "video-generate").data;
  assert.equal(data.model, "bytedance/seedance-2.5/image-to-video");
  assert.equal(data.ratio, "auto");
  assert.equal(data.video.durationSeconds, 8);
  assert.doesNotThrow(() => planWorkflow(video));
});
