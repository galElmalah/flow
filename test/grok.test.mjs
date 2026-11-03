import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import express from "express";
import { GrokMedia } from "../harness-integrations/grok/index.mjs";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { registerProviderRoutes } from "../server/routes/providers.mjs";

const secret = "xai-private-fixture-key";
const root = path.resolve(import.meta.dirname, "..");
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
async function setup(
  t,
  fetcher,
  { env = { XAI_API_KEY: secret }, kind = "image" } = {},
) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "flow-grok-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const grok = new GrokMedia({
    dataRoot,
    env,
    fetch: fetcher,
    pollIntervalMs: 0,
  });
  const job = {
    providerId: `grok-${kind}`,
    kind,
    model:
      kind === "image" ? "grok-imagine-image-2.0" : "grok-imagine-video-1.5",
    prompt: "Monochrome athlete",
    ratio: "16:9",
    quality: "medium",
    images: [],
    seed: 42,
  };
  const checkpoints = [];
  const context = {
    job,
    directory: path.join(dataRoot, "output"),
    imagePaths: [],
    signal: new AbortController().signal,
    checkpoint: async (event) => {
      checkpoints.push(structuredClone(event));
      if (event.providerOperation === null) delete job.providerOperation;
      else if (event.providerOperation !== undefined)
        job.providerOperation = structuredClone(event.providerOperation);
    },
  };
  return { grok, job, context, checkpoints, dataRoot };
}
const png = () =>
  sharp({
    create: { width: 32, height: 24, channels: 3, background: "#888888" },
  })
    .png()
    .toBuffer();

test("Grok image posts JSON edits with ordered images, deferred resume, and actual provenance", async (t) => {
  const image = await png(),
    calls = [];
  const fixture = await setup(t, async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === "POST") return json({ request_id: "image_request" });
    if (url.endsWith("/images/image_request"))
      return json({
        request_id: "image_request",
        status: "done",
        model: "grok-imagine-image-2.0-2026-08",
        quality: "medium",
        data: [
          {
            url: "https://imgen.x.ai/output.png",
            revised_prompt: "Provider revised description",
          },
        ],
        usage: {
          cost_in_usd_ticks: 400000000,
          input_tokens: 10,
          ignored_private_text: secret,
        },
      });
    assert.deepEqual(options.headers, {});
    return new Response(image);
  });
  const seed1 = path.join(fixture.dataRoot, "first.png"),
    seed2 = path.join(fixture.dataRoot, "second.jpg");
  await sharp(image).toFile(seed1);
  await sharp(image).jpeg().toFile(seed2);
  fixture.context.imagePaths = [seed1, seed2];
  fixture.job.image = { resolution: "1.5k" };
  const result = await fixture.grok.run(fixture.context);
  assert.equal(calls[0].url, "https://api.x.ai/v1/images/edits");
  const body = JSON.parse(calls[0].body);
  assert.equal(body.deferred, true);
  assert.equal(body.n, 1);
  assert.equal(body.response_format, "url");
  assert.equal(body.aspect_ratio, "16:9");
  assert.equal(body.resolution, "1.5k");
  assert.ok(body.images[0].url.startsWith("data:image/png;base64,"));
  assert.ok(body.images[1].url.startsWith("data:image/jpeg;base64,"));
  assert.equal(Object.hasOwn(body, "image"), false);
  assert.equal(Object.hasOwn(body, "seed"), false);
  assert.equal(calls[0].headers.Authorization, `Bearer ${secret}`);
  assert.equal(result.kind, "image");
  assert.equal(result.metadata.seedMode, "unsupported");
  assert.equal(result.metadata.actualModel, "grok-imagine-image-2.0-2026-08");
  assert.equal(result.metadata.requestedModel, fixture.job.model);
  assert.equal(result.metadata.providerRequestId, "image_request");
  assert.deepEqual(result.metadata.usage, {
    cost_in_usd_ticks: 400000000,
    input_tokens: 10,
  });
  assert.equal(result.metadata.effectiveSettings.mode, "edit");
  assert.equal(result.metadata.revisedPrompt, "Provider revised description");
  assert.deepEqual(await readFile(result.path), image);
  assert.equal(fixture.checkpoints[0].providerOperation.state, "submitting");
  assert.equal(fixture.checkpoints[1].providerOperation.id, "image_request");
  assert.ok(
    !JSON.stringify({ result, checkpoints: fixture.checkpoints }).includes(
      secret,
    ),
  );
});

test("accepted image request survives a connection failure without duplicate paid POST", async (t) => {
  let posts = 0;
  const fixture = await setup(t, async (_url, options) => {
    if (options.method === "POST") {
      posts++;
      return json({ request_id: "resume_image" });
    }
    throw new Error(`network ${secret}`);
  });
  await assert.rejects(
    fixture.grok.run(fixture.context),
    /could not be reached/,
  );
  assert.equal(fixture.job.providerOperation.state, "accepted");
  const image = await png();
  const restarted = new GrokMedia({
    dataRoot: fixture.dataRoot,
    env: { XAI_API_KEY: secret },
    pollIntervalMs: 0,
    fetch: async (url, options) => {
      assert.notEqual(options.method, "POST");
      return url.startsWith("https://api.x.ai")
        ? json({
            request_id: "resume_image",
            status: "done",
            data: [{ url: "https://imgen.x.ai/resume.png" }],
          })
        : new Response(image);
    },
  });
  const resumedResult = await restarted.run(fixture.context);
  assert.equal(Object.hasOwn(resumedResult.metadata, "actualModel"), false);
  assert.equal(Object.hasOwn(resumedResult.metadata, "usage"), false);
  assert.equal(Object.hasOwn(resumedResult.metadata, "actualQuality"), false);
  assert.equal(posts, 1);
  fixture.job.prompt = "Changed request";
  await assert.rejects(
    restarted.run(fixture.context),
    /uncertain outcome or changed inputs/,
  );
});

test("ambiguous image submission blocks replay, explicit rejection clears receipt safely", async (t) => {
  let posts = 0;
  const fixture = await setup(t, async () => {
    posts++;
    throw new Error(secret);
  });
  await assert.rejects(
    fixture.grok.run(fixture.context),
    (error) => !error.message.includes(secret),
  );
  assert.equal(fixture.job.providerOperation.state, "submitting");
  await assert.rejects(fixture.grok.run(fixture.context), /uncertain outcome/);
  assert.equal(posts, 1);
  fixture.grok.fetch = async () => json({ error: { message: secret } }, 403);
  delete fixture.job.providerOperation;
  await assert.rejects(
    fixture.grok.run(fixture.context),
    (error) => /API key/.test(error.message) && !error.message.includes(secret),
  );
  assert.equal(fixture.job.providerOperation, undefined);
});

test("native Grok video persists real progress and uses pinned input framing", async (t) => {
  const clip = await readFile(
    new URL("./fixtures/tiny-video.mp4", import.meta.url),
  );
  const calls = [],
    responses = [
      json({ request_id: "video_request" }),
      json({ status: "pending", progress: 37 }),
      json({
        status: "done",
        progress: 100,
        model: "grok-imagine-video-1.5",
        video: {
          url: "https://vidgen.x.ai/movie.mp4",
          duration: 5,
          respect_moderation: true,
        },
      }),
    ];
  const fixture = await setup(
    t,
    async (url, options) => {
      calls.push({ url, ...options });
      return url.startsWith("https://api.x.ai")
        ? responses.shift()
        : new Response(clip);
    },
    { kind: "video" },
  );
  const seed = path.join(fixture.dataRoot, "seed.png");
  await sharp(await png()).toFile(seed);
  fixture.context.imagePaths = [seed];
  fixture.job.video = { durationSeconds: 5, resolution: "1080p" };
  const result = await fixture.grok.run(fixture.context);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.duration, 5);
  assert.ok(body.image.url.startsWith("data:image/png;base64,"));
  assert.equal(Object.hasOwn(body, "aspect_ratio"), false);
  assert.equal(Object.hasOwn(body, "reference_images"), false);
  assert.equal(result.metadata.effectiveSettings.aspectRatioMode, "from-input");
  assert.equal(result.metadata.effectiveSettings.mode, "image");
  assert.equal(result.metadata.durationSeconds, 5);
  assert.equal(result.metadata.width, 16);
  assert.equal(
    fixture.checkpoints.find(
      (event) => event.providerOperation?.progress === 37,
    ).message,
    "Grok is generating the video · 37%",
  );
  assert.deepEqual(await readFile(result.path), clip);
});

test("Grok capabilities reject unsupported quality, conflicting modes, excess references and invalid settings", async (t) => {
  const { grok, job } = await setup(t, () => {
    throw new Error("no network expected");
  });
  assert.throws(
    () => grok.preflight({ ...job, quality: "high" }),
    /High is not supported/,
  );
  assert.throws(() => grok.preflight(job, 6), /at most 5/);
  assert.equal(grok.preflight(job, 5).settings.mode, "edit");
  assert.throws(
    () => grok.preflight({ ...job, image: { resolution: "8k" } }),
    /image resolution/,
  );
  const video = {
    ...job,
    kind: "video",
    model: "grok-imagine-video-1.5",
    video: { mode: "text" },
  };
  assert.throws(() => grok.preflight(video, 1), /must match its inputs/);
  assert.throws(
    () =>
      grok.preflight(
        { ...video, video: { mode: "reference", resolution: "1080p" } },
        2,
      ),
    /up to 720p/,
  );
  assert.throws(
    () => grok.preflight({ ...video, video: { durationSeconds: 16 } }),
    /1 to 15/,
  );
  assert.throws(
    () =>
      grok.preflight(
        {
          ...video,
          model: "grok-imagine-video-1.5-lite",
          video: { mode: "reference" },
        },
        2,
      ),
    /at most 1|does not support/,
  );
  const reference = grok.preflight({ ...video, video: {} }, 2);
  assert.equal(reference.settings.mode, "reference");
  assert.equal(reference.settings.durationSeconds, 8);
});

test("Grok downloads constrain hosts/redirects, strip credentials and reject invalid media/moderation", async (t) => {
  const fixture = await setup(t, async () => {
    throw new Error("must not fetch");
  });
  for (const url of [
    "http://imgen.x.ai/a",
    "https://imgen.x.ai.evil.example/a",
    "https://user:pass@imgen.x.ai/a",
    "https://127.0.0.1/a",
    "https://imgen.x.ai:8443/a",
  ])
    await assert.rejects(
      fixture.grok.download(url, "image"),
      /unsupported media download/,
    );
  fixture.grok.fetch = async (_url, options) => {
    assert.deepEqual(options.headers, {});
    return new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/private" },
    });
  };
  await assert.rejects(
    fixture.grok.download("https://imgen.x.ai/a", "image"),
    /unsupported media download/,
  );
  fixture.grok.fetch = async (url, options) =>
    options.method === "POST"
      ? json({ request_id: "filtered" })
      : json({
          status: "done",
          data: [{ url: "https://imgen.x.ai/a", respect_moderation: false }],
        });
  await assert.rejects(fixture.grok.run(fixture.context), /filtered/);
  delete fixture.job.providerOperation;
  fixture.grok.fetch = async (url, options) =>
    options.method === "POST"
      ? json({ request_id: "bad_file" })
      : url.startsWith("https://api.x.ai")
        ? json({ status: "done", data: [{ url: "https://imgen.x.ai/a" }] })
        : new Response("not an image");
  await assert.rejects(
    fixture.grok.run(fixture.context),
    /invalid image artifact/,
  );
  await assert.rejects(
    stat(path.join(fixture.context.directory, "grok-original")),
  );
});

test("Grok connection stores keys privately and serves secret-free catalog/setup DTOs", async (t) => {
  const { grok, dataRoot } = await setup(
    t,
    () => {
      throw new Error("status must not submit inference");
    },
    { env: {} },
  );
  assert.equal((await grok.status()).configured, false);
  assert.equal((await grok.configure({ apiKey: secret })).ready, true);
  assert.equal(
    (await stat(path.join(dataRoot, "grok.json"))).mode & 0o777,
    0o600,
  );
  await assert.rejects(
    async () => grok.configure({ endpoint: "https://evil.example" }),
    /Invalid Grok/,
  );
  const registry = new ProviderRegistry({
    root,
    dataRoot,
    grok,
    definitions: [],
    codexHealth: async () => ({ ready: false, auth: "fixture" }),
  });
  await registry.reload();
  const app = express();
  app.use(express.json());
  registerProviderRoutes(app, {
    root,
    dataRoot,
    providers: registry,
    queue: { concurrency: 4, active: new Map() },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(`${base}/api/providers/grok`).then((r) =>
    r.json(),
  );
  assert.equal(status.authenticated, null);
  const catalog = await fetch(`${base}/api/providers`).then((r) => r.json());
  assert.ok(
    catalog
      .find((p) => p.id === "grok-image")
      .modelDetails[0].qualities.includes("medium"),
  );
  assert.ok(
    catalog
      .find((p) => p.id === "grok-video")
      .modelDetails.some((model) => model.videoModes.includes("reference")),
  );
  assert.ok(!JSON.stringify({ status, catalog }).includes(secret));
  const cleared = await fetch(`${base}/api/providers/grok`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: null }),
  }).then((r) => r.json());
  assert.equal(cleared.ready, false);
});

test("Grok registry retains actual provider metadata while normalizing final image output", async (t) => {
  const image = await png();
  const fixture = await setup(t, async (url, options) =>
    options.method === "POST"
      ? json({ request_id: "registry_image" })
      : url.startsWith("https://api.x.ai")
        ? json({
            request_id: "registry_image",
            status: "done",
            model: "grok-imagine-image-2.0-actual",
            data: [{ url: "https://imgen.x.ai/image.jpg" }],
          })
        : new Response(image),
  );
  const registry = new ProviderRegistry({
    root,
    dataRoot: fixture.dataRoot,
    grok: fixture.grok,
    definitions: [],
    codexHealth: async () => ({ ready: false, auth: "fixture" }),
  });
  await registry.reload();
  const result = await registry.run(fixture.context);
  assert.equal(result.path, path.join(fixture.context.directory, "output.png"));
  assert.equal((await sharp(result.path).metadata()).format, "png");
  assert.equal(result.metadata.actualModel, "grok-imagine-image-2.0-actual");
  assert.equal(result.metadata.seedMode, "unsupported");
  assert.equal(result.metadata.providerRequestId, "registry_image");
  assert.ok(result.metadata.originalFile.endsWith(".png"));
});

test("explicit reference video preserves input order and accepted video resumes without a new POST", async (t) => {
  let postBody,
    posts = 0;
  const fixture = await setup(
    t,
    async (_url, options) => {
      if (options.method === "POST") {
        posts++;
        postBody = JSON.parse(options.body);
        return json({ request_id: "reference_resume" });
      }
      throw new Error(`upstream ${secret}`);
    },
    { kind: "video" },
  );
  const seed1 = path.join(fixture.dataRoot, "a.png"),
    seed2 = path.join(fixture.dataRoot, "b.jpg");
  const image = await png();
  await sharp(image).toFile(seed1);
  await sharp(image).jpeg().toFile(seed2);
  fixture.context.imagePaths = [seed1, seed2];
  fixture.job.video = {
    mode: "reference",
    durationSeconds: 6,
    resolution: "720p",
  };
  await assert.rejects(
    fixture.grok.run(fixture.context),
    /could not be reached/,
  );
  assert.equal(postBody.aspect_ratio, "16:9");
  assert.equal(postBody.reference_images.length, 2);
  assert.ok(postBody.reference_images[0].url.startsWith("data:image/png;"));
  assert.ok(postBody.reference_images[1].url.startsWith("data:image/jpeg;"));
  assert.equal(Object.hasOwn(postBody, "image"), false);
  const clip = await readFile(
    new URL("./fixtures/tiny-video.mp4", import.meta.url),
  );
  const resumed = new GrokMedia({
    dataRoot: fixture.dataRoot,
    env: { XAI_API_KEY: secret },
    pollIntervalMs: 0,
    fetch: async (url, options) => {
      assert.notEqual(options.method, "POST");
      return url.startsWith("https://api.x.ai")
        ? json({
            status: "done",
            video: { url: "https://vidgen.x.ai/resume.mp4" },
          })
        : new Response(clip);
    },
  });
  const result = await resumed.run(fixture.context);
  assert.equal(result.metadata.effectiveSettings.mode, "reference");
  assert.equal(posts, 1);
});

test("Grok cannot submit before a durable checkpoint or expose malformed operation errors", async (t) => {
  let posts = 0;
  const fixture = await setup(t, async () => {
    posts++;
    return json({ request_id: "accepted" });
  });
  fixture.context.checkpoint = async () => {
    throw new Error(`storage ${secret}`);
  };
  await assert.rejects(
    fixture.grok.run(fixture.context),
    (error) =>
      /failed locally/.test(error.message) && !error.message.includes(secret),
  );
  assert.equal(posts, 0);
  fixture.context.checkpoint = async (event) => {
    fixture.job.providerOperation = event.providerOperation;
  };
  fixture.grok.fetch = async () => json({ request_id: secret });
  await assert.rejects(
    fixture.grok.run(fixture.context),
    (error) =>
      /operation ID/.test(error.message) && !error.message.includes(secret),
  );
  assert.equal(fixture.job.providerOperation.state, "submitting");
  delete fixture.job.providerOperation;
  fixture.grok.fetch = async () => new Response(`not json ${secret}`);
  await assert.rejects(
    fixture.grok.run(fixture.context),
    (error) =>
      /invalid operation response/.test(error.message) &&
      !error.message.includes(secret),
  );
});
