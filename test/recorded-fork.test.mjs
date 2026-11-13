import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { registerWorkflowRoutes } from "../server/routes/workflows.mjs";

test("recorded inline runs fork authoritative snapshots without a saved workflow and preserve ancestry", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-recorded-fork-"));
  const store = new Store(path.join(root, "data"));
  await store.init();
  const projects = new ProjectService(store);
  for (const id of ["alpha", "beta"]) {
    const directory = path.join(root, id);
    await mkdir(directory);
    await projects.create({ id, name: id, root: directory });
  }
  const graph = {
    id: "inline-only",
    name: "Recorded inline scene",
    projectId: "alpha",
    nodes: [
      {
        id: "prompt",
        type: "prompt",
        position: { x: 0, y: 0 },
        data: { text: "Original scene" },
      },
    ],
    edges: [],
  };
  const run = {
    id: "recorded",
    workflowId: graph.id,
    projectId: "alpha",
    status: "completed",
    graph,
    jobs: [],
    createdAt: new Date().toISOString(),
  };
  await store.saveRun(run);
  const app = express();
  app.use(express.json());
  registerWorkflowRoutes(app, { store, projects, assetPath() {} });
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
  const request = (id, body, projectId = "alpha") =>
    fetch(
      `http://127.0.0.1:${server.address().port}/api/workflows/${id}/fork?projectId=${projectId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  const response = await request(graph.id, { runId: run.id });
  assert.equal(response.status, 201);
  const fork = await response.json();
  assert.notEqual(fork.id, graph.id);
  assert.equal(fork.projectId, "alpha");
  assert.equal(fork.revision, 0);
  assert.equal(fork.nodes[0].data.text, "Original scene");
  assert.equal(fork.forkedFrom.workflowId, graph.id);
  assert.equal(fork.forkedFrom.runId, run.id);
  assert.equal(store.workflows.has(graph.id), false);
  assert.equal((await request("wrong-source", { runId: run.id })).status, 409);
  assert.equal(
    (await request(graph.id, { runId: run.id }, "beta")).status,
    409,
  );
  assert.equal((await request(graph.id, { runId: "missing" })).status, 404);
  assert.equal(
    (
      await request(graph.id, {
        runId: run.id,
        workflow: { ...graph, name: "Forged snapshot" },
      })
    ).status,
    400,
  );
  await store.saveWorkflow({
    ...graph,
    name: "Changed saved graph",
    nodes: [{ ...graph.nodes[0], data: { text: "Changed" } }],
  });
  const afterSave = await (await request(graph.id, { runId: run.id })).json();
  assert.equal(afterSave.nodes[0].data.text, "Original scene");
  assert.equal(afterSave.forkedFrom.name, graph.name);
});
