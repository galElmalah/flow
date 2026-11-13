import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Queue } from "../server/queue.mjs";
import { startWorkflowRun } from "../server/run-service.mjs";
import { ProjectService } from "../server/projects.mjs";

const graph = {
  id: "trial",
  name: "Trial",
  nodes: [
    {
      id: "prompt",
      type: "prompt",
      position: { x: 0, y: 0 },
      data: { text: "A scene" },
    },
    {
      id: "generate",
      type: "generate",
      position: { x: 400, y: 0 },
      data: { providerId: "local-color", count: 2 },
    },
  ],
  edges: [{ id: "p-g", source: "prompt", target: "generate" }],
};

test("run submissions replay concurrently and after restart, with conflicts preserving the original receipt", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-submission-"));
  let store = new Store(root);
  await store.init();
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  let preflights = 0;
  const services = {
    queue: new Queue(store),
    projects: { assertWorkflow() {}, assertActive() {} },
    providers: {
      async preflight() {
        preflights++;
        await new Promise((r) => setTimeout(r, 10));
      },
    },
    assetPath() {
      throw new Error("No assets expected");
    },
  };
  services.queue.pump = () => {};
  const request = {
    graph,
    workflowId: graph.id,
    options: { count: 3 },
    concurrency: 8,
    requestId: "batch-001",
  };
  const [first, second, third] = await Promise.all(
    Array.from({ length: 3 }, () => startWorkflowRun(services, request)),
  );
  assert.equal(first.id, second.id);
  assert.equal(second.id, third.id);
  assert.equal(store.runs.size, 1);
  assert.equal(preflights, 1);
  assert.equal(first.concurrency, 8);
  assert.equal(services.queue.concurrency, 4);
  await assert.rejects(
    () => startWorkflowRun(services, { ...request, options: { count: 4 } }),
    (error) =>
      error.status === 409 &&
      error.code === "REQUEST_ID_REUSED" &&
      error.runId === first.id,
  );
  // The SQL constraint prevents a second receipt even from another writer.
  await assert.rejects(
    () => store.saveRun({ ...structuredClone(first), id: "duplicate" }),
    /UNIQUE constraint/,
  );
  await store.close();
  store = new Store(root);
  await store.init();
  services.queue = new Queue(store);
  services.queue.pump = () => {};
  const recovered = await startWorkflowRun(services, {
    ...request,
    graph: undefined,
  });
  assert.equal(recovered.id, first.id);
  assert.equal(store.runs.size, 1);
  assert.equal(preflights, 1);
  const newBatch = await startWorkflowRun(services, {
    ...request,
    requestId: "batch-002",
  });
  assert.notEqual(newBatch.id, first.id);
  assert.equal(store.runs.size, 2);
});

test("invalid run controls and overrides fail before provider checks or persistence", async () => {
  const services = {
    projects: { assertWorkflow() {}, assertActive() {} },
    providers: {
      preflight() {
        throw new Error("Must not preflight");
      },
    },
    queue: {
      create() {
        throw new Error("Must not create");
      },
    },
  };
  for (const input of [
    { options: { count: NaN } },
    { options: { seed: Infinity } },
    { options: { count: null } },
    { options: { unexpected: 1 } },
    { concurrency: 0 },
    { requestId: "bad key" },
  ])
    await assert.rejects(() => startWorkflowRun(services, { graph, ...input }));
});

test("unbound submission receipts never bypass explicit unassigned project scope", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-replay-scope-"));
  const store = new Store(root);
  await store.init();
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const queue = new Queue(store);
  queue.pump = () => {};
  const projects = new ProjectService(store);
  await projects.create({ id: "private", name: "Private", root });
  const services = {
    projects,
    queue,
    providers: {
      async preflight() {
        await new Promise((r) => setTimeout(r, 10));
      },
    },
  };
  const request = {
    graph: { ...graph, projectId: "private" },
    workflowId: graph.id,
    requestId: "one-key",
  };
  const [unbound, unassigned] = await Promise.allSettled([
    startWorkflowRun(services, request),
    startWorkflowRun(services, { ...request, projectId: null }),
  ]);
  assert.equal(unbound.status, "fulfilled");
  assert.equal(unassigned.status, "rejected");
  assert.equal(unassigned.reason.status, 409);
  assert.equal(store.runs.size, 1);
  await assert.rejects(
    () => startWorkflowRun(services, { ...request, projectId: null }),
    { status: 409 },
  );
});

test("a committed run with a failed file mirror stays paused and recoverable without duplicate dispatch", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-replay-storage-"));
  const store = new Store(root);
  await store.init();
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const queue = new Queue(store);
  let pumps = 0;
  queue.pump = () => {
    pumps++;
  };
  const services = {
    queue,
    projects: { assertWorkflow() {}, assertActive() {} },
    providers: { async preflight() {} },
  };
  const request = { graph, workflowId: graph.id, requestId: "mirror-retry" };
  const originalWrite = store.write.bind(store);
  store.write = async () => {
    throw new Error("File mirror unavailable");
  };
  let runId;
  await assert.rejects(
    () => startWorkflowRun(services, request),
    (error) => {
      runId = error.runId;
      return (
        error.code === "RUN_PERSISTENCE_INCOMPLETE" &&
        error.status === 503 &&
        Boolean(runId)
      );
    },
  );
  store.write = originalWrite;
  const receipt = await startWorkflowRun(services, request);
  assert.equal(receipt.id, runId);
  assert.equal(receipt.status, "paused");
  assert.match(receipt.error, /resume/);
  assert.equal(store.runs.size, 1);
  assert.equal(pumps, 0);
  const saved = JSON.parse(
    store.db.prepare("SELECT document FROM runs WHERE id=?").get(runId)
      .document,
  );
  assert.equal(saved.status, "paused");
  queue.action(runId, "resume");
  assert.equal(receipt.status, "running");
  assert.equal(pumps, 1);
  await store.flush();
});
