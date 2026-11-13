import { z } from "zod";
import { reasoningEffortSchema } from "./reasoning.mjs";
import { workflowSchema, validateGraph } from "./graph.mjs";
import { projectIdSchema } from "./projects.mjs";
import { styleIdSchema } from "./styles/schema.mjs";

const node = workflowSchema.shape.nodes.element;
const edge = workflowSchema.shape.edges.element;
const partialNodeData = node.shape.data
  .extend({ label: z.string().max(120).optional() })
  .partial()
  .strict();
const id = z.string().min(1).max(100);
export const agentSessionSchema = z
  .object({
    projectId: projectIdSchema.optional(),
    fresh: z.boolean().optional(),
  })
  .strict();
export const agentContextSchema = z
  .object({
    page: z.enum([
      "projects",
      "settings",
      "canvas",
      "gallery",
      "styles",
      "editor",
      "recorded",
    ]),
    styleId: styleIdSchema.optional(),
    workflowId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .optional(),
    revision: z.number().int().min(0).optional(),
    selectedNodeIds: z.array(id).max(150).default([]),
    runId: z.string().uuid().optional(),
    editorId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    regionIds: z.array(id).max(160).default([]),
    image: z
      .object({
        output: z.string().max(500),
        runId: z.string().uuid().optional(),
        jobId: z.string().uuid().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const agentEditSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("update-node"), nodeId: id, data: partialNodeData })
    .strict(),
  z
    .object({ op: z.literal("rename"), name: workflowSchema.shape.name })
    .strict(),
  z.object({ op: z.literal("add-node"), node }).strict(),
  z.object({ op: z.literal("remove-node"), nodeId: id }).strict(),
  z.object({ op: z.literal("connect"), edge }).strict(),
  z.object({ op: z.literal("disconnect"), edgeId: id }).strict(),
]);
export const agentAnswerSchema = z
  .object({
    message: z.string().trim().min(1).max(16000),
    edits: z.array(agentEditSchema).max(200).default([]),
    focusNodeIds: z.array(id).max(150).default([]),
  })
  .strict();
export const askAgentSchema = z
  .object({
    id: z.string().uuid(),
    message: z.string().trim().min(1).max(16000),
    providerId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .default("codex-text"),
    model: z.string().min(1).max(120).default("default"),
    reasoningEffort: reasoningEffortSchema.optional(),
    context: agentContextSchema,
  })
  .strict();

export function applyAgentEdits(input, edits) {
  const graph = structuredClone(input);
  const changed = new Set();
  const requireNode = (nodeId) => {
    const found = graph.nodes.find((n) => n.id === nodeId);
    if (!found) throw new Error(`Node ${nodeId} does not exist.`);
    return found;
  };
  for (const edit of z.array(agentEditSchema).max(200).parse(edits)) {
    if (edit.op === "rename") graph.name = edit.name;
    else if (edit.op === "update-node") {
      const target = requireNode(edit.nodeId);
      target.data = { ...target.data, ...edit.data };
      changed.add(target.id);
    } else if (edit.op === "add-node") {
      graph.nodes.push(edit.node);
      changed.add(edit.node.id);
    } else if (edit.op === "remove-node") {
      requireNode(edit.nodeId);
      graph.nodes = graph.nodes.filter((n) => n.id !== edit.nodeId);
      graph.edges = graph.edges.filter(
        (e) => e.source !== edit.nodeId && e.target !== edit.nodeId,
      );
      changed.add(edit.nodeId);
    } else if (edit.op === "connect") {
      graph.edges.push(edit.edge);
      changed.add(edit.edge.source);
      changed.add(edit.edge.target);
    } else {
      const existing = graph.edges.find((e) => e.id === edit.edgeId);
      if (!existing)
        throw new Error(`Connection ${edit.edgeId} does not exist.`);
      graph.edges = graph.edges.filter((e) => e.id !== edit.edgeId);
      changed.add(existing.source);
      changed.add(existing.target);
    }
  }
  return { graph: validateGraph(graph).graph, changedNodeIds: [...changed] };
}
