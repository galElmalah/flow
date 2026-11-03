import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { grokModel } from "../../shared/grok.mjs";
import { inspectVideo } from "../gemini-video/index.mjs";
import { GrokConnection, GrokError } from "./connection.mjs";

const MAX_INPUT = 14 * 1024 * 1024;
const LIMITS = { image: 64 * 1024 * 1024, video: 256 * 1024 * 1024 };
const opaqueId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(id);
const safeLabel = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9._:/ -]{1,160}$/.test(value);
const pendingMessage = (kind, progress) =>
  `Grok is generating the ${kind}${progress === undefined ? "…" : ` · ${progress}%`}`;

async function bytes(response, max, signal) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max)
    throw new GrokError("Grok response exceeds the local size limit.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    signal?.throwIfAborted();
    size += chunk.byteLength;
    if (size > max)
      throw new GrokError("Grok response exceeds the local size limit.");
    chunks.push(Buffer.from(chunk));
  }
  if (
    response.headers.has("content-length") &&
    !response.headers.has("content-encoding") &&
    Number.isFinite(declared) &&
    declared !== size
  )
    throw new GrokError(
      "Grok response was truncated. Resume the saved operation to retry.",
    );
  return Buffer.concat(chunks);
}

function mediaAddress(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GrokError("Grok returned an unsupported media download address.");
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !["imgen.x.ai", "vidgen.x.ai", "files-cdn.x.ai"].includes(url.hostname) ||
    url.pathname === "/"
  )
    throw new GrokError("Grok returned an unsupported media download address.");
  return url;
}

function usageSummary(value) {
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  for (const key of [
    "cost_in_usd_ticks",
    "input_tokens",
    "output_tokens",
    "total_tokens",
  ])
    if (Number.isSafeInteger(value[key]) && value[key] >= 0)
      result[key] = value[key];
  for (const key of ["input_tokens_details", "output_tokens_details"]) {
    if (!value[key] || typeof value[key] !== "object") continue;
    const details = {};
    for (const field of [
      "cached_tokens",
      "image_tokens",
      "text_tokens",
      "reasoning_tokens",
    ])
      if (Number.isSafeInteger(value[key][field]) && value[key][field] >= 0)
        details[field] = value[key][field];
    if (Object.keys(details).length) result[key] = details;
  }
  return Object.keys(result).length ? result : undefined;
}

export class GrokMedia {
  constructor({
    dataRoot,
    env,
    fetch: fetcher = globalThis.fetch,
    baseUrl = "https://api.x.ai/v1",
    pollIntervalMs = 5000,
    timeoutMs = 20 * 60 * 1000,
  } = {}) {
    this.connection = new GrokConnection({ dataRoot, env });
    this.fetch = fetcher;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
  }
  status() {
    return this.connection.status();
  }
  configure(patch) {
    return this.connection.configure(patch);
  }

  preflight(job, inputCount = job.images?.length || 0) {
    const kind = job.kind || "image";
    const modelId =
      job.model ||
      (kind === "image" ? "grok-imagine-image-2.0" : "grok-imagine-video-1.5");
    const model = grokModel(modelId);
    if (!model?.capabilities.includes(kind))
      throw new GrokError(
        "Choose a supported Grok model for this output type.",
      );
    if (!model.ratios.includes(job.ratio))
      throw new GrokError("Choose a supported Grok aspect ratio.");
    if (inputCount > model.maxImages)
      throw new GrokError(
        `${model.label} accepts at most ${model.maxImages} source images.`,
      );
    if (kind === "image") {
      const quality = job.quality ?? "medium",
        resolution = job.image?.resolution || "1k";
      if (!model.qualities.includes(quality))
        throw new GrokError(
          "Grok Image 2.0 supports low, medium, or auto quality. High is not supported.",
        );
      if (!model.imageResolutions.includes(resolution))
        throw new GrokError("Choose a supported Grok image resolution.");
      return {
        model,
        settings: {
          quality,
          resolution,
          aspectRatio: job.ratio,
          mode: inputCount ? "edit" : "text",
        },
      };
    }
    const mode =
      job.video?.mode ||
      (inputCount === 0 ? "text" : inputCount === 1 ? "image" : "reference");
    if (!model.videoModes.includes(mode))
      throw new GrokError(
        "This Grok model does not support the selected video mode.",
      );
    if (
      (mode === "text" && inputCount !== 0) ||
      (mode === "image" && inputCount !== 1) ||
      (mode === "reference" && inputCount < 1)
    )
      throw new GrokError(
        "Grok video mode must match its inputs: text uses none, image uses one, and reference uses one or more images.",
      );
    const resolution = job.video?.resolution || "720p",
      durationSeconds = job.video?.durationSeconds ?? 8;
    if (!model.videoResolutions.includes(resolution))
      throw new GrokError("Choose a supported Grok video resolution.");
    if (mode === "reference" && resolution === "1080p")
      throw new GrokError(
        "Grok reference-to-video supports up to 720p. Choose 480p or 720p.",
      );
    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < 1 ||
      durationSeconds > 15
    )
      throw new GrokError("Grok video duration must be from 1 to 15 seconds.");
    return {
      model,
      settings: {
        mode,
        resolution,
        durationSeconds,
        ...(mode === "image"
          ? { aspectRatioMode: "from-input", requestedAspectRatio: job.ratio }
          : { aspectRatio: job.ratio }),
        audio: "generated-by-provider",
        ...(model.resolutionNote && resolution === "1080p"
          ? { resolutionNote: model.resolutionNote }
          : {}),
      },
    };
  }

  async payload(job, imagePaths) {
    const { model, settings } = this.preflight(job, imagePaths.length);
    const inputs = [];
    let total = 0;
    for (const filename of imagePaths) {
      const details = await stat(filename);
      total += details.size;
      if (!details.isFile() || total > MAX_INPUT)
        throw new GrokError(
          "Grok seed images exceed the 14 MB local inline limit.",
        );
      const data = await readFile(filename);
      if (data.length !== details.size)
        throw new GrokError(
          "A Grok source image changed while being read. Retry with the saved image.",
        );
      let format;
      try {
        format = (
          await sharp(data, { limitInputPixels: 64_000_000 }).metadata()
        ).format;
      } catch {
        throw new GrokError(
          "Grok needs valid PNG, JPEG, or WebP source images.",
        );
      }
      const mime = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[
        format
      ];
      if (!mime)
        throw new GrokError(
          "Grok needs valid PNG, JPEG, or WebP source images.",
        );
      inputs.push({ url: `data:${mime};base64,${data.toString("base64")}` });
    }
    const kind = job.kind || "image";
    const body = { model: model.id, prompt: job.prompt };
    let endpoint;
    if (kind === "image") {
      endpoint = `images/${inputs.length ? "edits" : "generations"}`;
      Object.assign(body, {
        n: 1,
        aspect_ratio: settings.aspectRatio,
        quality: settings.quality,
        resolution: settings.resolution,
        response_format: "url",
        deferred: true,
      });
      if (inputs.length === 1) body.image = inputs[0];
      else if (inputs.length) body.images = inputs;
    } else {
      endpoint = "videos/generations";
      Object.assign(body, {
        duration: settings.durationSeconds,
        resolution: settings.resolution,
      });
      if (settings.mode === "image") body.image = inputs[0];
      else {
        body.aspect_ratio = settings.aspectRatio;
        if (settings.mode === "reference") body.reference_images = inputs;
      }
    }
    return { body, endpoint, settings, kind };
  }

  async request(url, { method = "GET", body, signal } = {}) {
    const headers = await this.connection.headers();
    let response;
    try {
      response = await this.fetch(url, {
        method,
        body,
        headers,
        signal,
        redirect: "error",
      });
    } catch {
      throw new GrokError(
        "Grok could not be reached. Keep the saved operation; resume without submitting again.",
      );
    }
    return response;
  }
  async json(response, signal) {
    const data = await bytes(response, 2 * 1024 * 1024, signal);
    try {
      return JSON.parse(data.toString("utf8"));
    } catch {
      throw new GrokError(
        "Grok returned an invalid operation response. Keep its saved receipt before retrying.",
      );
    }
  }
  async download(value, kind, signal) {
    let url = mediaAddress(value);
    for (let redirects = 0; redirects < 4; redirects++) {
      if (this.connection.containsSecret(url.href))
        throw new GrokError("Grok returned an invalid media address.");
      let response;
      try {
        response = await this.fetch(url.href, {
          signal,
          redirect: "manual",
          headers: {},
        });
      } catch {
        throw new GrokError(
          "Grok media download failed. Resume the saved operation to retry.",
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = response.headers.get("location");
        if (!target)
          throw new GrokError("Grok media download redirect is invalid.");
        url = mediaAddress(new URL(target, url).href);
        continue;
      }
      if (!response.ok)
        throw new GrokError(
          `Grok media download failed (HTTP ${response.status}). Resume the saved operation to retry.`,
        );
      return bytes(response, LIMITS[kind], signal);
    }
    throw new GrokError("Grok media download redirected too many times.");
  }
  async run(context) {
    try {
      return await this.execute(context);
    } catch (error) {
      if (error instanceof GrokError) throw error;
      if (
        context.signal?.aborted ||
        ["AbortError", "TimeoutError"].includes(error.name)
      )
        throw new GrokError(
          "Grok generation stopped locally. Any remote operation is retained for resume.",
        );
      throw new GrokError(
        "Grok generation failed locally. Check the connection and source files; its saved operation is retained.",
      );
    }
  }

  async execute({ job, directory, imagePaths = [], signal, checkpoint }) {
    if (typeof checkpoint !== "function")
      throw new GrokError("Grok requires durable operation checkpoints.");
    const abort = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);
    const { body, endpoint, settings, kind } = await this.payload(
      job,
      imagePaths,
    );
    const providerId = kind === "image" ? "grok-image" : "grok-video";
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ endpoint, body }))
      .digest("hex");
    await this.connection.headers();
    let receipt = job.providerOperation;
    if (
      receipt &&
      (receipt.providerId !== providerId ||
        receipt.state !== "accepted" ||
        receipt.requestHash !== requestHash ||
        !opaqueId(receipt.id) ||
        this.connection.containsSecret(receipt.id))
    )
      throw new GrokError(
        "This Grok submission has an uncertain outcome or changed inputs. Review it before explicitly creating another run.",
      );
    if (!receipt) {
      abort.throwIfAborted();
      await checkpoint({
        providerOperation: { providerId, state: "submitting", requestHash },
        message: `Submitting ${kind} to Grok…`,
      });
      const response = await this.request(`${this.baseUrl}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(body),
        signal: abort,
      });
      if (!response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408
        )
          await checkpoint({
            providerOperation: null,
            message: "Grok rejected the request before acceptance.",
          });
        throw new GrokError(
          [401, 403].includes(response.status)
            ? "Grok rejected API access. Check your xAI API key and API billing; subscription login alone does not configure API access."
            : `Grok rejected the request (HTTP ${response.status}).`,
        );
      }
      const accepted = await this.json(response, abort);
      if (
        !opaqueId(accepted.request_id) ||
        this.connection.containsSecret(accepted.request_id)
      )
        throw new GrokError(
          "Grok did not return a valid operation ID. Review the uncertain submission before another run.",
        );
      receipt = {
        providerId,
        state: "accepted",
        requestHash,
        id: accepted.request_id,
      };
      await checkpoint({
        providerOperation: receipt,
        message: `Grok accepted the ${kind}. Waiting for generation…`,
      });
    }
    let result, lastMessage;
    for (;;) {
      abort.throwIfAborted();
      const response = await this.request(
        `${this.baseUrl}/${kind === "image" ? "images" : "videos"}/${encodeURIComponent(receipt.id)}`,
        { signal: abort },
      );
      if (!response.ok)
        throw new GrokError(
          `Grok status could not be read (HTTP ${response.status}). Resume its saved operation to retry.`,
        );
      result = await this.json(response, abort);
      if (result.request_id && result.request_id !== receipt.id)
        throw new GrokError(
          "Grok returned a different operation. Its saved receipt is retained.",
        );
      if (result.status === "failed")
        throw new GrokError(
          "Grok generation failed. Review the saved operation and inputs before creating another run.",
        );
      if (!["pending", "done"].includes(result.status))
        throw new GrokError(
          "Grok returned an unsupported operation status. Its saved receipt is retained.",
        );
      const progress =
        kind === "video" &&
        Number.isInteger(result.progress) &&
        result.progress >= 0 &&
        result.progress <= 100
          ? result.progress
          : undefined;
      const message =
        result.status === "done"
          ? `Saving generated ${kind}…`
          : pendingMessage(kind, progress);
      if (lastMessage !== message) {
        receipt = {
          ...receipt,
          ...(progress === undefined ? {} : { progress }),
        };
        await checkpoint({ providerOperation: receipt, message });
        lastMessage = message;
      }
      if (result.status === "done") break;
      await delay(this.pollIntervalMs, undefined, { signal: abort });
    }
    const item = kind === "image" ? result.data?.[0] : result.video;
    if (
      item?.respect_moderation === false ||
      result.respect_moderation === false
    )
      throw new GrokError(
        "Grok filtered the generated media. No usable artifact was returned.",
      );
    if (!item?.url || (kind === "image" && result.data.length !== 1))
      throw new GrokError(
        "Grok completed without the expected single media artifact.",
      );
    const data = await this.download(item.url, kind, abort);
    let dimensions;
    if (kind === "video") dimensions = inspectVideo(data);
    else {
      try {
        const image = await sharp(data, {
          limitInputPixels: 64_000_000,
        }).metadata();
        if (!["png", "jpeg", "webp"].includes(image.format))
          throw new Error("format");
        dimensions = { width: image.width, height: image.height };
      } catch {
        throw new GrokError("Grok returned an invalid image artifact.");
      }
    }
    abort.throwIfAborted();
    await mkdir(directory, { recursive: true });
    const output = path.join(
        directory,
        kind === "image" ? "grok-original" : "output.mp4",
      ),
      temporary = `${output}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { flag: "wx" });
      abort.throwIfAborted();
      await rename(temporary, output);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    const actualModel =
      safeLabel(result.model) && !this.connection.containsSecret(result.model)
        ? result.model
        : undefined;
    const usage = usageSummary(result.usage);
    const revisedPrompt =
      typeof item.revised_prompt === "string" &&
      item.revised_prompt.length <= 32000 &&
      !this.connection.containsSecret(item.revised_prompt)
        ? item.revised_prompt
        : undefined;
    return {
      kind,
      path: output,
      metadata: {
        requestedModel: body.model,
        ...(actualModel && { actualModel }),
        providerRequestId: receipt.id,
        effectiveSettings: settings,
        seedMode: "unsupported",
        sizeBytes: data.length,
        ...dimensions,
        ...(Number.isFinite(item.duration) && item.duration > 0
          ? { durationSeconds: item.duration }
          : {}),
        ...(usage && { usage }),
        ...(revisedPrompt && { revisedPrompt }),
        ...(["low", "medium"].includes(result.quality)
          ? { actualQuality: result.quality }
          : {}),
      },
    };
  }
}
