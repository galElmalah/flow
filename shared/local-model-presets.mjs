import { z } from "zod";
import { comfyProfileSchema } from "./local-models.mjs";

// Official Comfy-Org weights pinned by revision and published LFS SHA-256.
export const localModelPresets = [
  {
    id: "moss-image-sft",
    name: "MOSS-Image SFT \u00b7 BF16",
    runtime: "comfyui",
    kind: "image",
    description:
      "Text-to-image \u00b7 native ComfyUI \u00b7 no direct image conditioning",
    license: "Apache-2.0",
    source: "https://github.com/OpenMOSS/MOSS-Image",
    weights: [
      {
        folder: "diffusion_models",
        filename: "moss_image_sft_bf16.safetensors",
        sha256:
          "f96738d8116d78b7316b57c663d8c98591ddafab7488f48e3099b7655e34ab6f",
        sizeBytes: 10164655808,
        url: "https://huggingface.co/Comfy-Org/MOSS-Image/resolve/530a4c94f92c35ef6818b1b035a983fe9dcf5f54/diffusion_models/moss_image_sft_bf16.safetensors",
      },
      {
        folder: "text_encoders",
        filename: "qwen3.5_9b_bf16.safetensors",
        sha256:
          "7e6e9f08d598f829cb940e60ac0c698e1f1c27a47daffd7e598cd78c78b4cc53",
        sizeBytes: 19306312328,
        url: "https://huggingface.co/Comfy-Org/MOSS-Image/resolve/530a4c94f92c35ef6818b1b035a983fe9dcf5f54/text_encoders/qwen3.5_9b_bf16.safetensors",
      },
      {
        folder: "vae",
        filename: "flux2-vae_small.safetensors",
        sha256:
          "d8d52ba036475f5fb07c8b435e176d3d97ebfa82f0d1a1c317f9cc1e25bd013b",
        sizeBytes: 249521340,
        url: "https://huggingface.co/Comfy-Org/MOSS-Image/resolve/530a4c94f92c35ef6818b1b035a983fe9dcf5f54/vae/flux2-vae_small.safetensors",
      },
    ],
  },
  {
    id: "moss-image-sft-int8",
    name: "MOSS-Image SFT \u00b7 INT8",
    runtime: "comfyui",
    kind: "image",
    description:
      "Text-to-image \u00b7 native ComfyUI \u00b7 no direct image conditioning",
    license: "Apache-2.0",
    source: "https://github.com/OpenMOSS/MOSS-Image",
    weights: [
      {
        folder: "diffusion_models",
        filename: "moss_image_sft_int8_convrot.safetensors",
        sha256:
          "b4d1475bc7eeffd7b809e82ea13a1fba1fb85c4e18365af3813722faa5c0fe4f",
        sizeBytes: 5413698958,
        url: "https://huggingface.co/Comfy-Org/MOSS-Image/resolve/530a4c94f92c35ef6818b1b035a983fe9dcf5f54/diffusion_models/moss_image_sft_int8_convrot.safetensors",
      },
      {
        folder: "text_encoders",
        filename: "qwen3.5_9b_int8_convrot.safetensors",
        sha256:
          "32e3787472f708fa5f83624acbf5ef23f7fc89c439e05065ea57cfe5a97f025a",
        sizeBytes: 9748121532,
        url: "https://huggingface.co/Comfy-Org/MOSS-Image/resolve/530a4c94f92c35ef6818b1b035a983fe9dcf5f54/text_encoders/qwen3.5_9b_int8_convrot.safetensors",
      },
      {
        folder: "vae",
        filename: "flux2-vae_small.safetensors",
        sha256:
          "d8d52ba036475f5fb07c8b435e176d3d97ebfa82f0d1a1c317f9cc1e25bd013b",
        sizeBytes: 249521340,
        url: "https://huggingface.co/Comfy-Org/MOSS-Image/resolve/530a4c94f92c35ef6818b1b035a983fe9dcf5f54/vae/flux2-vae_small.safetensors",
      },
    ],
  },
];
export const localModelPresetIdSchema = z.enum(
  localModelPresets.map(({ id }) => id),
);
export function localModelPreset(id) {
  return localModelPresets.find(
    (entry) => entry.id === localModelPresetIdSchema.parse(id),
  );
}
export function createPresetProfile(id) {
  const preset = localModelPreset(id);
  const [diffusion, encoder, vae] = preset.weights;
  return comfyProfileSchema.parse({
    id: preset.id,
    name: preset.name,
    kind: "image",
    graph: {
      1: {
        class_type: "UNETLoader",
        inputs: { unet_name: diffusion.filename, weight_dtype: "default" },
      },
      2: {
        class_type: "CLIPLoader",
        inputs: {
          clip_name: encoder.filename,
          type: "moss_image",
          device: "default",
        },
      },
      3: { class_type: "VAELoader", inputs: { vae_name: vae.filename } },
      4: {
        class_type: "CLIPTextEncode",
        inputs: { text: "A scene", clip: ["2", 0] },
      },
      5: {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "nsfw, worst quality, bad anatomy, watermark, jpeg artifact",
          clip: ["2", 0],
        },
      },
      6: {
        class_type: "EmptyFlux2LatentImage",
        inputs: { width: 1024, height: 1024, batch_size: 1 },
      },
      7: {
        class_type: "KSampler",
        inputs: {
          model: ["1", 0],
          positive: ["4", 0],
          negative: ["5", 0],
          latent_image: ["6", 0],
          seed: 0,
          steps: 25,
          cfg: 2.5,
          sampler_name: "er_sde",
          scheduler: "simple",
          denoise: 1,
        },
      },
      8: {
        class_type: "VAEDecode",
        inputs: { samples: ["7", 0], vae: ["3", 0] },
      },
      9: {
        class_type: "SaveImage",
        inputs: { filename_prefix: "flow-moss", images: ["8", 0] },
      },
    },
    bindings: {
      prompt: { nodeId: "4", input: "text" },
      seed: { nodeId: "7", input: "seed" },
      width: { nodeId: "6", input: "width" },
      height: { nodeId: "6", input: "height" },
    },
    resolution: { longEdge: 1024, multiple: 16 },
    output: { nodeId: "9", field: "images" },
    requiredModels: preset.weights.map(({ folder, filename, sha256 }) => ({
      folder,
      filename,
      sha256,
    })),
  });
}
export function presetHardwareNote(presetId, hardware = {}) {
  if (hardware.platform === "darwin")
    return presetId.endsWith("int8")
      ? "INT8 on Metal is unverified. BF16 avoids quantized kernels; both need an inference check on this Mac."
      : "Experimental on Apple Silicon. OpenMOSS validated its separate MPS pipeline on 32 GB; this ComfyUI route is unverified on your Mac.";
  return "Requires sufficient GPU and system memory. Download size is not peak inference memory; validate with one image first.";
}
