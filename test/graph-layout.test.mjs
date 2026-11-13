import test from "node:test";
import assert from "node:assert/strict";
import {
  organizeGraph,
  organizeOptionsSchema,
} from "../shared/graph-layout.mjs";
import { starter } from "./fixtures/paper-workflow.mjs";
import { planWorkflow } from "../server/graph.mjs";

const node = (id, type = "prompt", data = {}) => ({
  id,
  type,
  position: { x: 10, y: 10 },
  data: { label: id, ...data },
});
const graph = (nodes, edges = []) => ({
  id: "layout-check",
  name: "Layout check",
  revision: 4,
  nodes,
  edges,
});
const edge = (id, source, target, type = "text") => ({
  id,
  source,
  target,
  sourceHandle: type,
  targetHandle: type,
});
const intersect = (a, aSize, b, bSize) =>
  a.position.x < b.position.x + bSize.width &&
  a.position.x + aSize.width > b.position.x &&
  a.position.y < b.position.y + bSize.height &&
  a.position.y + aSize.height > b.position.y;
function assertSeparate(nodes, geometry) {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      assert.ok(
        !intersect(
          nodes[i],
          geometry[nodes[i].id],
          nodes[j],
          geometry[nodes[j].id],
        ),
        `${nodes[i].id} overlaps ${nodes[j].id}`,
      );
}

test("organize preserves workflow content and typed topology while separating measured dynamic cards", async () => {
  const source = structuredClone(starter),
    original = structuredClone(source);
  const geometry = Object.fromEntries(
    source.nodes.map((entry, index) => [
      entry.id,
      {
        width: 300 + index * 20,
        height: index === 3 ? 1900 : 500 + index * 30,
      },
    ]),
  );
  const { graph: arranged, diagnostics } = await organizeGraph(source, {
    geometry,
  });
  assert.deepEqual(source, original);
  assert.deepEqual(arranged.edges, source.edges);
  assert.deepEqual(
    arranged.nodes.map((entry) => entry.data),
    source.nodes.map((entry) => entry.data),
  );
  assert.deepEqual(
    arranged.nodes.map((entry) => entry.id),
    source.nodes.map((entry) => entry.id),
  );
  assert.equal(arranged.revision, source.revision);
  assert.deepEqual(diagnostics, { estimatedNodeIds: [], warnings: [] });
  assertSeparate(arranged.nodes, geometry);
  const byId = new Map(arranged.nodes.map((entry) => [entry.id, entry]));
  for (const connection of arranged.edges)
    assert.ok(
      byId.get(connection.source).position.x <
        byId.get(connection.target).position.x,
    );
  assert.equal(planWorkflow(arranged).total, planWorkflow(source).total);
});

test("layout uses fixed socket positions instead of card centers", async () => {
  const source = graph([node("a"), node("b")], [edge("ab", "a", "b")]);
  const geometry = {
    a: {
      width: 300,
      height: 600,
      ports: [{ id: "text", kind: "source", x: 300, y: 410 }],
    },
    b: {
      width: 300,
      height: 600,
      ports: [{ id: "text", kind: "target", x: 0, y: 70 }],
    },
  };
  const { graph: arranged } = await organizeGraph(source, { geometry });
  assert.equal(
    arranged.nodes[0].position.y + 410,
    arranged.nodes[1].position.y + 70,
  );
  assert.notEqual(arranged.nodes[0].position.y, arranged.nodes[1].position.y);
});

test("stable identity sorting gives the same positions after input reordering or another organize", async () => {
  const source = graph(
    [node("c"), node("a"), node("d"), node("b")],
    [edge("bd", "b", "d"), edge("ac", "a", "c"), edge("ad", "a", "d")],
  );
  const first = await organizeGraph(source);
  const reordered = {
    ...source,
    nodes: [...source.nodes].reverse(),
    edges: [...source.edges].reverse(),
  };
  const second = await organizeGraph(reordered);
  const third = await organizeGraph(first.graph);
  const positions = (workflow) =>
    Object.fromEntries(
      [...workflow.nodes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(({ id, position }) => [id, position]),
    );
  assert.deepEqual(positions(first.graph), positions(second.graph));
  assert.deepEqual(positions(first.graph), positions(third.graph));
  assert.deepEqual(first.diagnostics.estimatedNodeIds, ["a", "b", "c", "d"]);
});

test("frames keep flat memberships, surround their cards, and do not collide with other flows or shared inputs", async () => {
  const source = graph(
    [
      node("shared"),
      node("a"),
      node("b", "generate"),
      node("c"),
      node("d", "generate"),
      node("loose"),
      node("frame-a", "section", {
        members: ["a", "b"],
        subtitle: "First flow",
        tone: "quote",
      }),
      node("frame-b", "section", {
        members: ["c", "d"],
        subtitle: "Second flow",
        tone: "cover",
      }),
      node("empty", "section", { width: 300, height: 200, members: [] }),
    ],
    [
      edge("sa", "shared", "a"),
      edge("ab", "a", "b"),
      edge("sc", "shared", "c"),
      edge("cd", "c", "d"),
    ],
  );
  const geometry = Object.fromEntries(
    source.nodes
      .filter((entry) => entry.type !== "section")
      .map((entry) => [
        entry.id,
        { width: 330, height: entry.type === "generate" ? 1450 : 440 },
      ]),
  );
  const { graph: arranged } = await organizeGraph(source, { geometry });
  const byId = new Map(arranged.nodes.map((entry) => [entry.id, entry]));
  for (const frame of arranged.nodes.filter(
    (entry) => entry.type === "section",
  )) {
    const original = source.nodes.find((entry) => entry.id === frame.id);
    assert.deepEqual(frame.data.members, original.data.members);
    assert.equal(frame.data.subtitle, original.data.subtitle);
    for (const id of frame.data.members) {
      const member = byId.get(id),
        size = geometry[id];
      assert.ok(member.position.x >= frame.position.x + 40);
      assert.ok(member.position.y >= frame.position.y + 100);
      assert.ok(
        member.position.x + size.width <=
          frame.position.x + frame.data.width - 40,
      );
      assert.ok(
        member.position.y + size.height <=
          frame.position.y + frame.data.height - 40,
      );
    }
  }
  const roots = arranged.nodes.filter((entry) =>
    ["shared", "loose", "frame-a", "frame-b", "empty"].includes(entry.id),
  );
  const rootGeometry = {
    ...geometry,
    ...Object.fromEntries(
      roots
        .filter((entry) => entry.type === "section")
        .map((entry) => [entry.id, entry.data]),
    ),
  };
  assertSeparate(roots, rootGeometry);
  assert.deepEqual(arranged.edges, source.edges);
});

test("invalid and duplicate frame memberships produce deterministic diagnostics without changing saved members", async () => {
  const source = graph([
    node("a"),
    node("b"),
    node("first", "section", { members: ["a", "absent", "second"] }),
    node("second", "section", { members: ["a", "b"] }),
  ]);
  const { graph: arranged, diagnostics } = await organizeGraph(source, {
    geometry: { removed: { width: 100, height: 100 } },
  });
  assert.equal(diagnostics.warnings.length, 4);
  assert.match(diagnostics.warnings.join("\n"), /missing node “removed”/);
  assert.match(diagnostics.warnings.join("\n"), /invalid member “absent”/);
  assert.match(diagnostics.warnings.join("\n"), /invalid member “second”/);
  assert.match(diagnostics.warnings.join("\n"), /multiple frames/);
  assert.deepEqual(
    arranged.nodes.map((entry) => entry.data.members),
    source.nodes.map((entry) => entry.data.members),
  );
});

test("empty graphs and disconnected nodes organize without dropping content", async () => {
  const empty = graph([]);
  assert.deepEqual((await organizeGraph(empty)).graph, empty);
  const source = graph(
    Array.from({ length: 20 }, (_, index) =>
      node(`node-${index}`, "generate", {
        modes: Array.from({ length: 12 }, (_, i) => ({ id: String(i) })),
      }),
    ),
  );
  const geometry = Object.fromEntries(
    source.nodes.map((entry) => [entry.id, { width: 350, height: 3010 }]),
  );
  const { graph: arranged } = await organizeGraph(source, { geometry });
  assertSeparate(arranged.nodes, geometry);
  assert.equal(arranged.nodes.length, 20);
});

test("oversized frames fail explicitly rather than saving clipped or schema-invalid frames", async () => {
  const source = graph([
    node("huge"),
    node("frame", "section", { members: ["huge"] }),
  ]);
  await assert.rejects(
    organizeGraph(source, { geometry: { huge: { width: 8000, height: 500 } } }),
    /exceed 8000 pixels/,
  );
  assert.deepEqual(source.nodes[1].data.members, ["huge"]);
  assert.equal(source.nodes[1].data.width, undefined);
});

test("public organization options reject invalid dimensions and unknown controls at the boundary", () => {
  assert.deepEqual(
    organizeOptionsSchema.parse({
      revision: 0,
      preview: true,
    }),
    { revision: 0, preview: true },
  );
  for (const invalid of [
    { revision: -1 },
    { revision: 0.1 },
    { revision: 0, algorithm: "unknown" },
    { revision: 0, geometry: { a: { width: Infinity, height: 300 } } },
    { revision: 0, geometry: { a: { width: 300, height: 0 } } },
    { revision: 0, geometry: { a: { width: 9000, height: 300 } } },
    {
      revision: 0,
      geometry: {
        a: {
          width: 300,
          height: 300,
          ports: [{ id: "text", kind: "input", x: 0, y: 80 }],
        },
      },
    },
  ])
    assert.throws(() => organizeOptionsSchema.parse(invalid));
});
