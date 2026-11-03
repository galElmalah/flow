import { z } from "zod";
import { outputType } from "./graph.mjs";

const point = z.number().finite().min(-8000).max(16000);
const geometrySchema = z
  .record(
    z.string().min(1).max(100),
    z
      .object({
        width: z.number().finite().min(1).max(8000),
        height: z.number().finite().min(1).max(8000),
        ports: z
          .array(
            z
              .object({
                id: z.string().max(100).nullable(),
                kind: z.enum(["source", "target"]),
                x: point,
                y: point,
              })
              .strict(),
          )
          .max(32)
          .optional(),
      })
      .strict(),
  )
  .refine(
    (entries) => Object.keys(entries).length <= 150,
    "At most 150 node measurements are supported.",
  );

export const organizeOptionsSchema = z
  .object({
    revision: z.number().int().min(0),
    geometry: geometrySchema.optional(),
    preview: z.boolean().optional(),
  })
  .strict();

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ordered = (items) => [...items].sort((a, b) => compare(a.id, b.id));
const padding = { left: 40, right: 40, top: 100, bottom: 40 };
const spacing = 80;
const options = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.randomSeed": "1",
  "elk.spacing.nodeNode": String(spacing),
  "elk.spacing.componentComponent": String(spacing),
  "elk.layered.spacing.nodeNodeBetweenLayers": "160",
  "elk.layered.spacing.edgeNodeBetweenLayers": "32",
  "elk.spacing.edgeNode": "28",
  "elk.padding": "[top=0,left=0,bottom=0,right=0]",
};
let engine;
async function getEngine() {
  engine ||= import("elkjs/lib/elk.bundled.js").then(
    ({ default: ELK }) => new ELK(),
  );
  return engine;
}

function estimatedGeometry(node) {
  const modes = node.data.modes?.length || 0;
  const sizes = {
    image: [324, 460],
    prompt: [310, 440],
    dataset: [350, 650],
    "prompt-set": [350, 470],
    filter: [250, 300],
    template: [350, 460],
    "prompt-generate": [350, 1000],
    variations: [330, 500],
    generate: [350, 850 + modes * 180],
    "video-generate": [350, 850 + modes * 180],
    output: [350, 700],
    "video-output": [350, 700],
  };
  const [width, height] = sizes[node.type] || [350, 650];
  return { width, height };
}

const portKey = (kind, id) => `${kind}:${id ?? ""}`;
function fallbackPort(node, kind, id, bounds) {
  const sourceY = {
    image: 156,
    prompt: 106,
    template: 125,
    "prompt-generate": 260,
    dataset: 140,
    "prompt-set": 180,
    filter: 98,
    variations: 116,
    generate: 223,
    "video-generate": 250,
    output: 290,
  };
  const targetY = {
    prompt: { image: 82, text: 120 },
    template: { text: 105, image: 145 },
    "prompt-set": { text: 110, image: 145 },
    "prompt-generate": { image: 85, text: 124 },
    generate: { text: 85, image: 126 },
    "video-generate": { text: 85, image: 126 },
    filter: { text: 98 },
    variations: { text: 116 },
    output: { image: 155 },
    "video-output": { video: 155 },
  };
  return {
    x: kind === "source" ? bounds.width : 0,
    y: Math.min(
      bounds.height,
      kind === "source"
        ? sourceY[node.type] || 100
        : targetY[node.type]?.[id] || 100,
    ),
  };
}

function elkNode(node, geometry, connectedPorts) {
  const bounds = geometry.get(node.id);
  return {
    id: node.id,
    width: bounds.width,
    height: bounds.height,
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports: [...connectedPorts.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([key, { kind, id }]) => {
        const measured = bounds.ports?.find(
          (port) => port.kind === kind && port.id === id,
        );
        const position = measured || fallbackPort(node, kind, id, bounds);
        return {
          id: `${node.id}/${key}`,
          x: Math.max(0, Math.min(bounds.width, position.x)),
          y: Math.max(0, Math.min(bounds.height, position.y)),
          width: 0,
          height: 0,
          layoutOptions: {
            "elk.port.side": kind === "source" ? "EAST" : "WEST",
          },
        };
      }),
  };
}

async function layout(nodes, edges, geometry) {
  if (!nodes.length) return { positions: new Map(), width: 0, height: 0 };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ports = new Map(nodes.map((node) => [node.id, new Map()]));
  const elkEdges = ordered(edges).map((edge) => {
    const source = edge.sourceHandle ?? outputType(byId.get(edge.source).type);
    const target = edge.targetHandle ?? source;
    const sourceKey = portKey("source", source),
      targetKey = portKey("target", target);
    ports.get(edge.source).set(sourceKey, { kind: "source", id: source });
    ports.get(edge.target).set(targetKey, { kind: "target", id: target });
    return {
      id: edge.id,
      sources: [`${edge.source}/${sourceKey}`],
      targets: [`${edge.target}/${targetKey}`],
    };
  });
  const result = await (
    await getEngine()
  ).layout({
    id: "root",
    layoutOptions: options,
    children: ordered(nodes).map((node) =>
      elkNode(node, geometry, ports.get(node.id)),
    ),
    edges: elkEdges,
  });
  const positions = new Map(
    (result.children || []).map((node) => [node.id, { x: node.x, y: node.y }]),
  );
  for (const node of nodes) {
    const position = positions.get(node.id);
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    )
      throw new Error("The layout engine returned invalid node positions.");
  }
  // Keep explicit separation even if a future engine version packs disconnected components too tightly.
  const placed = [];
  for (const node of ordered(nodes).sort(
    (a, b) =>
      positions.get(a.id).y - positions.get(b.id).y || compare(a.id, b.id),
  )) {
    const position = positions.get(node.id),
      size = geometry.get(node.id);
    let collision;
    while (
      (collision = placed.find(
        (other) =>
          position.x < other.x + other.width + spacing &&
          position.x + size.width + spacing > other.x &&
          position.y < other.y + other.height + spacing &&
          position.y + size.height + spacing > other.y,
      ))
    )
      position.y = collision.y + collision.height + spacing;
    placed.push({ ...position, ...size });
  }
  return {
    positions,
    width: Math.max(
      ...nodes.map(
        (node) => positions.get(node.id).x + geometry.get(node.id).width,
      ),
    ),
    height: Math.max(
      ...nodes.map(
        (node) => positions.get(node.id).y + geometry.get(node.id).height,
      ),
    ),
  };
}

export async function organizeGraph(
  graph,
  { geometry: inputGeometry = {} } = {},
) {
  const measured = geometrySchema.parse(inputGeometry);
  const result = structuredClone(graph);
  // A saved camera can point outside the newly arranged canvas. The viewer fits
  // graphs without a viewport, while UI organization saves its animated fit.
  if (result.nodes.length) delete result.viewport;
  const byId = new Map(result.nodes.map((node) => [node.id, node]));
  if (byId.size !== result.nodes.length)
    throw new Error("Node IDs must be unique.");
  for (const edge of result.edges)
    if (!byId.has(edge.source) || !byId.has(edge.target))
      throw new Error("Cannot organize an edge with a missing node.");
  const diagnostics = { estimatedNodeIds: [], warnings: [] };
  const sections = ordered(
    result.nodes.filter((node) => node.type === "section"),
  );
  const cards = ordered(result.nodes.filter((node) => node.type !== "section"));
  const sizes = new Map();
  for (const node of cards) {
    sizes.set(node.id, measured[node.id] || estimatedGeometry(node));
    if (!measured[node.id]) diagnostics.estimatedNodeIds.push(node.id);
  }
  for (const id of Object.keys(measured).sort(compare))
    if (!byId.has(id))
      diagnostics.warnings.push(
        `Ignored measurements for missing node “${id}”.`,
      );
  const owner = new Map();
  for (const section of sections)
    for (const id of [...new Set(section.data.members || [])].sort(compare)) {
      if (!byId.has(id) || byId.get(id).type === "section")
        diagnostics.warnings.push(
          `Frame “${section.id}” has an invalid member “${id}”; its membership was preserved.`,
        );
      else if (owner.has(id))
        diagnostics.warnings.push(
          `Node “${id}” belongs to multiple frames; “${owner.get(id)}” controls its placement.`,
        );
      else owner.set(id, section.id);
    }
  const sectionContents = new Map();
  for (const section of sections) {
    const members = cards.filter((node) => owner.get(node.id) === section.id);
    const ids = new Set(members.map((node) => node.id));
    const arranged = await layout(
      members,
      result.edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
      sizes,
    );
    const width = members.length
      ? Math.max(200, arranged.width + padding.left + padding.right)
      : section.data.width || 1200;
    const height = members.length
      ? Math.max(100, arranged.height + padding.top + padding.bottom)
      : section.data.height || 650;
    if (width > 8000 || height > 8000)
      throw new Error(
        `Frame “${section.data.label || section.id}” would exceed 8000 pixels. Split this flow into smaller frames before organizing.`,
      );
    section.data.width = width;
    section.data.height = height;
    sizes.set(section.id, { width, height });
    sectionContents.set(section.id, arranged.positions);
  }
  const roots = result.nodes.filter(
    (node) => node.type === "section" || !owner.has(node.id),
  );
  const rootEdges = [];
  const pairs = new Set();
  for (const edge of ordered(result.edges)) {
    const source = owner.get(edge.source) || edge.source,
      target = owner.get(edge.target) || edge.target;
    if (source === target) continue;
    const key = JSON.stringify([source, target]);
    if (pairs.has(key)) continue;
    pairs.add(key);
    // Frames have no execution ports. These temporary ports exist only inside the layout engine.
    rootEdges.push({
      id: `layout-${rootEdges.length}`,
      source,
      target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    });
  }
  const outer = await layout(roots, rootEdges, sizes);
  for (const node of result.nodes) {
    const sectionId = owner.get(node.id);
    if (sectionId) {
      const outerPosition = outer.positions.get(sectionId),
        innerPosition = sectionContents.get(sectionId).get(node.id);
      node.position = {
        x: outerPosition.x + innerPosition.x + padding.left,
        y: outerPosition.y + innerPosition.y + padding.top,
      };
    } else node.position = outer.positions.get(node.id);
  }
  return { graph: result, diagnostics };
}
