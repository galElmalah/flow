import { z } from "zod";

export const projectIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const workflowId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const projectName = z.string().trim().min(1).max(120);

export const projectInputSchema = z
  .object({
    id: projectIdSchema.optional(),
    name: projectName,
    root: z.string().min(1).max(4096),
    kind: z.enum(["project", "library"]).optional(),
  })
  .strict();

export const projectUpdateSchema = z
  .object({
    name: projectName.optional(),
    kind: z.enum(["project", "library"]).optional(),
    defaultWorkflowId: workflowId.nullable().optional(),
  })
  .strict();

export const projectSchema = projectInputSchema.extend({
  id: projectIdSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  defaultWorkflowId: workflowId.optional(),
});

export const projectManifestSchema = z
  .object({
    version: z.literal(1),
    projectId: projectIdSchema,
    serverUrl: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        url.pathname === "/" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, "Use a localhost HTTP platform URL without credentials, path, query or fragment"),
    defaultWorkflowId: workflowId.optional(),
  })
  .strict();
