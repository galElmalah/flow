import test from "node:test";
import assert from "node:assert/strict";
import { planWorkflow } from "../server/graph.mjs";
import { validateGraph } from "../shared/graph.mjs";
import { starter } from "./fixtures/paper-workflow.mjs";
const graph = () => structuredClone(starter);
test("four prompt variations and 25 copies produce 100 image jobs with the seed reference", () => {
  const p = planWorkflow(graph());
  assert.equal(p.total, 100);
  assert.equal(p.jobs[0].seed, 4200);
  assert.equal(p.jobs[99].seed, 4299);
  assert.match(p.jobs[25].prompt, /Lavender \+ burnt orange/);
  assert.deepEqual(p.jobs[0].images, [{ asset: "/assets/paper-seed.png" }]);
});
test("seeds can flow through a prompt into image generation", () => {
  const g = graph();
  g.edges = g.edges.filter((e) => e.id !== "seed-gen");
  g.edges.push({
    id: "seed-prompt",
    source: "seed",
    target: "prompt",
    targetHandle: "image",
  });
  const p = planWorkflow(g);
  assert.equal(p.total, 100);
  assert.equal(p.jobs[99].images[0].asset, "/assets/paper-seed.png");
});
test("a generated image fans out into downstream editing jobs with explicit dependencies", () => {
  const g = graph();
  g.nodes.find((n) => n.id === "generate").data.count = 1;
  g.nodes.push({
    id: "edit",
    type: "generate",
    position: { x: 1600, y: 0 },
    data: { label: "Refine", text: "Make the colors warmer", count: 2 },
  });
  g.edges.push({
    id: "gen-edit",
    source: "generate",
    target: "edit",
    targetHandle: "image",
  });
  const p = planWorkflow(g);
  assert.equal(p.total, 12);
  const downstream = p.jobs.filter((j) => j.nodeId === "edit");
  assert.equal(downstream.length, 8);
  assert.deepEqual(downstream[0].dependencies, [p.jobs[0].id]);
  assert.equal(downstream[0].images[0].jobId, p.jobs[0].id);
});
test("reject cycles and incompatible sockets before any jobs run", () => {
  const cyclic = graph();
  cyclic.edges.push({
    id: "cycle",
    source: "variations",
    target: "prompt",
    targetHandle: "text",
  });
  assert.throws(() => validateGraph(cyclic), /loop/);
  const bad = graph();
  bad.edges.push({
    id: "bad",
    source: "prompt",
    target: "output",
    targetHandle: "image",
  });
  assert.throws(() => validateGraph(bad), /Cannot connect/);
});
test("single-node execution includes ancestors and excludes unrelated generation branches", () => {
  const g = graph();
  g.nodes.push({
    id: "other",
    type: "generate",
    position: { x: 0, y: 0 },
    data: { label: "Other", text: "An unrelated image", count: 10 },
  });
  const p = planWorkflow(g, { nodeId: "generate", count: 1, seed: 8 });
  assert.equal(p.total, 4);
  assert.equal(p.jobs[3].seed, 11);
  assert.ok(p.jobs.every((j) => j.nodeId === "generate"));
});
test("reject missing images, blank prompts, and excessive batch expansion", () => {
  const empty = graph();
  empty.nodes.find((n) => n.id === "seed").data.images = [];
  assert.throws(() => planWorkflow(empty), /no images/);
  const blank = graph();
  blank.nodes = blank.nodes.filter((n) => n.type !== "variations");
  blank.edges = blank.edges.filter(
    (e) => !["prompt-var", "var-gen"].includes(e.id),
  );
  blank.nodes.find((n) => n.id === "prompt").data.text = "";
  assert.throws(() => planWorkflow(blank), /Connect a prompt/);
  const large = graph();
  large.nodes.find((n) => n.id === "variations").data.lines = Array.from(
    { length: 11 },
    (_, i) => "Palette " + i,
  ).join("\n");
  assert.throws(() => planWorkflow(large, { count: 500 }), /5,000/);
});

test("reject whitespace-only generation prompts and nonexistent source sockets before inference", () => {
  const blank = graph();
  blank.nodes = blank.nodes.filter((n) => n.type !== "variations");
  blank.edges = blank.edges.filter(
    (e) => !["prompt-var", "var-gen"].includes(e.id),
  );
  blank.edges.push({
    id: "prompt-image",
    source: "prompt",
    target: "generate",
  });
  blank.nodes.find((n) => n.id === "prompt").data.text = " \n\t ";
  assert.throws(() => planWorkflow(blank), /Connect a prompt/);
  const badSocket = graph();
  badSocket.edges[0].sourceHandle = "text";
  assert.throws(() => validateGraph(badSocket), /socket/);
});
