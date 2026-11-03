import { z } from "zod";

export const codexAuthMode = z.enum(["harness", "oauth", "api-key"]);
export const codexConnectionSchema = z
  .object({
    mode: codexAuthMode,
    apiKey: z.string().trim().min(1).max(4096).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.apiKey && value.mode !== "api-key")
      context.addIssue({
        code: "custom",
        message: "An API key requires API-key mode.",
      });
  });
