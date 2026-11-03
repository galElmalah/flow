import { z } from "zod";

export const loopbackEndpointSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (!url.pathname || url.pathname === "/")
  );
}, "Use a loopback HTTP(S) server origin, without path, credentials or query.");
export const localRuntimeSchema = z.enum(["ollama", "comfyui"]);
export const localRuntimeConfigSchema = z
  .object({ baseUrl: loopbackEndpointSchema })
  .strict();
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const nodeId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const filename = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.startsWith("/") &&
      value.split("/").every((part) => part && ![".", ".."].includes(part)),
    "Use a relative model filename without traversal.",
  );
const jsonValue = z.json();
export const comfyBindingSchema = z
  .object({
    nodeId,
    input: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  })
  .strict();
export const comfyProfileSchema = z
  .object({
    id,
    name: z.string().min(1).max(120),
    kind: z.enum(["image", "video"]),
    graph: z
      .record(
        nodeId,
        z
          .object({
            class_type: z.string().regex(/^[a-zA-Z0-9_.: -]{1,160}$/),
            inputs: z.record(z.string().min(1).max(100), jsonValue),
            _meta: z.record(z.string(), jsonValue).optional(),
          })
          .strict(),
      )
      .refine(
        (graph) =>
          Object.keys(graph).length > 0 && Object.keys(graph).length <= 200,
        "An API workflow must contain 1–200 nodes.",
      ),
    bindings: z
      .object({
        prompt: comfyBindingSchema,
        seed: comfyBindingSchema.optional(),
        width: comfyBindingSchema.optional(),
        height: comfyBindingSchema.optional(),
        images: z.array(comfyBindingSchema).max(14).optional(),
      })
      .strict(),
    output: z
      .object({
        nodeId,
        field: z.enum(["images", "gifs", "videos"]),
        index: z.number().int().min(0).max(99).default(0),
      })
      .strict(),
    resolution: z
      .object({
        longEdge: z.number().int().min(512).max(4096),
        multiple: z.union([z.literal(16), z.literal(64)]),
      })
      .strict()
      .optional(),
    requiredModels: z
      .array(
        z
          .object({
            folder: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
            filename,
            sha256: z
              .string()
              .regex(/^[a-fA-F0-9]{64}$/)
              .optional(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (JSON.stringify(profile).length > 512 * 1024)
      ctx.addIssue({ code: "custom", message: "API workflow exceeds 512 KB." });
    for (const binding of [
      profile.bindings.prompt,
      profile.bindings.seed,
      profile.bindings.width,
      profile.bindings.height,
      ...(profile.bindings.images || []),
    ].filter(Boolean)) {
      const value = profile.graph[binding.nodeId]?.inputs[binding.input];
      if (!["string", "number", "boolean"].includes(typeof value))
        ctx.addIssue({
          code: "custom",
          message: `Binding ${binding.nodeId}.${binding.input} must target an existing scalar input, not a node link.`,
        });
    }
    if (!profile.graph[profile.output.nodeId])
      ctx.addIssue({
        code: "custom",
        message: "Output node does not exist in the API workflow.",
      });
    if (profile.kind === "image" && profile.output.field !== "images")
      ctx.addIssue({
        code: "custom",
        message: "Image profiles must select an images output.",
      });
  });

export const comfyCheckpointRecipeSchema = z
  .object({
    id,
    name: z.string().min(1).max(120),
    checkpoint: filename,
    imageToImage: z.boolean().default(false),
  })
  .strict();
export function createCheckpointProfile(input) {
  const { id, name, checkpoint, imageToImage } =
    comfyCheckpointRecipeSchema.parse(input);
  return comfyProfileSchema.parse({
    id,
    name,
    kind: "image",
    graph: {
      3: {
        class_type: "KSampler",
        inputs: {
          seed: 42,
          steps: 20,
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: imageToImage ? 0.65 : 1,
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0],
        },
      },
      4: {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: checkpoint },
      },
      5: imageToImage
        ? {
            class_type: "VAEEncode",
            inputs: { pixels: ["10", 0], vae: ["4", 2] },
          }
        : {
            class_type: "EmptyLatentImage",
            inputs: { width: 768, height: 512, batch_size: 1 },
          },
      6: {
        class_type: "CLIPTextEncode",
        inputs: { text: "A scene", clip: ["4", 1] },
      },
      7: {
        class_type: "CLIPTextEncode",
        inputs: { text: "text, watermark", clip: ["4", 1] },
      },
      8: {
        class_type: "VAEDecode",
        inputs: { samples: ["3", 0], vae: ["4", 2] },
      },
      9: {
        class_type: "SaveImage",
        inputs: { filename_prefix: "weft", images: ["8", 0] },
      },
      ...(imageToImage
        ? {
            10: {
              class_type: "LoadImage",
              inputs: { image: "weft-input.png" },
            },
          }
        : {}),
    },
    bindings: {
      prompt: { nodeId: "6", input: "text" },
      seed: { nodeId: "3", input: "seed" },
      ...(imageToImage
        ? { images: [{ nodeId: "10", input: "image" }] }
        : {
            width: { nodeId: "5", input: "width" },
            height: { nodeId: "5", input: "height" },
          }),
    },
    output: { nodeId: "9", field: "images" },
    requiredModels: [{ folder: "checkpoints", filename: checkpoint }],
  });
}
