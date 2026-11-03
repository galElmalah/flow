import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

const weights = [0.2126, 0.7152, 0.0722];
const luma = (rgb) =>
  rgb.reduce((sum, value, i) => sum + value * weights[i], 0);

export function recolorPixels(source, mask, color, strength = 1) {
  if (
    !/^#[0-9a-f]{6}$/i.test(color || "") ||
    !Number.isFinite(strength) ||
    strength < 0 ||
    strength > 1
  )
    throw new Error(
      "Recolor requires a #RRGGBB color and strength between 0 and 1.",
    );
  const target = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const targetLuma = luma(target);
  const chroma = target.map((value) => value - targetLuma);
  const output = Buffer.from(source.data);
  if (
    mask.length !== source.width * source.height ||
    output.length !== mask.length * 4
  )
    throw new Error("Region mask does not match the source dimensions.");
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) continue;
    const offset = pixel * 4;
    const lightness =
      source.data[offset] * weights[0] +
      source.data[offset + 1] * weights[1] +
      source.data[offset + 2] * weights[2];
    let gamut = 1;
    for (const delta of chroma) {
      if (delta > 0) gamut = Math.min(gamut, (255 - lightness) / delta);
      if (delta < 0) gamut = Math.min(gamut, -lightness / delta);
    }
    for (let channel = 0; channel < 3; channel++) {
      const colored = lightness + chroma[channel] * gamut;
      output[offset + channel] = Math.round(
        source.data[offset + channel] * (1 - strength) + colored * strength,
      );
    }
  }
  return { data: output, width: source.width, height: source.height };
}

export function compositePixels(source, candidate, mask) {
  if (
    source.width !== candidate.width ||
    source.height !== candidate.height ||
    source.data.length !== candidate.data.length ||
    mask.length * 4 !== source.data.length
  )
    throw new Error(
      "Image and region mask dimensions must match before compositing.",
    );
  const data = Buffer.from(source.data);
  for (let pixel = 0; pixel < mask.length; pixel++)
    if (mask[pixel])
      candidate.data.copy(data, pixel * 4, pixel * 4, pixel * 4 + 4);
  return { data, width: source.width, height: source.height };
}

export async function decodeRegionSource(input) {
  const { data, info } = await sharp(input, { limitInputPixels: 16_000_000 })
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function decodeRegionMask(input, source) {
  const { data, info } = await sharp(input, { limitInputPixels: 16_000_000 })
    .greyscale()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== source.width || info.height !== source.height)
    throw new Error(
      "The saved region mask dimensions no longer match the original image. Reopen and refine the selection.",
    );
  return data;
}

export async function prepareRegionInputs(job, imagePaths) {
  const edit = job.edit;
  if (!["region", "recolor"].includes(edit?.mode)) return null;
  if (
    job.images?.length !== 3 ||
    imagePaths.length !== 3 ||
    !edit.source ||
    !edit.mask ||
    job.images[0]?.asset !== edit.source ||
    job.images[2]?.asset !== edit.mask ||
    (edit.overlay && job.images[1]?.asset !== edit.overlay)
  )
    throw new Error(
      "Region edits require the original, annotation overlay and mask in that order.",
    );
  const bytes = await readFile(imagePaths[0]);
  if (
    edit.sourceHash &&
    createHash("sha256").update(bytes).digest("hex") !== edit.sourceHash
  )
    throw new Error(
      "The original image changed after this edit was prepared. Reopen it before editing.",
    );
  const source = await decodeRegionSource(bytes);
  const mask = await decodeRegionMask(imagePaths[2], source);
  return { source, mask };
}

export async function writeRegionImage(image, output) {
  await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toFile(output);
}

export async function compositeRegionFile(prepared, candidateFile, output) {
  const candidate = await sharp(candidateFile, { limitInputPixels: 64_000_000 })
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = prepared.source;
  const aspectDrift = Math.abs(
    candidate.info.width / candidate.info.height / (width / height) - 1,
  );
  if (aspectDrift > 0.05)
    throw new Error(
      "The generated image changed the framing too much to align this region edit. Regenerate the whole image or try again with the original framing.",
    );
  const data =
    candidate.info.width === width && candidate.info.height === height
      ? candidate.data
      : await sharp(candidate.data, { raw: candidate.info })
          .resize(width, height, { fit: "fill" })
          .raw()
          .toBuffer();
  await writeRegionImage(
    compositePixels(prepared.source, { data, width, height }, prepared.mask),
    output,
  );
  return { width, height };
}
