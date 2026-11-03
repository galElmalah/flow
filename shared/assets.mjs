import { z } from "zod";
import { projectIdSchema } from "./projects.mjs";
export const assetIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const assetAnnotationsSchema = z
  .object({
    revision: z.number().int().min(0),
    caption: z.string().trim().max(8000).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    decision: z.enum(["unreviewed", "accepted", "rejected"]).optional(),
    training: z
      .object({
        allowed: z.boolean(),
        rights: z.enum(["unknown", "confirmed", "restricted"]),
        notes: z.string().trim().max(4000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const assetAnnotationRequestSchema = assetAnnotationsSchema.extend({
  projectId: projectIdSchema.nullable().optional(),
});
export const datasetModeSchema = z.enum(["all", "training"]);
