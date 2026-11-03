#!/usr/bin/env node
import {
  decodeRegionSource,
  decodeRegionMask,
  recolorPixels,
  writeRegionImage,
} from "../../image-tools/region-edit.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (request.edit?.mode !== "recolor" || request.images?.length !== 3)
  throw new Error(
    "Local recolor requires a selected region and its saved mask.",
  );
const source = await decodeRegionSource(request.images[0]);
const mask = await decodeRegionMask(request.images[2], source);
await writeRegionImage(
  recolorPixels(source, mask, request.edit.color, request.edit.strength ?? 1),
  request.output,
);
console.log(
  "Recolored selected pixels locally; shading and texture preserved.",
);
