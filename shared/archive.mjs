import { z } from "zod";
import { projectIdSchema } from "./projects.mjs";
export const archiveFilterSchema = z.enum(["active", "archived", "all"]);
export const archiveWorkflowsSchema = z
  .object({
    ids: z
      .array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/))
      .min(1)
      .max(200),
    archived: z.boolean(),
    reason: z.string().max(500).optional(),
    projectId: projectIdSchema.optional(),
  })
  .strict();
export const archiveProjectSchema = z
  .object({ archived: z.boolean(), reason: z.string().max(500).optional() })
  .strict();
