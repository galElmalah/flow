import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { Store } from "../server/store.mjs";
import { Queue } from "../server/queue.mjs";
import { planWorkflow } from "../server/graph.mjs";
import { capture } from "../harness-integrations/shared/process.mjs";
import { invocation as codexInvocation } from "../harness-integrations/codex/text-stream.mjs";
import * as claude from "../harness-integrations/claude-code/index.mjs";
import * as gemini from "../harness-integrations/gemini/index.mjs";
import * as pi from "../harness-integrations/pi/index.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn) {
  const end = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("Timed out");
    await sleep(5);
  }
}
const node = (id, type, data = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, ...data },
});
const edge = (source, target, type = "text") => ({
  id: source + "-" + target,
  source,
  target,
  targetHandle: type,
});
function graph() {
  return {
    id: "typed",
    name: "Typed flow",
    nodes: [
      node("brief", "prompt", { text: "BRIEF" }),
      node("writer", "prompt-generate", {
        text: "WRITE",
        providerId: "codex-text",
      }),
      node("literal", "prompt", { text: "AFTER" }),
      node("rewrite", "prompt-generate", {
        text: "REWRITE",
        providerId: "claude-code",
      }),
      node("image", "generate", { count: 3 }),
    ],
    edges: [
      edge("brief", "writer"),
      edge("writer", "literal"),
      edge("literal", "rewrite"),
      edge("rewrite", "image"),
    ],
  };
}
async function root(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "flow-prompts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test("generated prompts preserve order and lineage, retry reuses saved text, restart preserves both result kinds", async (t) => {
  const dir = await root(t),
    store = new Store(dir);
  await store.init();
  let fail = true;
  const calls = [];
  const q = new Queue(store, {
    resolveAsset: (x) => x,
    adapter: async ({ job }) => {
      calls.push([job.nodeId, job.prompt]);
      if (job.kind === "text")
        return {
          kind: "text",
          text: job.nodeId === "writer" ? "FIRST" : "FINAL",
        };
      if (fail) throw new Error("temporary image failure");
      return { kind: "image" };
    },
  });
  const plan = planWorkflow(graph());
  assert.equal(plan.textJobs, 2);
  assert.equal(plan.imageJobs, 3);
  assert.equal(plan.jobs[1].dependencies[0], plan.jobs[0].id);
  const run = await q.create(graph());
  await wait(() => run.status === "failed" && !q.active.size);
  assert.deepEqual(calls.slice(0, 2), [
    ["writer", "BRIEF\n\nWRITE"],
    ["rewrite", "FIRST\n\nAFTER\n\nREWRITE"],
  ]);
  assert.equal(run.jobs[0].resultText, "FIRST");
  assert.equal(run.jobs[0].output, undefined);
  fail = false;
  q.action(run.id, "retry");
  await wait(() => run.status === "completed" && !q.active.size);
  await store.flush();
  assert.equal(calls.filter(([n]) => n === "writer").length, 1);
  assert.equal(calls.filter(([n]) => n === "rewrite").length, 1);
  assert.ok(
    calls.filter(([n]) => n === "image").every(([, p]) => p === "FINAL"),
  );
  const restored = new Store(dir);
  await restored.init();
  assert.equal(restored.runs.get(run.id).jobs[1].resultText, "FINAL");
  assert.equal(
    await readFile(
      path.join(dir, "runs", run.id, run.jobs[0].id, "output.txt"),
      "utf8",
    ),
    "FIRST",
  );
});
test("text failures block descendants; image references pass through AI prompt nodes", async (t) => {
  const dir = await root(t),
    store = new Store(dir);
  await store.init();
  const g = graph();
  g.nodes.unshift(node("seed", "image", { images: ["/seed.png"] }));
  g.edges.push(edge("seed", "writer", "image"));
  const plan = planWorkflow(g);
  assert.deepEqual(plan.jobs.at(-1).images, [{ asset: "/seed.png" }]);
  const q = new Queue(store, {
      resolveAsset: (x) => x,
      adapter: async () => {
        throw new Error("writer failed");
      },
    }),
    run = await q.create(g);
  await wait(() => run.status === "failed" && !q.active.size);
  assert.equal(run.jobs[0].status, "failed");
  assert.ok(run.jobs.slice(1).every((j) => j.status === "blocked"));
  await q.stop();
  await store.close();
});
test("compatible connection persists write-only credentials, supports text and redacts upstream errors", async (t) => {
  const dir = await root(t),
    secret = "flow-canary-private-key";
  let body, auth;
  const server = http.createServer(async (req, res) => {
    let input = "";
    for await (const part of req) input += part;
    auth = req.headers.authorization;
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/models"))
      return res.end(JSON.stringify({ data: [{ id: "writer" }] }));
    body = JSON.parse(input);
    if (body.model === "error") {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { message: secret } }));
    }
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "A violet paper gradient" } }],
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const registry = new ProviderRegistry({
    root: dir,
    dataRoot: dir,
    codexHealth: async () => ({ ready: false, signedIn: false }),
  });
  await registry.reload();
  const edit = {
    name: "Fixture",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    models: [
      { id: "writer", capabilities: ["text"], acceptsImages: true },
      { id: "error", capabilities: ["text"], acceptsImages: false },
    ],
    apiKey: { action: "replace", value: secret },
  };
  const catalog = await registry.saveConnection(null, edit),
    p = catalog.find((p) => p.managed);
  assert.ok(p.hasApiKey);
  assert.ok(!JSON.stringify(catalog).includes(secret));
  assert.equal(
    (await stat(path.join(dir, "connections.json"))).mode & 0o777,
    0o600,
  );
  assert.equal((await registry.testConnection(p.id)).models[0], "writer");
  const context = {
    job: {
      kind: "text",
      providerId: p.id,
      model: "writer",
      prompt: "Create a paper study",
      images: [],
    },
    imagePaths: [],
    directory: dir,
    signal: new AbortController().signal,
  };
  assert.equal((await registry.run(context)).text, "A violet paper gradient");
  assert.equal(auth, "Bearer " + secret);
  assert.equal(body.messages[0].content, "Create a paper study");
  await assert.rejects(
    () => registry.run({ ...context, job: { ...context.job, model: "error" } }),
    (e) => e.message.includes("[redacted]") && !e.message.includes(secret),
  );
  await assert.rejects(
    () =>
      registry.saveConnection(p.id, {
        ...edit,
        baseUrl: "https://other.example/v1",
        apiKey: { action: "keep" },
      }),
    /new API key/,
  );
  await registry.saveConnection(p.id, { ...edit, apiKey: { action: "keep" } });
  await registry.reload();
  assert.ok((await registry.catalog()).find((x) => x.id === p.id).hasApiKey);
  await registry.saveConnection(p.id, { ...edit, apiKey: { action: "clear" } });
  assert.equal(
    (await registry.catalog()).find((x) => x.id === p.id).hasApiKey,
    false,
  );
  await assert.rejects(
    () =>
      registry.preflight([
        { kind: "image", providerId: p.id, model: "writer", images: [] },
      ]),
    /Model/,
  );
  await registry.removeConnection(p.id);
  assert.ok(!(await registry.catalog()).some((x) => x.id === p.id));
});
test("four harness presets use fixed argv and parse only final responses; subprocess is bounded and cancellable", async (t) => {
  const dir = await root(t),
    context = {
      job: { prompt: "literal $(echo BAD) `code`", model: "default" },
      directory: dir,
      imagePaths: [],
    };
  for (const build of [
    codexInvocation,
    claude.invocation,
    gemini.invocation,
    pi.invocation,
  ]) {
    const invocation = build(context);
    assert.ok(invocation.input.includes("$(echo BAD)"));
    assert.ok(!invocation.args.some((a) => a.includes("$(echo BAD)")));
  }
  assert.equal(claude.parse('{"result":"CLAUDE"}'), "CLAUDE");
  assert.equal(gemini.parse('{"response":"GEMINI"}'), "GEMINI");
  assert.equal(pi.parse("PI"), "PI");
  assert.throws(() => gemini.parse("null"), /invalid final-answer JSON/);
  assert.throws(
    () =>
      claude.parse('{"is_error":true,"result":"failed"}'),
    /failed/,
  );
  const file = path.join(dir, "fixture.mjs");
  await writeFile(
    file,
    'let text="";for await(const x of process.stdin)text+=x;process.stdout.write(text);',
  );
  assert.equal(
    (
      await capture(process.execPath, [file], {
        directory: dir,
        input: context.job.prompt,
      })
    ).stdout,
    context.job.prompt,
  );
  await assert.rejects(
    () =>
      capture(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        directory: dir,
        timeoutMs: 20,
      }),
    /timed out/,
  );
  await assert.rejects(
    () =>
      capture(
        process.execPath,
        ["-e", 'process.stdout.write("x".repeat(10000))'],
        { directory: dir, maxBytes: 100 },
      ),
    /exceeded/,
  );
  const controller = new AbortController();
  const pending = capture(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { directory: dir, signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(() => pending, /Cancelled/);
});

test("resuming a mixed run after restart reuses the completed prompt instead of calling its harness again", async (t) => {
  const dir = await root(t),
    store = new Store(dir);
  await store.init();
  let queue;
  queue = new Queue(store, {
    resolveAsset: (x) => x,
    adapter: async () => {
      queue.action([...store.runs.keys()][0], "pause");
      return { kind: "text", text: "SAVED BEFORE RESTART" };
    },
  });
  const first = await queue.create(graph());
  await wait(() => first.jobs[0].status === "completed" && !queue.active.size);
  await store.flush();
  const restored = new Store(dir);
  await restored.init();
  const run = restored.runs.get(first.id),
    calls = [];
  const resumed = new Queue(restored, {
    resolveAsset: (x) => x,
    adapter: async ({ job }) => {
      calls.push(job.nodeId);
      return job.kind === "text"
        ? { kind: "text", text: job.prompt }
        : { kind: "image" };
    },
  });
  resumed.action(run.id, "resume");
  await wait(() => run.status === "completed" && !resumed.active.size);
  await restored.flush();
  assert.ok(!calls.includes("writer"));
  assert.ok(run.jobs[1].resultText.startsWith("SAVED BEFORE RESTART"));
});
