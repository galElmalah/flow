import { z } from "zod";

export const grokConnectionSchema = z
  .object({
    apiKey: z.union([z.string().trim().min(1).max(4096), z.null()]).optional(),
  })
  .strict();

export const GROK_IMAGE_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "19.5:9",
  "9:19.5",
  "20:9",
  "9:20",
  "21:9",
  "5:2",
  "auto",
];
export const GROK_VIDEO_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "5:2",
];
export const grokModels = [
  {
    id: "grok-imagine-image-2.0",
    label: "Imagine Image 2.0",
    capabilities: ["image"],
    acceptsImages: true,
    maxImages: 5,
    ratios: GROK_IMAGE_RATIOS,
    qualities: ["low", "medium", "auto"],
    imageResolutions: ["1k", "1.5k", "2k"],
  },
  {
    id: "grok-imagine-video-1.5",
    label: "Imagine Video 1.5",
    capabilities: ["video"],
    acceptsImages: true,
    maxImages: 14,
    ratios: GROK_VIDEO_RATIOS,
    videoResolutions: ["480p", "720p", "1080p"],
    videoModes: ["text", "image", "reference"],
    durationSeconds: { min: 1, max: 15, default: 8 },
    referenceMaxResolution: "720p",
  },
  {
    id: "grok-imagine-video-1.5-lite",
    label: "Imagine Video 1.5 Lite",
    capabilities: ["video"],
    acceptsImages: true,
    maxImages: 1,
    ratios: GROK_VIDEO_RATIOS,
    videoResolutions: ["480p", "720p", "1080p"],
    videoModes: ["text", "image"],
    durationSeconds: { min: 1, max: 15, default: 8 },
    resolutionNote: "1080p is upscaled from 720p.",
  },
];
export const grokModel = (id) => grokModels.find((model) => model.id === id);
