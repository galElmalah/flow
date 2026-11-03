import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSharedWorkflow } from "../examples/quoture/shared-workflow.mjs";
import { planWorkflow } from "../server/graph.mjs";
import { latestNodeJobs } from "../server/store.mjs";

const original = JSON.parse(
  await readFile(new URL("./fixtures/quote-records.json", import.meta.url)),
);
const covers = [
  {
    id: "category-ancient",
    fields: {
      role: "category",
      assetID: "ancient",
      title: "Ancient Philosophy",
      background: "warm burnt ochre",
      ratio: "1:1",
      scene: "A philosopher bust",
      sourceTitle: "Manifest",
      sourceLocator: "ancient",
    },
  },
  {
    id: "journey-truth",
    fields: {
      role: "journey",
      assetID: "truth",
      title: "Truth & Knowledge",
      background: "deep olive green",
      ratio: "2:1",
      scene: "A sequence of observation tools",
      sourceTitle: "Manifest",
      sourceLocator: "truth",
    },
  },
];
const graph = () =>
  buildSharedWorkflow(original, covers, [
    "/assets/category.jpg",
    "/assets/journey.jpg",
  ]);

test("Quoture routes one shared source into distinct quote, category and journey prompts and formats", () => {
  const g = graph(),
    plan = planWorkflow(g);
  assert.equal(g.nodes.filter((n) => n.type === "dataset").length, 1);
  assert.equal(plan.textJobs, 12);
  assert.equal(plan.imageJobs, 12);
  assert.equal(plan.contexts["quote-filter"], 10);
  assert.equal(plan.contexts["cover-filter"], 2);
  assert.equal(plan.contexts["collection"], 10);
  assert.equal(plan.contexts["cover-collection"], 2);
  for (const j of plan.jobs.filter((j) => j.kind === "image")) {
    const f = j.records[0].fields;
    assert.equal(j.records.length, 1);
    assert.equal(j.ratio, f.role === "category" ? "1:1" : "2:1");
    assert.ok(j.prompt.includes(f.assetID));
    assert.match(j.prompt, /fine charcoal cross-hatching/);
    if (f.role === "quote") {
      assert.equal(j.nodeId, "illustrations");
      assert.match(j.prompt, /quiet matte cobalt blue/);
      assert.ok(
        j.images.every((image) =>
          original.nodes
            .find((n) => n.id === "style-seeds")
            .data.images.includes(image.asset),
        ),
      );
    } else {
      assert.match(
        j.prompt,
        /background, sky and reflections must be clearly non-blue/,
      );
      assert.ok(j.prompt.includes(f.background));
      assert.equal(j.nodeId, `${f.role}-images`);
      assert.deepEqual(
        j.images.map((i) => i.asset),
        ["/assets/category.jpg", "/assets/journey.jpg"],
      );
    }
    assert.equal(j.dependencies.length, 1);
    assert.equal(
      plan.jobs.find((p) => p.id === j.dependencies[0]).records[0].id,
      j.records[0].id,
    );
  }
});

test("either output flow runs independently, and one shared instruction edit reaches both harnesses and images", () => {
  const g = graph();
  g.nodes.find((n) => n.id === "shared-style").data.text +=
    "\nShared review direction: quiet stippled edges.";
  for (const [target, texts, images] of [
    ["collection", 10, 10],
    ["cover-collection", 2, 2],
  ]) {
    const p = planWorkflow(g, { nodeId: target });
    assert.equal(p.textJobs, texts);
    assert.equal(p.imageJobs, images);
    assert.ok(
      p.jobs.every((j) =>
        j.prompt.includes("Shared review direction: quiet stippled edges."),
      ),
    );
    assert.ok(
      p.jobs.every((j) =>
        target === "collection"
          ? ["scene-writer", "illustrations"].includes(j.nodeId)
          : ["cover-writer", "category-images", "journey-images"].includes(
              j.nodeId,
            ),
      ),
    );
  }
});

test("role filters reject missing fields and safely skip a role absent from the source", () => {
  const g = graph();
  g.nodes.find((n) => n.id === "quotes").data.records = [
    structuredClone(covers[0]),
  ];
  const p = planWorkflow(g);
  assert.equal(p.textJobs, 1);
  assert.equal(p.imageJobs, 1);
  assert.equal(
    p.jobs.find((j) => j.kind === "image").nodeId,
    "category-images",
  );
  assert.equal(p.contexts["cover-collection"], 1);
  delete g.nodes.find((n) => n.id === "quotes").data.records[0].fields.role;
  assert.throws(() => planWorkflow(g), /Field “role” is missing/);
});

test("a collection retains both cover records when connected to a downstream generation node", () => {
  const g = graph();
  g.nodes.push({
    id: "refine-covers",
    type: "generate",
    position: { x: 3300, y: 900 },
    data: {
      label: "Refine covers",
      text: "Refine the engraving only",
      count: 1,
    },
  });
  g.edges.push({
    id: "refine",
    source: "cover-collection",
    target: "refine-covers",
    targetHandle: "image",
  });
  const p = planWorkflow(g, { nodeId: "refine-covers" });
  const jobs = p.jobs.filter((j) => j.nodeId === "refine-covers");
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map((j) => j.records[0].id),
    covers.map((r) => r.id),
  );
  assert.ok(
    jobs.every(
      (j) =>
        j.dependencies.length === 1 && j.images[0].jobId === j.dependencies[0],
    ),
  );
});

test("canvas keeps complete node batches from independent runs without leaking another workflow or deleted nodes", () => {
  const workflow = { id: "q", nodes: [{ id: "quotes" }, { id: "covers" }] };
  const runs = [
    {
      id: "old-quotes",
      workflowId: "q",
      createdAt: "2026-10-28",
      jobs: [
        { id: "q0", nodeId: "quotes" },
        { id: "deleted", nodeId: "gone" },
      ],
    },
    {
      id: "new-covers",
      workflowId: "q",
      createdAt: "2026-10-29",
      jobs: [
        { id: "c0", nodeId: "covers" },
        { id: "c1", nodeId: "covers" },
      ],
    },
    {
      id: "other",
      workflowId: "other",
      createdAt: "2026-10-30",
      jobs: [{ id: "foreign", nodeId: "quotes" }],
    },
    {
      id: "older-covers",
      workflowId: "q",
      createdAt: "2026-10-27",
      jobs: [{ id: "stale", nodeId: "covers" }],
    },
  ];
  assert.deepEqual(
    latestNodeJobs(runs, workflow).map((j) => [j.id, j.runId]),
    [
      ["c0", "new-covers"],
      ["c1", "new-covers"],
      ["q0", "old-quotes"],
    ],
  );
});
