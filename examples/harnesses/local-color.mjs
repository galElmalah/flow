#!/usr/bin/env node
// A command-provider example. It processes a reference image; it is not an AI model.
import sharp from "sharp";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (!request.images?.length)
  throw new Error("Local color lab requires a seed image.");
const [w, h] = request.ratio.split(":").map(Number);
const width = w >= h ? 1024 : Math.round((1024 * w) / h),
  height = h >= w ? 1024 : Math.round((1024 * h) / w);
const hue = Math.round((request.seed * 137.508) % 360) % 360;
let image = sharp(request.images[0]).resize(width, height, { fit: "cover" });
if (request.model === "monochrome")
  image = image
    .grayscale()
    .modulate({ brightness: 0.7 + (request.seed % 60) / 100 });
else if (request.model === "duotone") {
  const palette = [
    80 + ((request.seed * 37) % 176),
    70 + ((request.seed * 53) % 186),
    90 + ((request.seed * 71) % 166),
  ];
  image = image.recomb(
    palette.map((channel) =>
      [0.2126, 0.7152, 0.0722].map((weight) => (weight * channel) / 255),
    ),
  );
} else
  image = image.modulate({
    hue,
    saturation: 0.75 + (request.seed % 40) / 100,
    brightness: 0.88 + (request.seed % 22) / 100,
  });
await image.png().toFile(request.output);
console.log(
  JSON.stringify({
    status: "completed",
    output: request.output,
    seed: request.seed,
    model: request.model,
  }),
);
