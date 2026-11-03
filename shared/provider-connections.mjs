import { z } from "zod";

export const endpointSchema = z.url().refine((s) => {
  const u = new URL(s);
  return (
    ["http:", "https:"].includes(u.protocol) &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash
  );
}, "Use an HTTP(S) base URL without credentials, query or fragment");
export const connectionSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: endpointSchema,
  models: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        capabilities: z
          .array(z.enum(["text", "image"]))
          .min(1)
          .max(2),
        acceptsImages: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(100),
  apiKey: z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("keep") }),
      z.object({ action: z.literal("clear") }),
      z.object({
        action: z.literal("replace"),
        value: z.string().min(1).max(4096),
      }),
    ])
    .default({ action: "keep" }),
});
