import { z } from "zod";
import { ratioSchema } from "./generation-modes.mjs";

export const promptSettingsSchema = z
  .object({
    count: z.number().int().min(1).max(500).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    ratio: ratioSchema.optional(),
  })
  .strict();
export const promptItemSchema = promptSettingsSchema
  .extend({
    id: z.string().min(1).max(160),
    label: z.string().min(1).max(120),
    scene: z.string().max(16000),
    concept: z.string().max(16000).optional(),
    enabled: z.boolean().optional(),
    images: z.array(z.string().max(500)).max(16).optional(),
  })
  .strict();
export const promptItemsSchema = z
  .array(promptItemSchema)
  .max(500)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "Prompt Set scene IDs must be unique.",
  );
export const promptSetSelectionSchema = z
  .object({
    nodeId: z.string().min(1).max(100),
    itemIds: z
      .array(z.string().min(1).max(160))
      .min(1)
      .max(500)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Select each scene only once.",
      )
      .optional(),
  })
  .strict();
export const defaultPromptTemplate = "SCENE\n{{scene}}\n\nCONCEPT\n{{concept}}";
export const promptItemFields = (item) => ({
  title: item.label,
  scene: item.scene,
  concept: item.concept || "",
});
export const promptSettings = (data) =>
  Object.fromEntries(
    ["count", "seed", "ratio"]
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]]),
  );
export function promptItemJobs(jobs, nodeId, itemId) {
  return jobs.filter(
    (job) =>
      job.promptSet?.nodeId === nodeId && job.promptSet.itemId === itemId,
  );
}
export function promptItemStatus(jobs) {
  if (!jobs.length) return "Not run";
  if (jobs.some((job) => job.status === "running")) return "Generating";
  if (jobs.some((job) => job.status === "queued")) return "Queued";
  if (jobs.some((job) => job.status === "failed")) return "Failed";
  if (jobs.every((job) => job.status === "completed")) return "Complete";
  return "Stopped";
}
