import { z } from "zod";
import { projectIdSchema } from "../projects.mjs";

export const styleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
export const styleReferenceSchema = z
  .object({
    url: z.string().min(1).max(500),
    label: z.string().trim().min(1).max(160),
    kind: z.enum(["generated", "uploaded"]),
    scene: z.string().max(16000).optional(),
    prompt: z.string().max(16000).optional(),
    source: z
      .object({
        url: z
          .url()
          .max(2048)
          .refine(
            (url) => /^https?:\/\//.test(url),
            "Use an HTTP or HTTPS source URL.",
          )
          .optional(),
        creator: z.string().max(200).optional(),
        license: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    runId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .optional(),
    jobId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    if (
      reference.kind === "generated" &&
      (!reference.runId || !reference.jobId)
    )
      context.addIssue({
        code: "custom",
        message: "Generated references require runId and jobId.",
      });
    if (reference.kind === "uploaded" && (reference.runId || reference.jobId))
      context.addIssue({
        code: "custom",
        message:
          "Uploaded references cannot claim generated run/job provenance.",
      });
  });
export const styleDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
    prompt: z.string().trim().min(1).max(12000),
    scene: z.string().trim().max(16000),
    tags: z.array(z.string().trim().min(1).max(100)).max(30),
  })
  .strict();
export const createStyleSchema = styleDefinitionSchema
  .extend({
    id: styleIdSchema.optional(),
    category: styleDefinitionSchema.shape.category.default("Custom"),
    description: styleDefinitionSchema.shape.description.default(""),
    prompt: styleDefinitionSchema.shape.prompt.default(
      "Use the reference images for visual style. Create a fresh composition for the requested subject.",
    ),
    scene: styleDefinitionSchema.shape.scene.default(""),
    tags: styleDefinitionSchema.shape.tags.default([]),
    references: z.array(styleReferenceSchema).max(16).default([]),
  })
  .strict();
export const updateStyleSchema = styleDefinitionSchema
  .partial()
  .extend({
    references: z.array(styleReferenceSchema).max(16).optional(),
  })
  .strict()
  .refine(
    (input) => Object.keys(input).length > 0,
    "Provide fields to update.",
  );
export const appliedStyleSchema = z.object({
  id: styleIdSchema,
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(120),
  prompt: z.string().min(1).max(12000),
  referenceUrls: z.array(z.string().max(500)).max(16),
});
export const startStyleSchema = z
  .object({
    projectId: projectIdSchema.nullable().optional(),
    subject: z.string().max(16000).optional(),
    name: z.string().min(1).max(120).optional(),
    referenceUrl: z.string().max(500).optional(),
  })
  .strict();
export const styleListSchema = z
  .object({
    search: z.string().max(500).optional(),
    category: z.string().max(120).optional(),
    favorites: z.enum(["true", "false", "1", "0"]).optional(),
  })
  .strict();
export const styleFavoriteSchema = z.object({ favorite: z.boolean() }).strict();
export const styleReferencesSchema = z
  .object({
    references: z.array(styleReferenceSchema).max(16),
  })
  .strict();
