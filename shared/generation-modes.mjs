import { z } from "zod";

export const ratioSchema = z.enum([
  "1:1",
  "2:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "1:2",
  "19.5:9",
  "9:19.5",
  "20:9",
  "9:20",
  "21:9",
  "5:2",
  "auto",
]);
export const qualitySchema = z.enum(["auto", "high", "medium", "low"]);
export const imageSettingsSchema = z
  .object({
    resolution: z.enum(["1k", "1.5k", "2k"]).optional(),
  })
  .strict();
export const videoSettingsSchema = z
  .object({
    resolution: z.enum(["360p", "480p", "720p", "1080p", "4k"]).default("720p"),
    durationSeconds: z.number().int().min(1).max(30).optional(),
    mode: z.enum(["text", "image", "reference"]).optional(),
  })
  .strict();
export const generationModeSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    label: z.string().min(1).max(120),
    providerId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    model: z.string().min(1).max(120).optional(),
    count: z.number().int().min(1).max(500).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    ratio: ratioSchema.optional(),
    quality: qualitySchema.optional(),
    image: imageSettingsSchema.optional(),
    video: videoSettingsSchema.optional(),
  })
  .strict();
export const generationModesSchema = z
  .array(generationModeSchema)
  .min(1)
  .max(12)
  .refine(
    (modes) => new Set(modes.map((mode) => mode.id)).size === modes.length,
    "Generation mode IDs must be unique within a node.",
  );

export function generationModes(data, kind, options = {}) {
  if (
    data.modes &&
    (options.providerId !== undefined || options.model !== undefined)
  )
    throw new Error(
      "This node has generation modes. Edit its modes instead of overriding --provider or --model.",
    );
  return (
    data.modes || [
      {
        id: "default",
        label: data.label,
        providerId:
          (kind === "text" ? options.promptProviderId : options.providerId) ||
          data.providerId ||
          (kind === "text"
            ? "codex-text"
            : kind === "video"
              ? "gemini-video"
              : "codex"),
        model:
          (kind === "text" ? options.promptModel : options.model) ||
          ((kind === "text" ? options.promptProviderId : options.providerId) &&
          (kind === "text" ? options.promptProviderId : options.providerId) !==
            data.providerId
            ? undefined
            : data.model),
        count: kind === "text" ? 1 : (data.count ?? 1),
      },
    ]
  );
}

export function modeSummary(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const key = `${job.nodeId}/${job.mode?.id || "default"}`;
    const group = groups.get(key) || {
      nodeId: job.nodeId,
      modeId: job.mode?.id || "default",
      label: job.mode?.label || job.label,
      providerId: job.providerId,
      model: job.model || null,
      kind: job.kind,
      count: 0,
    };
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()];
}
