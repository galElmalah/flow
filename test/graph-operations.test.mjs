import test from "node:test";
import assert from "node:assert/strict";
import {
  copySubgraph,
  cloneSubgraph,
} from "../src/canvas/graph-operations.mjs";
import { starter } from "./fixtures/paper-workflow.mjs";
test("duplicating a connected selection keeps internal edges and gives every item a new identity", () => {
  const copied = copySubgraph(starter.nodes, starter.edges, [
    "prompt",
    "variations",
  ]);
  assert.equal(copied.nodes.length, 2);
  assert.equal(copied.edges.length, 1);
  let i = 0;
  const clone = cloneSubgraph(copied, { idFactory: () => `copy-${++i}` });
  assert.equal(clone.nodes.length, 2);
  assert.equal(clone.edges[0].source, clone.nodes[0].id);
  assert.equal(clone.edges[0].target, clone.nodes[1].id);
  assert.ok(clone.nodes.every((n) => n.selected));
  assert.equal(
    clone.nodes[0].position.x,
    starter.nodes.find((n) => n.id === "prompt").position.x + 55,
  );
  clone.nodes[0].data.text = "changed";
  assert.notEqual(
    starter.nodes.find((n) => n.id === "prompt").data.text,
    "changed",
  );
});

test("duplicated flow frames focus their copied members instead of the original flow", () => {
  const frame = {
    id: "frame",
    type: "section",
    position: { x: 0, y: 0 },
    data: { label: "Frame", members: ["prompt", "outside"] },
  };
  const prompt = {
    ...structuredClone(starter.nodes.find((n) => n.id === "prompt")),
  };
  let i = 0;
  const copy = cloneSubgraph(
    { nodes: [frame, prompt], edges: [] },
    { idFactory: () => `clone-${++i}` },
  );
  assert.deepEqual(copy.nodes[0].data.members, [copy.nodes[1].id]);
  assert.deepEqual(frame.data.members, ["prompt", "outside"]);
  assert.deepEqual(
    cloneSubgraph({ nodes: [frame], edges: [] }).nodes[0].data.members,
    [],
  );
});
