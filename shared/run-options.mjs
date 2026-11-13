import { z } from "zod";
import { promptSetSelectionSchema } from "./prompt-sets.mjs";

export const runOptionsSchema = z
  .object({
    nodeId: z.string().min(1).max(100).optional(),
    providerId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .optional(),
    model: z.string().min(1).max(120).optional(),
    promptProviderId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .optional(),
    promptModel: z.string().min(1).max(120).optional(),
    count: z.number().int().min(1).max(500).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    promptSet: promptSetSelectionSchema.optional(),
  })
  .strict();

/** Submission controls are separate from overrides in the recorded graph. */
export const runSubmissionSchema = z
  .object({
    concurrency: z.number().int().min(1).max(128).optional(),
    requestId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
      .optional(),
  })
  .strict();
