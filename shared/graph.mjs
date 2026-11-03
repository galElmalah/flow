import { z } from "zod";
import {
  ratioSchema,
  qualitySchema,
  imageSettingsSchema,
  videoSettingsSchema,
  generationModesSchema,
} from "./generation-modes.mjs";
import { projectIdSchema } from "./projects.mjs";
import { appliedRuleSchema, ruleNodeTypes } from "./rule-templates.mjs";
import { appliedStyleSchema } from "./styles/schema.mjs";
import { imageEditModeSchema, imageEditColorSchema } from "./image-editor.mjs";
import { promptItemsSchema } from "./prompt-sets.mjs";

const nodeData = z.object({
  label: z.string().max(120).default("Untitled"),
  text: z.string().max(32000).optional(),
  prompts: promptItemsSchema.optional(),
  rules: z.array(appliedRuleSchema).max(40).optional(),
  style: appliedStyleSchema.optional(),
  edit: z
    .object({
      editorId: z.string().regex(/^[a-f0-9]{32}$/),
      requestId: z.string().uuid(),
      mode: imageEditModeSchema.optional(),
      familyId: z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .optional(),
      sourceHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      color: imageEditColorSchema.optional(),
      strength: z.number().min(0).max(1).optional(),
      source: z.string().max(500),
      regionIds: z.array(z.string().max(100)).max(160),
      mask: z.string().max(500),
      overlay: z.string().max(500),
    })
    .optional(),
  lines: z.string().max(32000).optional(),
  filterField: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/)
    .optional(),
  filterValues: z.array(z.string().max(300)).max(100).optional(),
  width: z.number().min(200).max(8000).optional(),
  height: z.number().min(100).max(8000).optional(),
  subtitle: z.string().max(500).optional(),
  tone: z.enum(["quote", "cover", "neutral"]).optional(),
  members: z.array(z.string().max(100)).max(150).optional(),
  images: z.array(z.string().max(500)).max(16).optional(),
  records: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        fields: z
          .record(
            z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/),
            z.string().max(16000),
          )
          .refine(
            (v) => Object.keys(v).length > 0 && Object.keys(v).length <= 100,
          ),
        images: z.array(z.string().max(500)).max(16).optional(),
      }),
    )
    .max(500)
    .optional(),
  count: z.number().int().min(1).max(500).optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  ratio: ratioSchema.optional(),
  quality: qualitySchema.optional(),
  image: imageSettingsSchema.optional(),
  video: videoSettingsSchema.optional(),
  modes: generationModesSchema.optional(),
  preview: z.string().max(500).optional(),
  providerId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .optional(),
  model: z.string().min(1).max(120).optional(),
});
export const workflowSchema = z.object({
  revision: z.number().int().min(0).default(0),
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(80),
  name: z.string().min(1).max(120),
  projectId: projectIdSchema.nullable().optional(),
  forkedFrom: z
    .object({
      workflowId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
      name: z.string().min(1).max(120),
      createdAt: z.iso.datetime(),
    })
    .optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        type: z.enum([
          "image",
          "prompt",
          "dataset",
          "prompt-set",
          "filter",
          "section",
          "template",
          "prompt-generate",
          "variations",
          "generate",
          "output",
          "video-generate",
          "video-output",
        ]),
        position: z.object({ x: z.number().finite(), y: z.number().finite() }),
        data: nodeData,
      }),
    )
    .max(150),
  edges: z
    .array(
      z.object({
        id: z.string().max(100),
        source: z.string(),
        target: z.string(),
        sourceHandle: z.string().nullable().optional(),
        targetHandle: z.string().nullable().optional(),
      }),
    )
    .max(500),
  viewport: z
    .object({ x: z.number(), y: z.number(), zoom: z.number().min(0.1).max(3) })
    .optional(),
});
export const outputType = (type) =>
  ["section", "video-output"].includes(type)
    ? null
    : type === "video-generate"
      ? "video"
      : ["image", "generate", "output"].includes(type)
        ? "image"
        : "text";
export const inputTypes = {
  image: [],
  dataset: [],
  "prompt-set": ["text", "image"],
  section: [],
  filter: ["text"],
  template: ["text", "image"],
  prompt: ["text", "image"],
  "prompt-generate": ["text", "image"],
  variations: ["text"],
  generate: ["text", "image"],
  output: ["image"],
  "video-generate": ["text", "image"],
  "video-output": ["video"],
};

export function validateGraph(input) {
  const graph = workflowSchema.parse(input);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (byId.size !== graph.nodes.length)
    throw new Error("Node IDs must be unique.");
  for (const node of graph.nodes) {
    if (node.data.prompts && node.type !== "prompt-set")
      throw new Error("Scene collections belong to a Prompt Set node.");
    if (node.data.modes && !["generate", "video-generate"].includes(node.type))
      throw new Error(
        "Generation modes belong to an image or video generation node.",
      );
    if (node.data.image && node.type !== "generate")
      throw new Error("Image settings belong to an image generation node.");
    if (
      node.data.modes?.some((mode) =>
        node.type === "generate" ? Boolean(mode.video) : Boolean(mode.image),
      )
    )
      throw new Error("Mode settings must match the node's media type.");
    if (node.data.video && node.type !== "video-generate")
      throw new Error("Video settings belong to a video generation node.");
    if (node.type === "video-generate" && node.data.edit)
      throw new Error("Image region edits cannot generate video.");
    if (node.data.rules?.length && !ruleNodeTypes.includes(node.type))
      throw new Error(`Rules cannot be attached to ${node.type} nodes.`);
    const ids = (node.data.rules || []).map((r) => r.id);
    if (new Set(ids).size !== ids.length)
      throw new Error(`Rule IDs must be unique within “${node.data.label}”.`);
  }
  for (const n of graph.nodes)
    if (
      n.type === "dataset" &&
      n.data.records &&
      new Set(n.data.records.map((r) => r.id)).size !== n.data.records.length
    )
      throw new Error("Record IDs must be unique.");
  const edgeIds = new Set();
  for (const e of graph.edges) {
    const source = byId.get(e.source),
      target = byId.get(e.target);
    if (!source || !target)
      throw new Error("A connection refers to a missing node.");
    if (edgeIds.has(e.id)) throw new Error("Connection IDs must be unique.");
    edgeIds.add(e.id);
    const type = outputType(source.type);
    if (
      !inputTypes[target.type].includes(type) ||
      (e.sourceHandle && e.sourceHandle !== type) ||
      (e.targetHandle && e.targetHandle !== type)
    )
      throw new Error(
        `Cannot connect ${source.type} to ${target.type} using that socket.`,
      );
  }
  const order = [],
    visiting = new Set(),
    visited = new Set();
  function visit(id) {
    if (visiting.has(id))
      throw new Error(
        "This connection creates a loop. Workflows must flow in one direction.",
      );
    if (visited.has(id)) return;
    visiting.add(id);
    graph.edges.filter((e) => e.target === id).forEach((e) => visit(e.source));
    visiting.delete(id);
    visited.add(id);
    order.push(byId.get(id));
  }
  graph.nodes.forEach((n) => visit(n.id));
  return { graph, order };
}
