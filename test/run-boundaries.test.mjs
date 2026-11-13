import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { registerRunRoutes } from "../server/routes/runs.mjs";
import { planWorkflow } from "../server/graph.mjs";

const node = (id, type, data) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, ...data },
});
const edge = (source, target) => ({
  id: `${source}-${target}`,
  source,
  target,
});

test("scoped runs validate only planned seed assets and invalid requests leave concurrency unchanged", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-run-boundary-"));
  const seed = path.join(root, "seed.png");
  await writeFile(seed, "fixture");
  const workflow = {
    id: "asset-scope",
    name: "Asset scope",
    nodes: [
      node("records", "dataset", {
        records: [
          {
            id: "chosen",
            fields: { scene: "Chosen scene", role: "chosen" },
            images: ["/chosen.png"],
          },
          {
            id: "excluded",
            fields: { scene: "Excluded scene", role: "excluded" },
            images: ["/missing.png"],
          },
        ],
      }),
      node("filter", "filter", {
        filterField: "role",
        filterValues: ["chosen"],
      }),
      node("template", "template", { text: "{{scene}}" }),
      node("generate", "generate", { count: 1 }),
      node("unrelated-seed", "image", { images: ["/unrelated-missing.png"] }),
      node("unrelated-generator", "generate", {
        text: "Unrelated scene",
        count: 1,
      }),
    ],
    edges: [
      edge("records", "filter"),
      edge("filter", "template"),
      edge("template", "generate"),
      edge("unrelated-seed", "unrelated-generator"),
    ],
  };
  const reads = [];
  let preflights = 0;
  let starts = 0;
  let controls;
  const queue = {
    concurrency: 4,
    async create(graph, options, plan, settings) {
      starts++;
      controls = settings;
      return { id: "fixture-run", graph, jobs: plan.jobs };
    },
  };
  const app = express();
  app.use(express.json());
  registerRunRoutes(app, {
    store: { workflows: new Map([[workflow.id, workflow]]) },
    projects: { assertWorkflow() {}, assertActive() {} },
    queue,
    providers: {
      async preflight() {
        preflights++;
      },
    },
    assetPath(url) {
      reads.push(url);
      return url === "/chosen.png" ? seed : path.join(root, "missing");
    },
    dataRoot: root,
  });
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const send = (body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const scoped = {
    workflowId: workflow.id,
    options: { nodeId: "generate" },
    concurrency: 8,
  };
  assert.equal(planWorkflow(workflow, scoped.options).imageJobs, 1);
  const response = await send(scoped);
  assert.equal(response.status, 201, JSON.stringify(await response.json()));
  assert.deepEqual(reads, ["/chosen.png"]);
  assert.equal(preflights, 1);
  assert.equal(starts, 1);
  assert.equal(queue.concurrency, 4);
  assert.equal(controls.concurrency, 8);
  const invalidConcurrency = await send({ ...scoped, concurrency: 0 });
  assert.equal(invalidConcurrency.status, 400);
  assert.equal(preflights, 1);
  const invalidSeed = await send({ ...scoped, options: {}, concurrency: 16 });
  assert.equal(invalidSeed.status, 400);
  assert.equal(queue.concurrency, 4);
  assert.equal(preflights, 1);
  assert.equal(starts, 1);
});
