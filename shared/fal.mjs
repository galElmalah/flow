import { z } from "zod";

export const falConnectionSchema = z
  .object({
    apiKey: z.union([z.string().trim().min(1).max(4096), z.null()]).optional(),
  })
  .strict();
export const FAL_IMAGE_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "21:9",
];
export const FAL_VIDEO_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "21:9",
  "4:3",
  "3:4",
  "auto",
];
export const falModels = [
  ...["2.5", "2.0"].flatMap((version) =>
    ["text", "image", "reference"].map((mode) => ({
      id: `bytedance/seedance-${version}/${mode}-to-video`,
      label: `Seedance ${version} · ${mode === "text" ? "Text" : mode === "image" ? "First frame" : "References"}`,
      family: "bytedance",
      capabilities: ["video"],
      acceptsImages: mode !== "text",
      minImages: mode === "text" ? 0 : 1,
      maxImages:
        mode === "text" ? 0 : mode === "image" ? 2 : version === "2.5" ? 30 : 9,
      ratios: mode === "image" ? ["auto"] : FAL_VIDEO_RATIOS,
      videoModes: [mode],
      videoResolutions:
        version === "2.5"
          ? ["480p", "720p", "1080p"]
          : ["480p", "720p", "1080p", "4k"],
      durationSeconds: { min: 4, max: version === "2.5" ? 30 : 15, default: 8 },
      seeded: false,
    })),
  ),
  ...["text-to-image", "edit"].map((mode) => ({
    id: `bytedance/seedream/v5/flash/${mode}`,
    label: `Seedream 5.0 Flash · ${mode === "edit" ? "Edit / references" : "Text"}`,
    family: "bytedance",
    capabilities: ["image"],
    acceptsImages: mode === "edit",
    minImages: mode === "edit" ? 1 : 0,
    maxImages: mode === "edit" ? 10 : 0,
    ratios: FAL_IMAGE_RATIOS,
    imageResolutions: ["1k", "1.5k", "2k"],
    qualities: ["auto"],
    seeded: false,
  })),
  {
    id: "fal-ai/flux/schnell",
    label: "FLUX.1 schnell",
    family: "flux",
    capabilities: ["image"],
    acceptsImages: false,
    minImages: 0,
    maxImages: 0,
    ratios: FAL_IMAGE_RATIOS,
    imageResolutions: ["1k"],
    qualities: ["auto"],
    seeded: true,
  },
];
export const falModel = (id) => falModels.find((model) => model.id === id);
export function falDefaults(model) {
  return model.capabilities.includes("video")
    ? {
        ratio: model.ratios[0],
        video: {
          resolution: "720p",
          durationSeconds: model.durationSeconds.default,
          mode: model.videoModes[0],
        },
      }
    : { quality: "auto", image: { resolution: model.imageResolutions[0] } };
}
