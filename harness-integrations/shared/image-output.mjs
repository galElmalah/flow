import { readFile, copyFile, rename } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SaxesParser } from "saxes";
import { verifyImage } from "./image.mjs";
import { imageMimeType } from "../../shared/media.mjs";

const vectorElements = new Set(
  "svg g defs path rect circle ellipse line polyline polygon text tspan textPath title desc metadata clipPath mask linearGradient radialGradient stop pattern use symbol marker filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feMerge feMergeNode feFlood feDropShadow".split(
    " ",
  ),
);
export function verifyStaticSvg(bytes) {
  const parser = new SaxesParser({ xmlns: true });
  let root = false;
  parser.on("error", (error) => {
    throw error;
  });
  parser.on("doctype", () => {
    throw new Error("SVG document types are not allowed.");
  });
  parser.on("processinginstruction", () => {
    throw new Error("SVG processing instructions are not allowed.");
  });
  parser.on("opentag", (tag) => {
    if (!root && tag.local !== "svg")
      throw new Error("Expected an SVG document.");
    root = true;
    if (
      !vectorElements.has(tag.local) ||
      tag.uri !== "http://www.w3.org/2000/svg"
    )
      throw new Error("Only static SVG vector elements are allowed.");
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.prefix === "xmlns" || attribute.name === "xmlns") continue;
      if (
        /^on/i.test(attribute.local) ||
        attribute.local === "style" ||
        attribute.name === "xml:base" ||
        (attribute.local === "href" &&
          !/^#[a-zA-Z0-9_.:-]+$/.test(attribute.value)) ||
        (/url\s*\(/i.test(attribute.value) &&
          !/^url\(\s*#[a-zA-Z0-9_.:-]+\s*\)$/.test(attribute.value))
      )
        throw new Error(
          "SVG scripts, styles and external resources are not allowed.",
        );
    }
  });
  parser.write(bytes.toString("utf8")).close();
  if (!root) throw new Error("Expected an SVG document.");
}

export async function verifyGeneratedImage(file, requested) {
  const bytes = await readFile(file);
  if (bytes.length < 64 || bytes.length > 64 * 1024 * 1024)
    throw new Error(
      "The provider did not produce a valid image file under 64 MB.",
    );
  if (requested === "svg") {
    verifyStaticSvg(bytes);
    return "svg";
  }
  if (/^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) return "gif";
  return verifyImage(file);
}

export const spriteGrid = (count) => {
  const columns = Math.ceil(Math.sqrt(count));
  return { columns, rows: Math.ceil(count / columns) };
};
export async function assembleSpriteGif(file, output, settings) {
  const frameCount = settings.frameCount || 9;
  const { columns, rows } = spriteGrid(frameCount);
  const metadata = await sharp(file, {
    limitInputPixels: 64_000_000,
  }).metadata();
  if (metadata.width % columns || metadata.height % rows)
    throw new Error(
      `The sprite sheet must have ${columns} equal columns and ${rows} equal rows. Try again with clearer grid instructions.`,
    );
  const width = metadata.width / columns,
    height = metadata.height / rows;
  const frames = [];
  for (let index = 0; index < frameCount; index++)
    frames.push(
      await sharp(file)
        .extract({
          left: (index % columns) * width,
          top: Math.floor(index / columns) * height,
          width,
          height,
        })
        .ensureAlpha()
        .raw()
        .toBuffer(),
    );
  if (frames.every((frame) => frame.equals(frames[0])))
    throw new Error(
      "The sprite sheet contains identical frames, not an animation.",
    );
  await sharp(Buffer.concat(frames), {
    raw: {
      width,
      height: height * frameCount,
      channels: 4,
      pageHeight: height,
    },
    limitInputPixels: 64_000_000,
  })
    .gif({
      loop: 0,
      delay: Array(frameCount).fill(settings.frameDurationMs || 200),
    })
    .toFile(output);
  return { width: metadata.width, height: metadata.height, columns, rows };
}

export async function finalizeImage(
  file,
  directory,
  job,
  { spriteSheet = false } = {},
) {
  const format = job.image?.outputFormat || "png";
  const originalFormat = await verifyGeneratedImage(
    file,
    spriteSheet ? "png" : format,
  );
  const originalFile = `original-attempt-${job.attempts || 1}.${originalFormat}`;
  await copyFile(file, path.join(directory, originalFile));
  const output = path.join(directory, `output.${format}`);
  const temp = path.join(directory, `normalized.${format}`);
  let sheetMetadata;
  if (spriteSheet)
    sheetMetadata = await assembleSpriteGif(file, temp, job.image);
  else if (format === "gif" || format === "svg") {
    if (originalFormat !== format)
      throw new Error(
        `Provider returned ${originalFormat}, but ${format.toUpperCase()} was requested.`,
      );
    await copyFile(file, temp);
  } else
    await sharp(file, { limitInputPixels: 64_000_000 })
      .toFormat(format)
      .toFile(temp);
  const meta = await sharp(temp, {
    animated: format === "gif",
    limitInputPixels: 64_000_000,
  }).metadata();
  if (format === "gif" && (meta.pages || 1) < 2)
    throw new Error(
      "Provider returned a static GIF; an animated GIF needs multiple frames.",
    );
  await rename(temp, output);
  return {
    path: output,
    metadata: {
      originalFile,
      outputFormat: format,
      mimeType: imageMimeType(format),
      width: meta.width,
      height: meta.pageHeight || meta.height,
      ...(format === "gif" && {
        frameCount: meta.pages,
        frameDurationsMs: meta.delay,
        durationMs: meta.delay?.reduce((a, b) => a + b, 0),
        loop: meta.loop,
        animationMethod: spriteSheet ? "sprite-sheet" : "native",
        ...(spriteSheet && {
          spriteGrid: spriteGrid(job.image?.frameCount || 9),
          spriteSheet: sheetMetadata,
        }),
      }),
    },
  };
}
