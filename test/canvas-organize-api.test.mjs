import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import express from "express";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { registerWorkflowRoutes } from "../server/routes/workflows.mjs";
import { registerProjectRoutes } from "../server/routes/projects.mjs";
import { FlowClient, createImageWorkflow } from "../client/index.mjs";

const exec = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "flow-organize-"));
  const store = new Store(path.join(root, "data"));
  await store.init();
  const projects = new ProjectService(store);
  for (const id of ["qa", "other"]) {
    const folder = path.join(root, id);
    await mkdir(folder);
    await projects.create({ id, name: id, root: folder });
  }
  const app = express();
  app.use(express.json());
  registerProjectRoutes(app, { store, projects });
  registerWorkflowRoutes(app, { store, projects, assetPath: () => {} });
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
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = new FlowClient({ url, projectId: "qa" });
  const graph = createImageWorkflow({
    id: "canvas",
    projectId: "qa",
    prompt: "Preserve these settings",
    providerId: "local-color",
    model: "color-study",
  });
  graph.nodes.forEach((n) => {
    n.position = { x: 0, y: 0 };
  });
  graph.viewport = { x: -9000, y: -9000, zoom: 1 };
  await client.createWorkflow(graph);
  return { root, store, client, url, graph: await client.workflow(graph.id) };
}

test("organize previews, saves one revision and protects concurrent edits/project scope", async (t) => {
  const { client, store, url, graph } = await fixture(t);
  const geometry = Object.fromEntries(
    graph.nodes.map((n) => [n.id, { width: 340, height: 740 }]),
  );
  const result = await client.organizeWorkflow(graph.id, {
    revision: 0,
    geometry,
    preview: true,
  });
  assert.equal(result.workflow.revision, 0);
  assert.equal(result.workflow.viewport, undefined);
  assert.deepEqual(await client.workflow(graph.id), graph);
  assert.deepEqual(result.workflow.edges, graph.edges);
  assert.deepEqual(
    result.workflow.nodes.map((n) => n.data),
    graph.nodes.map((n) => n.data),
  );
  assert.deepEqual(result.diagnostics.estimatedNodeIds, []);
  const attempts = await Promise.allSettled(
    [1, 2].map(() =>
      client.organizeWorkflow(graph.id, {
        revision: 0,
        geometry,
      }),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = attempts.find((r) => r.status === "rejected");
  assert.equal(rejected.reason.status, 409);
  assert.equal((await client.workflow(graph.id)).revision, 1);
  await assert.rejects(
    client.organizeWorkflow(graph.id, { revision: 0 }),
    (e) => e.status === 409,
  );
  const foreign = new FlowClient({ url, projectId: "other" });
  await assert.rejects(
    foreign.organizeWorkflow(graph.id, { revision: 1 }),
    (e) => e.status === 409,
  );
  await assert.rejects(
    client.organizeWorkflow(graph.id, {
      revision: 1,
      geometry: { prompt: { width: -1, height: 20 } },
    }),
    (e) => e.status === 400,
  );
  await client.archiveWorkflows([graph.id]);
  await assert.rejects(
    client.organizeWorkflow(graph.id, { revision: 1 }),
    (e) => e.status === 409,
  );
});

test("CLI organize uses the same scoped operation and --plan never saves", async (t) => {
  const { client, url, root, graph } = await fixture(t);
  const geometry = Object.fromEntries(
    graph.nodes.map((n) => [n.id, { width: 350, height: 800 }]),
  );
  const file = path.join(root, "geometry.json");
  await writeFile(file, JSON.stringify(geometry));
  const run = async (extra) =>
    JSON.parse(
      (
        await exec(
          process.execPath,
          [
            "cli/flow.mjs",
            "workflow",
            "organize",
            graph.id,
            "--url",
            url,
            "--project",
            "qa",
            "--json",
            ...extra,
          ],
          { cwd: path.resolve(import.meta.dirname, "..") },
        )
      ).stdout,
    );
  const preview = await run(["--geometry", file, "--plan"]);
  assert.equal((await client.workflow(graph.id)).revision, 0);
  const expected = await client.organizeWorkflow(graph.id, {
    revision: 0,
    geometry,
    preview: true,
  });
  assert.deepEqual(preview.workflow.nodes, expected.workflow.nodes);
  const saved = await run([]);
  assert.equal(saved.workflow.revision, 1);
  assert.ok(saved.diagnostics.estimatedNodeIds.length);
});
