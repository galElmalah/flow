import { z } from "zod";

export const geminiVideoConnectionSchema = z
  .object({
    authMode: z.enum(["api-key", "oauth-adc", "oauth-token"]).optional(),
    apiKey: z.union([z.string().trim().min(1).max(4096), z.null()]).optional(),
    quotaProject: z
      .union([
        z
          .string()
          .trim()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/),
        z.null(),
      ])
      .optional(),
  })
  .strict();
