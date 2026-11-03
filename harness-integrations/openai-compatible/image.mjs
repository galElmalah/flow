import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
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
    for (const [i, file] of imagePaths.entries()) {
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
  const output = path.join(directory, "output.png");
  await writeFile(output, bytes);
  return output;
}
