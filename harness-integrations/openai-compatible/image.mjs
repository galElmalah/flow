import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { verifyImage } from "../shared/image.mjs";

async function boundedBody(response, max = 96 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > max) {
      await response.body.cancel?.().catch(() => {});
      throw new Error("Image provider response exceeded the size limit.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function runImageApi(
  provider,
  { job, directory, imagePaths, signal, onProgress },
) {
  await mkdir(directory, { recursive: true });
  const timeout = AbortSignal.timeout(provider.timeoutMs);
  const requestSignal = AbortSignal.any([signal, timeout]);
  const token =
    provider.apiKey ||
    (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : null);
  if (provider.apiKeyEnv && !token)
    throw new Error(
      `Set ${provider.apiKeyEnv} in the server environment for ${provider.name}.`,
    );
  const size = provider.sizes[job.ratio];
  if (!size)
    throw new Error(
      `${provider.name} does not support the ${job.ratio} ratio.`,
    );
  const fields = {
    ...provider.parameters,
    model: job.model || provider.models[0],
    prompt: job.prompt,
    size,
    quality: job.quality,
    n: 1,
  };
  const settings = job.image || {};
  const references = settings.markup ? imagePaths.slice(0, -1) : imagePaths;
  const markup = settings.markup ? imagePaths.at(-1) : null;
  if (markup) {
    if ((await stat(markup)).size > 50 * 1024 * 1024)
      throw new Error("The markup PNG exceeds the 50 MB API limit.");
    if ((await verifyImage(markup)) !== "png")
      throw new Error("The markup layer must be a transparent PNG.");
    const [sourceMeta, layerMeta] = await Promise.all([
      sharp(references[0], { limitInputPixels: 16_777_216 }).metadata(),
      sharp(markup, { limitInputPixels: 16_777_216 }).metadata(),
    ]);
    const swapped = sourceMeta.orientation >= 5 && sourceMeta.orientation <= 8;
    if (
      layerMeta.width !== (swapped ? sourceMeta.height : sourceMeta.width) ||
      layerMeta.height !== (swapped ? sourceMeta.width : sourceMeta.height) ||
      !layerMeta.hasAlpha
    )
      throw new Error(
        "Markup must be transparent and match the oriented source image dimensions.",
      );
    const stats = await sharp(markup).stats();
    if (stats.channels.at(-1).min === 255)
      throw new Error(
        "The markup PNG must contain transparent pixels; do not flatten it onto the source.",
      );
  }
  if (settings.outputFormat) fields.output_format = settings.outputFormat;
  if (settings.complexity) fields.complexity = settings.complexity;
  if (settings.background) fields.background = settings.background;
  if (settings.outputFormat === "gif") {
    fields.frame_count = settings.frameCount || 9;
    fields.frame_duration_ms = settings.frameDurationMs || 200;
    // Auto respects the animation's total pixel budget; still-image sizes can exceed it.
    fields.size = "auto";
  }
  if (["gif", "svg"].includes(settings.outputFormat))
    for (const key of [
      "stream",
      "partial_images",
      "output_compression",
      "prompt_rewriter",
      "mask",
    ])
      delete fields[key];
  if (provider.seedParameter) fields[provider.seedParameter] = job.seed;
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let body;
  if (imagePaths.length) {
    body = new FormData();
    for (const [key, value] of Object.entries(fields))
      body.append(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    for (const [i, file] of references.entries()) {
      const format = await verifyImage(file);
      body.append(
        "image[]",
        new Blob([await readFile(file)], {
          type: { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[
            format
          ],
        }),
        `reference-${i}${path.extname(file) || ".png"}`,
      );
    }
    if (markup) {
      body.delete("mask");
      body.delete("prompt_rewriter");
      body.append(
        "markup",
        new Blob([await readFile(markup)], { type: "image/png" }),
        "markup.png",
      );
    }
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(fields);
  }
  const url =
    provider.baseUrl.replace(/\/$/, "") +
    `/images/${imagePaths.length ? "edits" : "generations"}`;
  onProgress?.(
    `Sending ${imagePaths.length ? "image edit" : "generation"} to ${provider.name}…`,
  );
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: requestSignal,
    redirect: "error",
  });
  const raw = await boundedBody(response);
  let result;
  try {
    result = JSON.parse(raw.toString());
  } catch {
    throw new Error(
      `${provider.name} returned a non-JSON response (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    let message =
      result.error?.message || result.error || `HTTP ${response.status}`;
    message = String(message).slice(0, 800);
    if (token) message = message.replaceAll(token, "[redacted]");
    throw new Error(`${provider.name} HTTP ${response.status}: ${message}`);
  }
  const item = result.data?.[0];
  let bytes;
  if (item?.b64_json) {
    bytes = Buffer.from(item.b64_json, "base64");
  } else if (item?.url) {
    const imageUrl = new URL(item.url);
    if (!["http:", "https:"].includes(imageUrl.protocol))
      throw new Error("The provider returned an unsupported image URL.");
    const image = await fetch(imageUrl, { signal: requestSignal });
    if (!image.ok)
      throw new Error(
        `Could not download provider image: HTTP ${image.status}`,
      );
    bytes = await boundedBody(image, 64 * 1024 * 1024);
  } else throw new Error(`${provider.name} returned no image data.`);
  if (bytes.length > 64 * 1024 * 1024)
    throw new Error("The generated image exceeds 64 MB.");
  const requestId = response.headers.get("x-request-id");
  const safeRequestId =
    requestId &&
    /^[a-zA-Z0-9_.:-]{1,200}$/.test(requestId) &&
    !(token && requestId.includes(token))
      ? requestId
      : undefined;
  const output = path.join(directory, "output.png");
  await writeFile(output, bytes);
  return {
    path: output,
    metadata: {
      effectiveSettings: Object.fromEntries(
        [
          "model",
          "size",
          "quality",
          "n",
          "output_format",
          "complexity",
          "background",
          "frame_count",
          "frame_duration_ms",
        ]
          .filter((key) => fields[key] !== undefined)
          .map((key) => [key, fields[key]]),
      ),
      ...(safeRequestId && { providerRequestId: safeRequestId }),
    },
  };
}
