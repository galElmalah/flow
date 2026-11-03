import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { Store, summarize } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { Queue } from "../server/queue.mjs";
import { starter } from "../server/defaults.mjs";
import { registerProjectRoutes } from "../server/routes/projects.mjs";
import { registerWorkflowRoutes } from "../server/routes/workflows.mjs";
import { registerRunRoutes } from "../server/routes/runs.mjs";

async function temporary(t, cleanup = true) {
  const root = await mkdtemp(path.join(tmpdir(), "weft-projects-"));
  if (cleanup) t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("v1 SQLite migration preserves workflow documents and historical unowned runs", async (t) => {
  const root = await temporary(t);
  const old = new DatabaseSync(path.join(root, "weft.sqlite"));
  old.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO metadata (key, value) VALUES ('json_imported', 'already imported');
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
      updated_at TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)));
    CREATE TABLE runs (id TEXT PRIMARY KEY, workflow_id TEXT, status TEXT NOT NULL,
      created_at TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)));
    PRAGMA user_version = 1;
  `);
  const graph = structuredClone(starter);
  const historic = {
    id: "historical",
    workflowId: graph.id,
    name: graph.name,
    createdAt: new Date().toISOString(),
    status: "completed",
    graph,
    jobs: [],
  };
  old
    .prepare(
      "INSERT INTO workflows (id,name,parent_id,updated_at,document) VALUES (?,?,NULL,?,?)",
    )
    .run(graph.id, graph.name, historic.createdAt, JSON.stringify(graph));
  old
    .prepare(
      "INSERT INTO runs (id,workflow_id,status,created_at,document) VALUES (?,?,?,?,?)",
    )
    .run(
      historic.id,
      graph.id,
      historic.status,
      historic.createdAt,
      JSON.stringify(historic),
    );
  old.close();
  const store = new Store(root);
  await store.init();
  assert.equal(store.storageInfo().schemaVersion, 3);
  assert.equal(store.projects.size, 0);
  assert.deepEqual(store.workflows.get(graph.id), graph);
  assert.deepEqual(store.runs.get(historic.id), historic);
  assert.equal(
    store.db.prepare("SELECT project_id FROM runs WHERE id=?").get(historic.id)
      .project_id,
    null,
  );
  assert.equal(
    store.db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  await store.close();
});

test("project registration canonicalizes roots, preserves identity, and validates default ownership", async (t) => {
  const root = await temporary(t);
  const repo = path.join(root, "repo"),
    alias = path.join(root, "alias");
  await mkdir(repo);
  await symlink(repo, alias);
  const store = new Store(path.join(root, "data"));
  await store.init();
  const projects = new ProjectService(store);
  const first = await projects.create({
    id: "quoture",
    name: "Quoture",
    root: alias,
  });
  assert.equal(first.created, true);
  assert.equal(first.project.root, await realpath(repo));
  const again = await projects.create({
    id: "quoture",
    name: "A repeated registration",
    root: repo,
  });
  assert.equal(again.created, false);
  assert.deepEqual(again.project, first.project);
  assert.deepEqual(
    (await projects.create({ name: "UI registration", root: alias })).project,
    first.project,
  );
  await assert.rejects(
    projects.create({ id: "other", name: "Other", root: alias }),
    /already registered/,
  );
  await assert.rejects(
    projects.create({ id: "quoture", name: "Other", root }),
    /another directory/,
  );
  await assert.rejects(
    projects.create({ id: "relative", name: "Relative", root: "." }),
    /absolute/,
  );
  const file = path.join(root, "file");
  await writeFile(file, "not a directory");
  await assert.rejects(
    projects.create({ id: "file", name: "File", root: file }),
    /directory/,
  );
  await assert.rejects(
    projects.update("quoture", { defaultWorkflowId: starter.id }),
    /must belong/,
  );
  await store.saveWorkflow({ ...starter, projectId: "quoture" });
  const configured = await projects.update("quoture", {
    defaultWorkflowId: starter.id,
    name: "Quoture iOS",
  });
  assert.equal(configured.defaultWorkflowId, starter.id);
  assert.throws(
    () => projects.assertReassignment({ ...starter, projectId: null }),
    /default workflow/,
  );
  await projects.update("quoture", { defaultWorkflowId: null });
  projects.assertReassignment({ ...starter, projectId: null });
  await store.close();
  const restored = new Store(path.join(root, "data"));
  await restored.init();
  assert.equal(restored.projects.get("quoture").name, "Quoture iOS");
  assert.equal(restored.projects.get("quoture").defaultWorkflowId, undefined);
  assert.equal(restored.workflows.get(starter.id).projectId, "quoture");
  await restored.close();
});

test("HTTP ownership checks precede inference; forks and historical run snapshots keep independent ownership", async (t) => {
  const root = await temporary(t, false);
  const dataRoot = path.join(root, "data");
  const store = new Store(dataRoot);
  await store.init();
  const projects = new ProjectService(store);
  const queue = new Queue(store, { concurrency: 0 });
  let preflights = 0;
  const providers = {
    preflight: async () => {
      preflights++;
    },
  };
  const app = express();
  app.use(express.json());
  const services = {
    store,
    projects,
    queue,
    providers,
    dataRoot,
    assetPath: (url) => path.join(import.meta.dirname, "../public", url),
  };
  registerProjectRoutes(app, services);
  registerWorkflowRoutes(app, services);
  registerRunRoutes(app, services);
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await queue.stop();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  async function request(
    route,
    body,
    method = body === undefined ? "GET" : "POST",
  ) {
    const response = await fetch(base + route, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  for (const id of ["quoture", "other"]) {
    const directory = path.join(root, id);
    await mkdir(directory);
    const registered = await request("/api/projects", {
      id,
      name: id,
      root: directory,
    });
    assert.equal(registered.status, 201);
    assert.equal(
      (await request("/api/projects", { id, name: id, root: directory }))
        .status,
      200,
    );
  }
  const source = {
    ...structuredClone(starter),
    id: "owned",
    projectId: "quoture",
  };
  assert.equal((await request("/api/workflows", source)).status, 201);
  assert.equal((await request("/api/workflows", source)).status, 409);
  const generated = await request("/api/workflows", {
    ...source,
    id: undefined,
  });
  assert.equal(generated.status, 201);
  assert.notEqual(generated.body.id, source.id);
  assert.equal(
    (
      await request(
        "/api/workflows/owned",
        { ...source, projectId: "missing" },
        "PUT",
      )
    ).status,
    404,
  );
  const inherited = (
    await request("/api/workflows/owned/fork", {
      workflow: { ...source, projectId: "other" },
    })
  ).body;
  assert.equal(inherited.projectId, "quoture");
  const moved = (
    await request("/api/workflows/owned/fork", { projectId: "other" })
  ).body;
  assert.equal(moved.projectId, "other");
  const unowned = (
    await request("/api/workflows/owned/fork", { projectId: null })
  ).body;
  assert.equal(unowned.projectId, null);
  assert.equal(
    (await request("/api/workflows/owned/fork", { projectId: "missing" }))
      .status,
    404,
  );
  const listed = (await request("/api/workflows?projectId=other")).body;
  assert.deepEqual(
    listed.map((graph) => graph.id),
    [moved.id],
  );
  const mismatch = {
    workflowId: source.id,
    projectId: "other",
    options: { count: 1 },
  };
  assert.equal((await request("/api/plan", mismatch)).status, 409);
  assert.equal((await request("/api/runs", mismatch)).status, 409);
  assert.equal(preflights, 0);
  assert.equal(
    (await request("/api/plan", { ...mismatch, projectId: "quoture" })).status,
    200,
  );
  const started = await request("/api/runs", {
    ...mismatch,
    projectId: "quoture",
  });
  assert.equal(started.status, 201);
  assert.equal(preflights, 1);
  const run = started.body;
  assert.equal(run.projectId, "quoture");
  assert.equal(run.project.name, "quoture");
  for (const route of [
    "/api/workflows/owned",
    "/api/workflows/owned/results",
    `/api/runs/${run.id}`,
    `/api/runs/${run.id}/manifest`,
    `/api/runs/${run.id}/download`,
  ]) {
    assert.equal(
      (await request(`${route}?projectId=other`)).status,
      409,
      route,
    );
    assert.equal(
      (await request(`${route}?projectId=missing`)).status,
      404,
      route,
    );
    if (!route.endsWith("/download"))
      assert.equal(
        (await request(`${route}?projectId=quoture`)).status,
        200,
        route,
      );
  }
  for (const action of ["pause", "resume", "retry", "cancel"]) {
    const rejected = await request(`/api/runs/${run.id}/${action}`, {
      projectId: "other",
    });
    assert.equal(rejected.status, 409);
    assert.equal(store.runs.get(run.id).status, "running");
  }
  assert.equal(
    (
      await request(`/api/runs/${run.id}/pause`, {
        projectId: "quoture",
      })
    ).status,
    200,
  );
  assert.equal(store.runs.get(run.id).status, "paused");
  assert.equal(
    (
      await request(`/api/runs/${run.id}/resume`, {
        projectId: null,
      })
    ).status,
    409,
  );
  assert.equal(store.runs.get(run.id).status, "paused");
  assert.equal(
    (
      await request(`/api/runs/${run.id}/resume`, {
        projectId: "quoture",
      })
    ).status,
    200,
  );
  assert.equal(store.runs.get(run.id).status, "running");
  await request("/api/projects/quoture", { name: "Renamed project" }, "PUT");
  await request(
    "/api/workflows/owned",
    { ...source, projectId: "other" },
    "PUT",
  );
  assert.equal(store.workflows.get(source.id).projectId, "other");
  assert.equal(
    (await request(`/api/runs/${run.id}`)).body.project.name,
    "quoture",
  );
  assert.equal((await request("/api/runs?projectId=other")).body.length, 0);
  const historical = (await request("/api/runs?projectId=quoture")).body;
  assert.deepEqual(
    historical.map((value) => value.id),
    [run.id],
  );
  assert.equal(summarize(store.runs.get(run.id)).projectId, "quoture");
  assert.equal(
    store.db.prepare("SELECT project_id FROM runs WHERE id=?").get(run.id)
      .project_id,
    "quoture",
  );
  assert.equal(
    store.db
      .prepare("SELECT project_id FROM workflows WHERE id=?")
      .get(source.id).project_id,
    "other",
  );
  const unownedRun = (
    await request("/api/runs", {
      workflowId: unowned.id,
      projectId: null,
      options: { count: 1 },
    })
  ).body;
  assert.equal(
    (
      await request(`/api/runs/${unownedRun.id}/pause`, {
        projectId: null,
      })
    ).status,
    200,
  );
  assert.equal(store.runs.get(unownedRun.id).status, "paused");
  assert.equal(
    (
      await request(`/api/runs/${unownedRun.id}/resume`, {
        projectId: "quoture",
      })
    ).status,
    409,
  );
  assert.equal(store.runs.get(unownedRun.id).status, "paused");
});
