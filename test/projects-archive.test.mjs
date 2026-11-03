import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { registerProjectRoutes } from "../server/routes/projects.mjs";
import { registerWorkflowRoutes } from "../server/routes/workflows.mjs";
import { registerRunRoutes } from "../server/routes/runs.mjs";
import { FlowClient, createImageWorkflow } from "../client/index.mjs";
import { resolveViewerTarget } from "../src/canvas/viewer-target.mjs";

test("project search and recoverable cleanup preserve images, defaults and archive state across restart", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-archive-"));
  const dataRoot = path.join(root, "data");
  let store = new Store(dataRoot);
  await store.init();
  assert.deepEqual(
    store.listWorkflows(),
    [],
    "fresh installs have no demo workflows",
  );
  let projects = new ProjectService(store);
  const app = express();
  app.use(express.json());
  let preflights = 0;
  let archiveDuringPreflight = false;
  const services = {
    store,
    projects,
    assetPath: () => {
      throw new Error("unexpected asset");
    },
    providers: {
      async preflight() {
        preflights++;
        if (archiveDuringPreflight) projects.archiveWorkflows(["trial"], true);
      },
    },
    queue: {
      concurrency: 4,
      create() {
        throw new Error("no inference expected");
      },
    },
    dataRoot,
  };
  registerProjectRoutes(app, services);
  registerWorkflowRoutes(app, services);
  registerRunRoutes(app, services);
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = new FlowClient({ url });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  for (const id of ["quotes", "other"]) {
    await mkdir(path.join(root, id));
    await client.createProject({
      id,
      name: id === "quotes" ? "Quóture" : "Other",
      root: path.join(root, id),
    });
  }
  const graph = createImageWorkflow({
    id: "main",
    name: "Cover artwork",
    projectId: "quotes",
    prompt: "A quiet garden",
    providerId: "local-color",
    model: "color-study",
  });
  await client.createWorkflow(graph);
  await client.createWorkflow({
    ...graph,
    id: "trial",
    name: "Gradient prototype",
  });
  await client.createWorkflow({ ...graph, id: "foreign", projectId: "other" });
  await client.updateProject("quotes", { defaultWorkflowId: "main" });
  const run = {
    id: "original-run",
    workflowId: "trial",
    projectId: "quotes",
    graph: { ...graph, id: "trial" },
    status: "completed",
    createdAt: new Date().toISOString(),
    jobs: [
      {
        id: "original-image",
        kind: "image",
        status: "completed",
        output: "/retained.png",
        images: [],
        prompt: "Exact old prompt",
        nodeId: "generate",
      },
    ],
  };
  await store.saveRun(run);
  assert.equal((await client.projects({ search: "QUOTURE cover" })).length, 1);
  assert.equal(
    (await client.projects({ search: path.join(root, "quotes") })).length,
    1,
  );
  assert.equal((await client.projects({ search: "missing" })).length, 0);
  assert.equal((await client.projects({ search: "quoture" }))[0].imageCount, 1);
  await assert.rejects(
    client.archiveWorkflows(["trial", "missing"]),
    /not found/,
  );
  assert.equal(store.isWorkflowArchived("trial"), false);
  await assert.rejects(
    new FlowClient({ url, projectId: "quotes" }).archiveWorkflows([
      "trial",
      "foreign",
    ]),
    /ownership/,
  );
  assert.equal(store.isWorkflowArchived("trial"), false);
  await assert.rejects(client.archiveWorkflows(["main"]), /default/);
  await store.saveRun({ ...run, id: "busy", status: "paused", jobs: [] });
  await assert.rejects(client.archiveWorkflows(["trial"]), /active run/);
  await assert.rejects(client.archiveProject("quotes"), /active project/);
  await store.saveRun({ ...run, id: "busy", status: "cancelled", jobs: [] });
  const invoke = async (...args) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [
            path.resolve(import.meta.dirname, "../cli/flow.mjs"),
            ...args,
            "--url",
            url,
            "--json",
          ],
          { cwd: root },
        )
      ).stdout,
    );
  assert.equal(
    (await invoke("projects", "--search", "quoture"))[0].id,
    "quotes",
  );
  await invoke("workflow", "archive", "trial");
  assert.equal((await invoke("workflows", "--archived"))[0].id, "trial");
  await invoke("workflow", "restore", "trial");
  await client.archiveWorkflows(["trial"], true, "User cleanup");
  await client.archiveWorkflows(["trial"]); // idempotent
  assert.deepEqual(
    (await client.workflows()).map((w) => w.id),
    ["main", "foreign"],
  );
  assert.deepEqual(
    (
      await client.workflows(undefined, { archived: "archived", summary: true })
    ).map((w) => [w.id, w.archived]),
    [["trial", true]],
  );
  assert.equal((await client.projects({ search: "gradient" })).length, 0);
  assert.equal((await client.projects({ search: "quoture" }))[0].imageCount, 0);
  assert.equal((await client.gallery()).length, 0);
  assert.equal((await client.request("/api/runs")).length, 0);
  assert.equal((await client.inspect(run.id)).jobs[0].output, "/retained.png");
  assert.equal((await client.workflow("trial")).name, "Gradient prototype");
  await assert.rejects(
    client.saveWorkflow({ ...graph, id: "trial" }),
    /archived/,
  );
  await assert.rejects(
    client.updateProject("quotes", { defaultWorkflowId: "trial" }),
    /archived/,
  );
  await assert.rejects(
    client.post("/api/plan", { workflowId: "trial" }),
    /archived/,
  );
  await assert.rejects(
    client.post("/api/runs", { workflowId: "trial", concurrency: 16 }),
    /archived/,
  );
  assert.equal(preflights, 0);
  assert.equal(services.queue.concurrency, 4);
  await client.archiveWorkflows(["trial"], false);
  assert.equal((await client.gallery()).length, 1);
  // Async preflight must not start work archived while it was awaiting a provider.
  archiveDuringPreflight = true;
  await assert.rejects(
    client.post("/api/runs", { workflowId: "trial", concurrency: 16 }),
    /archived/,
  );
  assert.equal(preflights, 1);
  assert.equal(services.queue.concurrency, 4);
  await client.archiveProject("quotes");
  assert.deepEqual(
    (await client.projects()).map((p) => p.id),
    ["other"],
  );
  assert.deepEqual(
    (await client.projects({ archived: "archived" })).map((p) => p.id),
    ["quotes"],
  );
  assert.deepEqual(
    (await client.workflows()).map((w) => w.id),
    ["foreign"],
  );
  assert.equal((await client.project("quotes")).defaultWorkflowId, "main");
  await store.close();
  store = new Store(dataRoot);
  await store.init();
  projects = new ProjectService(store);
  assert.equal(store.isProjectArchived("quotes"), true);
  assert.equal(store.isWorkflowArchived("main"), true);
  assert.equal(store.runs.get(run.id).jobs[0].prompt, "Exact old prompt");
  projects.archiveProject("quotes", false);
  assert.equal(store.isWorkflowArchived("main"), false);
  assert.equal(
    store.isWorkflowArchived("trial"),
    true,
    "project restoration keeps independently archived prototypes archived",
  );
  projects.archiveWorkflows(["trial"], false);
  assert.equal(store.listRuns({ archived: "active" }).length, 2);
});

test("project viewer links need no default graph and reject conflicting targets", async () => {
  const client = new FlowClient({ url: "http://localhost:4310" });
  assert.equal(
    (await client.viewer({ projects: true })).url,
    "http://localhost:4310/projects",
  );
  await assert.rejects(
    client.viewer({ projects: true, workflowId: "main" }),
    /cannot also/,
  );
  const target = await resolveViewerTarget(
    new URLSearchParams("view=projects&project=quotes"),
    {
      workflows: [],
      projects: [{ id: "quotes" }],
      fetchRun: async () => {
        throw new Error("not needed");
      },
    },
  );
  assert.equal(target.projects, true);
  assert.equal(target.projectId, "quotes");
  await assert.rejects(
    resolveViewerTarget(new URLSearchParams("view=projects&workflow=main"), {
      workflows: [],
      projects: [],
    }),
    /cannot also/,
  );
});
