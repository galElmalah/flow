import { z } from "zod";
import { workflowSchema } from "./graph.mjs";

export const flowFileExtension = ".flow.json";
export const flowFileSchema = z
  .object({
    format: z.literal("flow"),
    version: z.literal(1),
    workflow: workflowSchema,
  })
  .strict();

export const toFlowFile = (workflow) =>
  flowFileSchema.parse({
    format: "flow",
    version: 1,
    workflow,
  });

export function fromFlowFile(input) {
  if (input && typeof input === "object" && Object.hasOwn(input, "format"))
    return flowFileSchema.parse(input).workflow;
  return workflowSchema.parse(input);
}

export function flowFileName(name = "workflow") {
  return name.replace(/(?:\.flow)?\.json$|\.flow$/i, "") + flowFileExtension;
}
