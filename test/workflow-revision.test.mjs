import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { registerWorkflowRoutes } from "../server/routes/workflows.mjs";
import { FlowClient } from "../client/index.mjs";

// Exercise the same HTTP boundary used by App, CLI and an inline assistant.
test("workflow revisions reject stale and concurrent writes while forks start a new revision history", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "flow-workflow-revision-"),
  );
  const store = new Store(directory);
  await store.init();
  const projects = new ProjectService(store);
  const app = express();
  app.use(express.json());
  registerWorkflowRoutes(app, { store, projects, assetPath: () => {} });
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const client = new FlowClient({
    url: `http://127.0.0.1:${server.address().port}`,
  });
  const initial = await client.createWorkflow({
    id: "motion",
    name: "Sports",
    nodes: [
      {
        id: "brief",
        type: "prompt",
        position: { x: 0, y: 0 },
        data: { label: "Sports direction", text: "Running" },
      },
    ],
    edges: [],
  });
  assert.equal(initial.revision, 0);
  const competing = ["Swimming", "Cycling"].map((sport) => ({
    ...initial,
    nodes: initial.nodes.map((node) => ({
      ...node,
      data: { ...node.data, text: sport },
    })),
  }));
  const attempts = await Promise.allSettled(
    competing.map((graph) => client.saveWorkflow(graph)),
  );
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejection = attempts.find((result) => result.status === "rejected");
  assert.equal(rejection.reason.status, 409);
  assert.match(rejection.reason.message, /changed elsewhere/);
  const current = await client.workflow(initial.id);
  assert.equal(current.revision, 1);
  assert.ok(["Swimming", "Cycling"].includes(current.nodes[0].data.text));
  await assert.rejects(
    client.saveWorkflow({ ...initial, name: "Stale draft" }),
    (error) => error.status === 409,
  );
  assert.deepEqual(await client.workflow(initial.id), current);
  // Omitting the revision defaults to 0, rather than bypassing optimistic checks.
  const noRevision = { ...current, name: "Unversioned writer" };
  delete noRevision.revision;
  await assert.rejects(
    client.saveWorkflow(noRevision),
    (error) => error.status === 409,
  );
  const latest = await client.saveWorkflow({
    ...current,
    name: "Updated sports",
  });
  assert.equal(latest.revision, 2);
  const fork = await client.fork(initial.id, {
    workflow: latest,
    name: "A new direction",
  });
  assert.equal(fork.revision, 0);
  assert.notEqual(fork.id, initial.id);
  assert.equal((await client.workflow(initial.id)).revision, 2);
  assert.equal(
    (await client.saveWorkflow({ ...fork, name: "Tennis studies" })).revision,
    1,
  );
  // SQLite persistence retains the revision acknowledged by the API.
  assert.equal(
    JSON.parse(
      store.db
        .prepare("SELECT document FROM workflows WHERE id=?")
        .get(initial.id).document,
    ).revision,
    2,
  );
});
