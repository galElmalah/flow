import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Store } from "../server/store.mjs";
import { Queue } from "../server/queue.mjs";
import { starter } from "./fixtures/paper-workflow.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn) {
  const end = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("Timed out");
    await sleep(5);
  }
}
async function setup(t, adapter, concurrency = 4) {
  const root = await mkdtemp(path.join(tmpdir(), "flow-test-"));
  const store = new Store(root);
  await store.init();
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#789" },
  })
    .png()
    .toBuffer();
  const reference = path.join(root, "uploads", "seed.png");
  await writeFile(reference, png);
  const queue = new Queue(store, {
    adapter: async (context) => {
      const result = await adapter(context);
      await writeFile(path.join(context.directory, "output.png"), png);
      return result;
    },
    concurrency,
    resolveAsset: () => reference,
  });
  t.after(async () => {
    await waitFor(() => queue.active.size === 0);
    await store.flush();
    await rm(root, { recursive: true, force: true });
  });
  return { store, queue, reference, png };
}
test("100 jobs finish, never exceeding the parallel job limit, and restore from disk", async (t) => {
  let active = 0,
    peak = 0;
  const gate = Promise.withResolvers();
  const { store, queue } = await setup(t, async () => {
    active++;
    peak = Math.max(peak, active);
    assert.ok(active <= 4);
    await gate.promise;
    active--;
  });
  const run = await queue.create(structuredClone(starter));
  try {
    await waitFor(() => active === 4);
  } finally {
    gate.resolve();
  }
  await waitFor(() => run.status === "completed");
  await store.flush();
  assert.equal(run.jobs.filter((j) => j.status === "completed").length, 100);
  assert.equal(peak, 4);
  const restored = new Store(store.root);
  await restored.init();
  assert.equal(restored.runs.get(run.id).status, "completed");
  assert.equal(restored.runs.get(run.id).jobs.length, 100);
});
test("parallel settings belong to each run and a small run cannot throttle another", async (t) => {
  const gate = Promise.withResolvers();
  const { queue, store } = await setup(t, () => gate.promise);
  const smallGraph = structuredClone(starter);
  smallGraph.nodes.find((n) => n.type === "generate").data.count = 4;
  const small = await queue.create(smallGraph, { count: 4 }, undefined, {
    concurrency: 1,
  });
  const large = await queue.create(
    structuredClone(starter),
    { count: 16 },
    undefined,
    { concurrency: 8 },
  );
  try {
    await waitFor(() => queue.active.size === 8);
    const activeFor = (run) =>
      [...queue.active.values()].filter((entry) => entry.runId === run.id)
        .length;
    assert.equal(activeFor(small), 1);
    assert.equal(activeFor(large), 7);
    assert.equal(queue.concurrency, 4);
    assert.equal(store.runs.get(small.id).concurrency, 1);
    assert.equal(store.runs.get(large.id).concurrency, 8);
  } finally {
    gate.resolve();
  }
  await waitFor(
    () => small.status === "completed" && large.status === "completed",
  );
});
test("downstream jobs wait for generated references; failed parents block children and retry succeeds", async (t) => {
  let fail = true;
  const done = new Set();
  const { queue } = await setup(t, async ({ job }) => {
    if (job.nodeId === "generate" && fail)
      throw new Error("Temporary harness failure");
    for (const dep of job.dependencies) assert.ok(done.has(dep));
    done.add(job.id);
  });
  const g = structuredClone(starter);
  g.nodes.find((n) => n.id === "variations").data.lines = "one direction";
  g.nodes.find((n) => n.id === "generate").data.count = 1;
  g.nodes.push({
    id: "refine",
    type: "generate",
    position: { x: 0, y: 0 },
    data: { label: "Refine", text: "Refine the texture", count: 1 },
  });
  g.edges.push({
    id: "edit",
    source: "generate",
    target: "refine",
    targetHandle: "image",
  });
  const run = await queue.create(g);
  await waitFor(() => run.status === "failed");
  assert.equal(run.jobs[1].status, "blocked");
  fail = false;
  queue.action(run.id, "retry");
  await waitFor(() => run.status === "completed");
  assert.equal(done.size, 2);
});
test("pause leaves queued work untouched; cancellation aborts active jobs; retry preserves completed work", async (t) => {
  let count = 0;
  const { queue } = await setup(
    t,
    async ({ signal }) => {
      count++;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 35);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("Cancelled"));
          },
          { once: true },
        );
      });
    },
    1,
  );
  const g = structuredClone(starter);
  const run = await queue.create(g, { count: 1 });
  queue.action(run.id, "pause");
  await waitFor(() => queue.active.size === 0);
  assert.equal(count, 1);
  assert.equal(run.jobs[0].status, "completed");
  assert.equal(run.jobs[1].status, "queued");
  queue.action(run.id, "resume");
  queue.action(run.id, "cancel");
  await waitFor(() => queue.active.size === 0);
  assert.equal(run.status, "cancelled");
  assert.equal(run.jobs[0].status, "completed");
  queue.action(run.id, "retry");
  await waitFor(() => run.status === "completed");
  assert.equal(count, 5);
});
test("a server restart marks unfinished work interrupted and requires an explicit resume", async (t) => {
  const { store } = await setup(t, async () => {});
  const run = {
    id: "restart-test",
    status: "running",
    createdAt: new Date().toISOString(),
    jobs: [
      { id: "a", status: "running" },
      { id: "b", status: "queued" },
      { id: "c", status: "completed" },
    ],
  };
  await store.saveRun(run);
  const fresh = new Store(store.root);
  await fresh.init();
  assert.equal(fresh.runs.get(run.id).status, "interrupted");
  assert.deepEqual(
    fresh.runs.get(run.id).jobs.map((j) => j.status),
    ["interrupted", "interrupted", "completed"],
  );
});

test("a paused run finishes when its last active image completes", async (t) => {
  const { queue } = await setup(
    t,
    async () => {
      await sleep(10);
    },
    1,
  );
  const g = structuredClone(starter);
  g.nodes.find((n) => n.id === "variations").data.lines = "one direction";
  const run = await queue.create(g, { count: 1 });
  queue.action(run.id, "pause");
  await waitFor(() => run.status === "completed");
  assert.equal(run.jobs[0].status, "completed");
});

test("immediate retry after cancellation reruns aborted work instead of completing with cancelled jobs", async (t) => {
  let releaseCancelled;
  let calls = 0;
  const { queue } = await setup(t, async ({ signal }) => {
    calls++;
    if (calls > 1) return;
    await new Promise((resolve) => {
      releaseCancelled = resolve;
      signal.addEventListener("abort", () => {}, { once: true });
    });
  });
  const g = structuredClone(starter);
  g.nodes.find((n) => n.id === "variations").data.lines = "one direction";
  const run = await queue.create(g, { count: 1 });
  await waitFor(() => releaseCancelled);
  queue.action(run.id, "cancel");
  queue.action(run.id, "retry");
  const statusWhileCancelling = run.status;
  releaseCancelled();
  await waitFor(() => queue.active.size === 0);
  assert.equal(statusWhileCancelling, "running");
  assert.equal(calls, 2);
  assert.equal(run.status, "completed");
  assert.equal(run.jobs[0].status, "completed");
});

test("graceful shutdown preserves active and queued jobs as interrupted and resume completes them", async (t) => {
  let began = false;
  const { store, queue, reference, png } = await setup(
    t,
    async ({ signal }) => {
      began = true;
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
    },
    1,
  );
  const g = structuredClone(starter);
  g.nodes.find((n) => n.id === "variations").data.lines = "first\nsecond";
  const run = await queue.create(g, { count: 1 });
  await waitFor(() => began);
  await queue.stop();
  await waitFor(() => queue.active.size === 0);
  assert.equal(run.status, "interrupted");
  assert.deepEqual(
    run.jobs.map((job) => job.status),
    ["interrupted", "interrupted"],
  );
  const restored = new Store(store.root);
  await restored.init();
  const resumed = restored.runs.get(run.id);
  assert.equal(resumed.status, "interrupted");
  const restartedQueue = new Queue(restored, {
    adapter: async ({ directory }) => {
      await writeFile(path.join(directory, "output.png"), png);
    },
    resolveAsset: () => reference,
  });
  restartedQueue.action(run.id, "resume");
  await waitFor(() => resumed.status === "completed");
  assert.ok(resumed.jobs.every((job) => job.status === "completed"));
  await restored.close();
});

test("local GPU lane runs one local job while hosted modes keep their parallel slots", async (t) => {
  const releaseLocal = Promise.withResolvers();
  const started = [];
  const { queue } = await setup(
    t,
    async ({ job }) => {
      started.push(job.providerId);
      if (job.providerId.startsWith("comfyui")) await releaseLocal.promise;
    },
    4,
  );
  queue.executionLane = (job) =>
    job.providerId.startsWith("comfyui") ? "local-models" : undefined;
  const graph = structuredClone(starter);
  graph.nodes.find((node) => node.id === "variations").data.lines = "one";
  const generator = graph.nodes.find((node) => node.id === "generate");
  generator.data.modes = [
    {
      id: "local-image",
      label: "Local image",
      providerId: "comfyui-image",
      model: "recipe",
      count: 3,
    },
    {
      id: "hosted",
      label: "Hosted",
      providerId: "codex",
      model: "native",
      count: 2,
    },
  ];
  const run = await queue.create(graph);
  try {
    await waitFor(() => started.filter((id) => id === "codex").length === 2);
    assert.equal(started.filter((id) => id === "comfyui-image").length, 1);
    assert.equal(
      run.jobs.filter(
        (job) => job.providerId === "comfyui-image" && job.status === "queued",
      ).length,
      2,
    );
  } finally {
    releaseLocal.resolve();
  }
  await waitFor(() => run.status === "completed");
  assert.equal(started.length, 5);
});
