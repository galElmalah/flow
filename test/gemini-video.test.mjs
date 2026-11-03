import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  GeminiVideo,
  inspectVideo,
} from "../harness-integrations/gemini-video/index.mjs";
import { geminiVideoConnectionSchema } from "../shared/gemini-video.mjs";

// Actual 16×16 H.264 one-frame MP4, embedded so tests need no ffmpeg/network.
const clip = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMUbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAj90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG3bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABYm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAAg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABYoAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAALFAAAAAQAAABRzdGNvAAAAAAAAAAEAAANEAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMgAAAAhmcmVlAAACzW1kYXQAAAKtBgX//6ncRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABBliIQAFf/+98nvwKbr29+B",
  "base64",
);
const completed = (id = "v1_fixture") => ({
  id,
  status: "completed",
  steps: [
    {
      type: "model_output",
      content: [
        {
          type: "video",
          mime_type: "video/mp4",
          data: clip.toString("base64"),
        },
      ],
    },
  ],
});
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function setup(t, fetcher, options = {}) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "weft-gemini-video-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const env = { GEMINI_API_KEY: "secret-api-key-never-public", ...options.env };
  const provider = new GeminiVideo({
    dataRoot,
    fetch: fetcher,
    pollIntervalMs: 0,
    env,
    ...options,
  });
  const job = {
    prompt: "A cycling athlete in monochrome",
    model: "gemini-omni-1.1-flash",
    ratio: "16:9",
    video: { resolution: "360p" },
  };
  const checkpoints = [];
  const context = {
    job,
    directory: path.join(dataRoot, "output"),
    imagePaths: [],
    signal: new AbortController().signal,
    checkpoint: async (event) => {
      checkpoints.push(structuredClone(event));
      job.providerOperation = event.providerOperation;
    },
  };
  return { provider, context, checkpoints, dataRoot, env };
}

test("native video submits once, checkpoints real phases, and writes a verified MP4", async (t) => {
  const calls = [];
  const responses = [
    json({ id: "v1_fixture", status: "queued" }),
    json({ id: "v1_fixture", status: "in_progress" }),
    json(completed()),
  ];
  const { provider, context, checkpoints, dataRoot } = await setup(
    t,
    async (url, options) => {
      calls.push({ url, ...options });
      return responses.shift();
    },
  );
  const seed = path.join(dataRoot, "seed.png");
  await sharp({
    create: { width: 16, height: 16, channels: 3, background: "black" },
  })
    .png()
    .toFile(seed);
  context.imagePaths = [seed];
  const output = await provider.run(context);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, "POST");
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body.response_format, {
    type: "video",
    aspect_ratio: "16:9",
    resolution: "360p",
  });
  assert.equal(body.input[1].mime_type, "image/png");
  assert.equal(Object.hasOwn(body, "duration"), false);
  assert.equal(
    calls[0].headers["x-goog-api-key"],
    "secret-api-key-never-public",
  );
  assert.equal(checkpoints[0].providerOperation.state, "submitting");
  assert.equal(checkpoints[1].providerOperation.id, "v1_fixture");
  assert.ok(
    checkpoints.some((event) => event.message === "Video queued at Google…"),
  );
  assert.ok(
    checkpoints.some(
      (event) => event.message === "Google is generating the video…",
    ),
  );
  assert.equal(checkpoints.at(-1).message, "Saving generated video…");
  assert.deepEqual(await readFile(output.path), clip);
  assert.equal(output.kind, "video");
  assert.equal(output.metadata.width, 16);
  assert.equal(output.metadata.height, 16);
  assert.equal(
    JSON.stringify({ output, checkpoints }).includes("secret-api-key"),
    false,
  );
});

test("accepted interaction resumes after restart without a second POST", async (t) => {
  let submissions = 0;
  const first = await setup(t, async (_url, options) => {
    if (options.method === "POST") {
      submissions++;
      return json({ id: "v1_resume", status: "queued" });
    }
    throw new Error("transient upstream secret-api-key-never-public");
  });
  await assert.rejects(
    first.provider.run(first.context),
    /could not reach Google/,
  );
  assert.equal(first.context.job.providerOperation.id, "v1_resume");
  const restarted = new GeminiVideo({
    dataRoot: first.dataRoot,
    env: first.env,
    pollIntervalMs: 0,
    fetch: async (url, options) => {
      assert.equal(options.method, "GET");
      assert.ok(url.includes("v1_resume"));
      return json(completed("v1_resume"));
    },
  });
  await restarted.run(first.context);
  assert.equal(submissions, 1);
  first.context.job.prompt = "changed inputs";
  await assert.rejects(
    restarted.run(first.context),
    /uncertain outcome or changed inputs/,
  );
});

test("ambiguous submission blocks replay, explicit rejection permits credential retry", async (t) => {
  let calls = 0;
  const ambiguous = await setup(t, async () => {
    calls++;
    throw new Error("network key=secret-api-key-never-public");
  });
  await assert.rejects(
    ambiguous.provider.run(ambiguous.context),
    /could not reach Google/,
  );
  assert.equal(ambiguous.context.job.providerOperation.state, "submitting");
  await assert.rejects(
    ambiguous.provider.run(ambiguous.context),
    /uncertain outcome/,
  );
  assert.equal(calls, 1);
  let denied = true;
  const rejection = await setup(t, async () =>
    denied
      ? json({ error: { message: "echo secret-api-key-never-public" } }, 403)
      : json(completed()),
  );
  await assert.rejects(
    rejection.provider.run(rejection.context),
    (error) =>
      /credentials/.test(error.message) &&
      !error.message.includes("secret-api-key"),
  );
  assert.equal(rejection.context.job.providerOperation, null);
  await rejection.provider.configure({ apiKey: "replacement-key" });
  denied = false;
  await rejection.provider.run(rejection.context);
});

test("connection persists only privately; status and OAuth refresh never expose credentials", async (t) => {
  const fixture = await setup(
    t,
    () => {
      throw new Error("must not contact Google for status");
    },
    { env: {} },
  );
  assert.equal((await fixture.provider.status()).ready, false);
  const saved = await fixture.provider.configure({
    apiKey: "private-stored-key",
  });
  assert.equal(saved.ready, true);
  assert.equal(saved.authenticated, null);
  assert.equal(JSON.stringify(saved).includes("private-stored-key"), false);
  assert.equal(
    (await stat(path.join(fixture.dataRoot, "gemini-video.json"))).mode & 0o777,
    0o600,
  );
  await fixture.provider.configure({ apiKey: null });
  assert.equal((await fixture.provider.status()).ready, false);
  await assert.rejects(fixture.provider.run(fixture.context), /API key/);
  await assert.rejects(
    fixture.provider.configure({ endpoint: "https://evil.example" }),
    /Invalid/,
  );
  assert.equal(
    geminiVideoConnectionSchema.safeParse({ accessToken: "not-accepted" })
      .success,
    false,
  );

  let refreshes = 0,
    calls = 0;
  const oauth = new GeminiVideo({
    dataRoot: fixture.dataRoot,
    env: {},
    pollIntervalMs: 0,
    googleAuth: {
      getClient: async () => ({
        getRequestHeaders: async () =>
          new Headers({
            Authorization: `Bearer refreshed-private-token-${++refreshes}`,
          }),
      }),
    },
    fetch: async (_url, options) => {
      calls++;
      assert.match(
        options.headers.Authorization,
        /^Bearer refreshed-private-token-/,
      );
      assert.equal(
        options.headers["x-goog-user-project"],
        "fixture-quota-project",
      );
      return calls === 1
        ? json({ id: "v1_oauth", status: "queued" })
        : json(completed("v1_oauth"));
    },
  });
  await oauth.configure({
    authMode: "oauth-adc",
    quotaProject: "fixture-quota-project",
  });
  assert.equal((await oauth.status()).ready, true);
  await oauth.run(fixture.context);
  assert.ok(refreshes >= 3);
  assert.equal((await oauth.status()).authenticated, null);
});

test("video downloads allow only Google file/storage addresses and strip auth on storage redirects", async (t) => {
  const requests = [];
  const uri =
    "https://generativelanguage.googleapis.com/v1beta/files/video-fixture:download?alt=media";
  const { provider, context } = await setup(t, async (url, options) => {
    requests.push({ url, ...options });
    if (options.method === "POST")
      return json({
        id: "v1_fixture",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [{ type: "video", mime_type: "video/mp4", uri }],
          },
        ],
      });
    if (url === uri)
      return new Response(null, {
        status: 302,
        headers: {
          location:
            "https://storage.googleapis.com/fixture-bucket/video.mp4?signature=private",
        },
      });
    assert.deepEqual(options.headers, {});
    return new Response(clip, {
      headers: { "content-length": String(clip.length) },
    });
  });
  await provider.run(context);
  assert.equal(requests.length, 3);
  assert.ok(requests[1].headers["x-goog-api-key"]);
  for (const bad of [
    "http://storage.googleapis.com/x",
    "https://storage.googleapis.com.evil.example/x",
    "https://user:secret@storage.googleapis.com/x",
    "https://generativelanguage.googleapis.com/not-a-file",
    "https://127.0.0.1/video.mp4",
  ]) {
    await assert.rejects(
      provider.download(bad, context.signal),
      /unsupported video download address/,
    );
  }
  provider.fetch = async () =>
    new Response(clip, {
      headers: { "content-length": String(clip.length + 1) },
    });
  await assert.rejects(provider.download(uri, context.signal), /truncated/);
});

test("cancel, handoff, failed, invalid file and malicious IDs cannot become completed artifacts", async (t) => {
  for (const status of ["requires_action", "failed", "unknown_new_state"]) {
    const fixture = await setup(t, async () =>
      json({ id: "v1_fixture", status }),
    );
    await assert.rejects(
      fixture.provider.run(fixture.context),
      /additional action|ended with status|unsupported video operation status/,
    );
    assert.equal(fixture.context.job.providerOperation.id, "v1_fixture");
  }
  const malicious = await setup(t, async () =>
    json(completed("secret-api-key-never-public")),
  );
  await assert.rejects(
    malicious.provider.run(malicious.context),
    (error) =>
      !error.message.includes("secret-api-key") &&
      /operation ID/.test(error.message),
  );
  const invalid = await setup(t, async () =>
    json({
      ...completed(),
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "video",
              mime_type: "video/mp4",
              data: Buffer.from("not a movie").toString("base64"),
            },
          ],
        },
      ],
    }),
  );
  await assert.rejects(invalid.provider.run(invalid.context), /invalid MP4/);
  await assert.rejects(stat(path.join(invalid.dataRoot, "output/output.mp4")));
  const controller = new AbortController();
  const cancelled = await setup(t, async (_url, options) => {
    if (options.method === "POST") {
      controller.abort(new Error("secret cancellation reason"));
      return json({ id: "v1_fixture", status: "queued" });
    }
    throw new Error("unexpected");
  });
  cancelled.context.signal = controller.signal;
  await assert.rejects(
    cancelled.provider.run(cancelled.context),
    (error) => !error.message.includes("secret cancellation"),
  );
  assert.equal(cancelled.context.job.providerOperation.state, "submitting");
  assert.deepEqual(inspectVideo(clip), { width: 16, height: 16 });
});

test("ADC failures and malformed server payloads expose no identity, key, or token", async (t) => {
  const sdkSecret = "sensitive-account@example.test private-token";
  const fixture = await setup(
    t,
    async () => {
      throw new Error("must not submit");
    },
    {
      env: {},
      googleAuth: {
        getClient: async () => {
          throw new Error(sdkSecret);
        },
      },
    },
  );
  await fixture.provider.configure({
    authMode: "oauth-adc",
    quotaProject: "fixture-project",
  });
  await assert.rejects(
    fixture.provider.run(fixture.context),
    (error) =>
      /OAuth credentials/.test(error.message) &&
      !error.message.includes(sdkSecret),
  );
  const malformed = await setup(
    t,
    async () => new Response("not-json secret-api-key-never-public"),
  );
  await assert.rejects(
    malformed.provider.run(malformed.context),
    (error) =>
      /invalid video response/.test(error.message) &&
      !error.message.includes("secret-api-key"),
  );
  assert.equal(malformed.context.job.providerOperation.state, "submitting");
});
