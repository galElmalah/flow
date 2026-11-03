import test from "node:test";
import assert from "node:assert/strict";
import { planWorkflow } from "../server/graph.mjs";
import { validateGraph } from "../shared/graph.mjs";
import { createImageWorkflow } from "../client/workflows.mjs";
import { applyAgentEdits } from "../shared/agent.mjs";
import { runOptions } from "../cli/workflow-input.mjs";
import { registerRunRoutes } from "../server/routes/runs.mjs";
import { latestNodeJobs } from "../server/store.mjs";
import { overlayJobResults } from "../shared/job-results.mjs";
const prompts = [
  {
    id: "a",
    label: "A",
    scene: "A busy machine",
    concept: "Busy is not productive",
    seed: 0,
    count: 2,
  },
  { id: "b", label: "B", scene: "An empty dock", ratio: "2:3" },
];
const graph = () =>
  createImageWorkflow({
    id: "sets",
    name: "Sets",
    prompt: "Monochrome",
    prompts: structuredClone(prompts),
    images: ["/files/uploads/reference.png"],
    promptSetDefaults: { count: 3, ratio: "2:1" },
  });

test("Prompt Sets expand named scenes with inherited inputs, stable IDs and exact overrides", () => {
  const input = graph(),
    plan = planWorkflow(input);
  assert.equal(plan.total, 5);
  const a = plan.jobs.filter((j) => j.promptSet.itemId === "a"),
    b = plan.jobs.filter((j) => j.promptSet.itemId === "b");
  assert.equal(a.length, 2);
  assert.equal(b.length, 3);
  assert.deepEqual(
    a.map((j) => j.seed),
    [0, 1],
  );
  assert.ok(a.every((j) => j.ratio === "2:1"));
  assert.ok(b.every((j) => j.ratio === "2:3"));
  assert.match(a[0].prompt, /Monochrome/);
  assert.match(a[0].prompt, /A busy machine/);
  assert.match(a[0].prompt, /Busy is not productive/);
  assert.equal(a[0].records[0].id, "a");
  assert.equal(a[0].records[0].fields.title, "A");
  assert.equal(a[0].images[0].asset, "/files/uploads/reference.png");
  input.nodes.find((n) => n.id === "prompts").data.prompts[0].scene = "Changed";
  assert.equal(a[0].promptSet.scene, "A busy machine");
});
test("Selected scene runs preserve seeds, scope generators and leave the graph unchanged", () => {
  const input = graph();
  input.nodes.push({
    id: "unrelated",
    type: "generate",
    position: { x: 0, y: 0 },
    data: { label: "Other branch", text: "Other", providerId: "local-color" },
  });
  input.edges.push({
    id: "other-output",
    source: "unrelated",
    target: "output",
    targetHandle: "image",
  });
  const original = structuredClone(input);
  const full = planWorkflow(input),
    selected = planWorkflow(input, {
      nodeId: "output",
      promptSet: { nodeId: "prompts", itemIds: ["b"] },
    });
  assert.equal(selected.total, 3);
  assert.ok(selected.jobs.every((j) => j.nodeId === "generate"));
  assert.deepEqual(
    selected.jobs.map((j) => j.seed),
    full.jobs.filter((j) => j.promptSet?.itemId === "b").map((j) => j.seed),
  );
  assert.deepEqual(input, original);
  assert.throws(() =>
    planWorkflow(input, { promptSet: { nodeId: "prompts", itemIds: [] } }),
  );
  assert.throws(
    () =>
      planWorkflow(input, {
        promptSet: { nodeId: "prompts", itemIds: ["missing"] },
      }),
    /does not exist/,
  );
});
test("Defaults never erase item overrides; modes and CLI counts expand truthfully", () => {
  const input = graph(),
    set = input.nodes.find((n) => n.id === "prompts"),
    generator = input.nodes.find((n) => n.id === "generate");
  set.data.count = 4;
  generator.data.modes = [
    { id: "one", label: "One", providerId: "codex", count: 1 },
    { id: "two", label: "Two", providerId: "grok-image", count: 1 },
  ];
  assert.equal(planWorkflow(input).total, 12);
  assert.equal(planWorkflow(input, { count: 1 }).total, 4);
  assert.equal(set.data.prompts[0].count, 2);
});
test("Disabled, empty and duplicate scenes produce useful validation errors", () => {
  const input = graph(),
    set = input.nodes.find((n) => n.id === "prompts");
  set.data.prompts[0].enabled = false;
  assert.equal(planWorkflow(input).total, 3);
  assert.throws(
    () =>
      planWorkflow(input, { promptSet: { nodeId: "prompts", itemIds: ["a"] } }),
    /Enable/,
  );
  set.data.prompts[1].scene = " ";
  assert.throws(() => planWorkflow(input), /Write a scene/);
  set.data.prompts[1].id = "a";
  assert.throws(() => validateGraph(input), /unique/);
});
test("An excluded set does not block an unrelated enabled branch", () => {
  const input = graph();
  input.nodes
    .find((n) => n.id === "prompts")
    .data.prompts.forEach((item) => (item.enabled = false));
  input.nodes.push({
    id: "other",
    type: "generate",
    position: { x: 0, y: 0 },
    data: { label: "Other", text: "Independent prompt" },
  });
  assert.deepEqual(
    planWorkflow(input).jobs.map((job) => job.nodeId),
    ["other"],
  );
});
test("Prompt writer dependencies preserve scene identity and overrides downstream", () => {
  const input = createImageWorkflow({
    id: "writer",
    prompts,
    prompt: "Base",
    promptProviderId: "codex-text",
    promptSetDefaults: { count: 3 },
  });
  const plan = planWorkflow(input);
  assert.equal(plan.textJobs, 2);
  assert.equal(plan.imageJobs, 5);
  for (const job of plan.jobs.filter((j) => j.kind === "image")) {
    const writer = plan.jobs.find((j) => j.id === job.dependencies[0]);
    assert.equal(writer.promptSet.itemId, job.promptSet.itemId);
  }
});
test("Agents and CLI share the canonical Prompt Set schema and selection contract", () => {
  const input = graph();
  const edited = applyAgentEdits(input, [
    {
      op: "update-node",
      nodeId: "prompts",
      data: {
        prompts: [
          { id: "a", label: "A", scene: "An agent-edited machine", seed: 0 },
        ],
      },
    },
  ]).graph;
  assert.match(planWorkflow(edited).jobs[0].prompt, /agent-edited/);
  assert.deepEqual(
    runOptions({ "prompt-set": "prompts", items: "a,b" }).promptSet,
    { nodeId: "prompts", itemIds: ["a", "b"] },
  );
  assert.throws(() => runOptions({ items: "a" }));
  assert.equal(
    planWorkflow(input, runOptions({ "prompt-set": "prompts" })).total,
    5,
  );
});
test("Rerunning one scene preserves other scenes' latest results across refresh and active updates", () => {
  const input = graph(),
    old = planWorkflow(input).jobs.map((job) => ({
      ...job,
      status: "completed",
      output: `/old/${job.id}.png`,
    }));
  const newer = planWorkflow(input, {
    promptSet: { nodeId: "prompts", itemIds: ["a"] },
  }).jobs.map((job) => ({ ...job, status: "queued" }));
  const runs = [
    { id: "old", workflowId: input.id, createdAt: "2026-01-01", jobs: old },
    { id: "new", workflowId: input.id, createdAt: "2026-01-02", jobs: newer },
  ];
  for (const jobs of [
    latestNodeJobs(runs, input),
    overlayJobResults(old, newer),
  ]) {
    assert.equal(jobs.filter((j) => j.promptSet.itemId === "a").length, 2);
    assert.equal(jobs.filter((j) => j.promptSet.itemId === "b").length, 3);
    assert.ok(
      jobs
        .filter((j) => j.promptSet.itemId === "b")
        .every((j) => j.output.startsWith("/old/")),
    );
  }
  const ordinary = [
    { ...old[0], promptSet: undefined },
    { ...newer[0], promptSet: undefined },
  ];
  assert.equal(overlayJobResults([ordinary[0]], [ordinary[1]]).length, 1);
});
test("Shared instructions are included once, with or without an explicit input placeholder", () => {
  for (const template of [undefined, "{{input}}\nSCENE {{scene}}"]) {
    const input = graph();
    input.edges = input.edges.filter((e) => e.source !== "prompt");
    input.edges.push({
      id: "shared-to-set",
      source: "prompt",
      target: "prompts",
      targetHandle: "text",
    });
    input.nodes.find((n) => n.id === "prompts").data.text = template;
    for (const job of planWorkflow(input).jobs)
      assert.equal(job.prompt.match(/Monochrome/g)?.length, 1);
  }
});
test("HTTP preview preserves distinct upstream variations and permits inspecting excluded scenes", () => {
  const routes = new Map(),
    app = { post: (path, fn) => routes.set(path, fn), get() {} };
  registerRunRoutes(app, {
    projects: { assertWorkflow() {}, assertActive() {} },
    store: {},
  });
  const input = graph();
  input.nodes.push({
    id: "lighting",
    type: "variations",
    position: { x: 0, y: 0 },
    data: { label: "Lighting", lines: "DAYLIGHT\nNIGHT" },
  });
  input.edges.push({
    id: "lighting-set",
    source: "lighting",
    target: "prompts",
    targetHandle: "text",
  });
  input.nodes.find((n) => n.id === "prompts").data.prompts[0].enabled = false;
  const original = structuredClone(input);
  let result;
  routes.get("/api/prompt-sets/preview")(
    { body: { workflow: input, nodeId: "prompts", itemId: "a" } },
    { json: (value) => (result = value) },
    (error) => {
      throw error;
    },
  );
  assert.equal(result.enabled, false);
  assert.equal(result.total, 4);
  assert.equal(result.variants.length, 2);
  assert.match(result.variants[0].prompt, /DAYLIGHT/);
  assert.match(result.variants[1].prompt, /NIGHT/);
  assert.deepEqual(
    result.variants.map((v) => v.count),
    [2, 2],
  );
  assert.deepEqual(input, original);
});
