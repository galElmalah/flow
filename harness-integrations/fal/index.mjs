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
import { falModel } from "../../shared/fal.mjs";
import { inspectVideo } from "../gemini-video/index.mjs";
import { FalConnection, FalError } from "./connection.mjs";

const opaqueId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(id);
async function bytes(response, max, signal) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > max)
    throw new FalError("fal response exceeds the local size limit.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    signal?.throwIfAborted();
    size += chunk.byteLength;
    if (size > max)
      throw new FalError("fal response exceeds the local size limit.");
    chunks.push(Buffer.from(chunk));
  }
  if (
    response.headers.has("content-length") &&
    !response.headers.has("content-encoding") &&
    declared !== size
  )
    throw new FalError(
      "fal response was truncated. Resume its saved operation to retry.",
    );
  return Buffer.concat(chunks);
}
function mediaAddress(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new FalError("fal returned an invalid media address.");
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !(
      url.hostname === "fal.media" ||
      url.hostname.endsWith(".fal.media") ||
      (url.hostname === "storage.googleapis.com" &&
        url.pathname.startsWith("/falserverless/"))
    )
  )
    throw new FalError("fal returned an unsupported media download address.");
  return url;
}
export class FalMedia {
  constructor({
    dataRoot,
    env,
    fetch: fetcher = globalThis.fetch,
    baseUrl = "https://queue.fal.run",
    pollIntervalMs = 3000,
    timeoutMs = 30 * 60 * 1000,
  } = {}) {
    this.connection = new FalConnection({ dataRoot, env });
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
    const model = falModel(job.model),
      kind = job.kind || "image";
    if (!model?.capabilities.includes(kind))
      throw new FalError("Choose a supported fal model for this output type.");
    if (inputCount < model.minImages || inputCount > model.maxImages)
      throw new FalError(
        `${model.label} needs ${model.minImages === model.maxImages ? model.minImages : `${model.minImages}–${model.maxImages}`} reference images. Choose the matching text, first-frame, or reference endpoint.`,
      );
    if (!model.ratios.includes(job.ratio))
      throw new FalError(
        `Choose a supported aspect ratio for ${model.label}${model.videoModes?.[0] === "image" ? "; first-frame video uses auto (the source image ratio)" : ""}.`,
      );
    if (kind === "video") {
      const mode = model.videoModes[0],
        resolution = job.video?.resolution || "720p",
        durationSeconds = job.video?.durationSeconds ?? 8;
      if (job.video?.mode && job.video.mode !== mode)
        throw new FalError(
          "The video mode must match the selected fal endpoint.",
        );
      if (!model.videoResolutions.includes(resolution))
        throw new FalError("Choose a supported fal video resolution.");
      if (
        !Number.isInteger(durationSeconds) ||
        durationSeconds < model.durationSeconds.min ||
        durationSeconds > model.durationSeconds.max
      )
        throw new FalError(
          `${model.label} supports ${model.durationSeconds.min}–${model.durationSeconds.max} seconds.`,
        );
      return {
        model,
        kind,
        settings: {
          mode,
          resolution,
          durationSeconds,
          aspectRatio: job.ratio,
          generateAudio: true,
          codec: "H264",
          ...(mode === "image" && inputCount === 2
            ? { secondImageRole: "end-frame" }
            : {}),
        },
      };
    }
    const resolution = job.image?.resolution || "1k";
    if (!model.imageResolutions.includes(resolution))
      throw new FalError("Choose a supported fal image resolution.");
    if (job.quality && job.quality !== "auto")
      throw new FalError(
        "This fal image model uses automatic quality. Choose Auto.",
      );
    const [w, h] = job.ratio.split(":").map(Number),
      target = { "1k": 1_048_576, "1.5k": 2_359_296, "2k": 4_194_304 }[
        resolution
      ];
    const width = Math.round(Math.sqrt((target * w) / h) / 8) * 8,
      height = Math.round(Math.sqrt((target * h) / w) / 8) * 8;
    return {
      model,
      kind,
      settings: {
        resolution,
        imageSize: { width, height },
        aspectRatio: job.ratio,
        quality: "auto",
      },
    };
  }
  async payload(job, imagePaths) {
    const checked = this.preflight(job, imagePaths.length),
      urls = [];
    let total = 0;
    for (const filename of imagePaths) {
      const info = await stat(filename);
      total += info.size;
      if (!info.isFile() || total > 20 * 1024 * 1024)
        throw new FalError(
          "fal references exceed the 20 MB local inline limit.",
        );
      const data = await readFile(filename);
      if (data.length !== info.size)
        throw new FalError("A fal reference changed while being read.");
      let format;
      try {
        format = (
          await sharp(data, { limitInputPixels: 64_000_000 }).metadata()
        ).format;
      } catch {
        throw new FalError(
          "fal references must be valid PNG, JPEG, or WebP images.",
        );
      }
      const mime = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[
        format
      ];
      if (!mime)
        throw new FalError("fal references must be PNG, JPEG, or WebP images.");
      urls.push(`data:${mime};base64,${data.toString("base64")}`);
    }
    const { model, kind, settings } = checked,
      body = { prompt: job.prompt };
    if (kind === "video") {
      Object.assign(body, {
        resolution: settings.resolution,
        duration: String(settings.durationSeconds),
        aspect_ratio: settings.aspectRatio,
        generate_audio: true,
        codec: "H264",
      });
      if (settings.mode === "image") {
        body.image_url = urls[0];
        if (urls[1]) body.end_image_url = urls[1];
      }
      if (settings.mode === "reference") body.image_urls = urls;
    } else {
      Object.assign(body, {
        image_size: settings.imageSize,
        num_images: 1,
        output_format: "png",
        enable_safety_checker: true,
      });
      if (urls.length) body.image_urls = urls;
      if (model.seeded) body.seed = job.seed;
    }
    return { ...checked, body };
  }
  async request(url, { method = "GET", body, signal } = {}) {
    const headers = await this.connection.headers();
    try {
      return await this.fetch(url, {
        method,
        headers,
        body,
        signal,
        redirect: "error",
      });
    } catch {
      throw new FalError(
        "fal could not be reached. Keep the saved operation and resume; do not resubmit an uncertain request.",
      );
    }
  }
  async json(response, signal) {
    const data = await bytes(response, 2 * 1024 * 1024, signal);
    try {
      return JSON.parse(data.toString("utf8"));
    } catch {
      throw new FalError(
        "fal returned an invalid response. Its saved operation is retained.",
      );
    }
  }
  operationUrls(model, id, received) {
    const app = model.id.split("/").slice(0, 2).join("/"),
      base = `${this.baseUrl}/${app}/requests/${id}`;
    const expected = {
      responseUrl: base,
      statusUrl: `${base}/status`,
      cancelUrl: `${base}/cancel`,
    };
    const fields = {
      responseUrl: "response_url",
      statusUrl: "status_url",
      cancelUrl: "cancel_url",
    };
    for (const [field, wire] of Object.entries(fields)) {
      const supplied = received?.[field] ?? received?.[wire];
      if (
        supplied !== undefined &&
        supplied !== null &&
        supplied !== expected[field]
      )
        throw new FalError(
          "fal returned an invalid operation URL. Review the saved submission before another run.",
        );
    }
    return expected;
  }
  async download(value, kind, signal) {
    let url = mediaAddress(value);
    for (let i = 0; i < 4; i++) {
      if (this.connection.containsSecret(url.href))
        throw new FalError("fal returned an invalid media address.");
      let response;
      try {
        response = await this.fetch(url.href, {
          signal,
          redirect: "manual",
          headers: {},
        });
      } catch {
        throw new FalError(
          "fal media download failed. Resume the saved operation to retry.",
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const to = response.headers.get("location");
        if (!to) throw new FalError("fal media redirect is invalid.");
        url = mediaAddress(new URL(to, url).href);
        continue;
      }
      if (!response.ok)
        throw new FalError(
          `fal media download failed (HTTP ${response.status}). Resume to retry.`,
        );
      return bytes(
        response,
        kind === "video" ? 256 * 1024 * 1024 : 64 * 1024 * 1024,
        signal,
      );
    }
    throw new FalError("fal media redirected too many times.");
  }
  async run(context) {
    try {
      return await this.execute(context);
    } catch (error) {
      if (error instanceof FalError) throw error;
      if (
        context.signal?.aborted ||
        ["AbortError", "TimeoutError"].includes(error.name)
      )
        throw new FalError(
          "fal generation stopped locally. The remote request is retained for resume; it may still run and incur charges.",
        );
      throw new FalError(
        "fal generation failed locally. Its saved operation is retained.",
      );
    }
  }
  async execute({ job, directory, imagePaths = [], signal, checkpoint }) {
    if (typeof checkpoint !== "function")
      throw new FalError("fal requires durable operation checkpoints.");
    const abort = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);
    const { body, model, kind, settings } = await this.payload(job, imagePaths),
      providerId = `fal-${kind}`;
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ endpoint: model.id, body }))
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
      throw new FalError(
        "This fal submission has uncertain or changed inputs. Review it before explicitly creating another run.",
      );
    if (receipt) this.operationUrls(model, receipt.id, receipt);
    else {
      abort.throwIfAborted();
      await checkpoint({
        providerOperation: { providerId, state: "submitting", requestHash },
        message: `Submitting ${kind} to fal…`,
      });
      const response = await this.request(`${this.baseUrl}/${model.id}`, {
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
            message: "fal rejected the submission.",
          });
        throw new FalError(
          [401, 403].includes(response.status)
            ? "fal rejected API access. Check the fal API key, model access and billing."
            : `fal rejected the request (HTTP ${response.status}).`,
        );
      }
      const accepted = await this.json(response, abort);
      if (
        !opaqueId(accepted.request_id) ||
        this.connection.containsSecret(accepted.request_id)
      )
        throw new FalError(
          "fal did not return a valid request ID. Review the uncertain submission before another run.",
        );
      // Persist acceptance before validating provider URLs: even a malformed response must never cause a duplicate paid POST.
      receipt = {
        providerId,
        state: "accepted",
        requestHash,
        id: accepted.request_id,
      };
      await checkpoint({
        providerOperation: receipt,
        message: "fal accepted the request…",
      });
      receipt = {
        ...receipt,
        ...this.operationUrls(model, receipt.id, accepted),
      };
      await checkpoint({
        providerOperation: receipt,
        message: "Waiting in fal’s queue…",
      });
    }
    const urls = this.operationUrls(model, receipt.id, receipt);
    let lastMessage;
    for (;;) {
      abort.throwIfAborted();
      const response = await this.request(urls.statusUrl, { signal: abort });
      if (!response.ok)
        throw new FalError(
          `fal status could not be read (HTTP ${response.status}). Resume to retry.`,
        );
      const status = await this.json(response, abort);
      if (status.request_id && status.request_id !== receipt.id)
        throw new FalError("fal returned a different request ID.");
      if (!["IN_QUEUE", "IN_PROGRESS", "COMPLETED"].includes(status.status))
        throw new FalError("fal returned an unsupported queue status.");
      if (status.error)
        throw new FalError(
          "fal generation failed. Review the saved request before creating another run.",
        );
      const queuePosition =
        Number.isSafeInteger(status.queue_position) &&
        status.queue_position >= 0
          ? status.queue_position
          : undefined;
      const message =
        status.status === "COMPLETED"
          ? `Saving generated ${kind}…`
          : status.status === "IN_QUEUE"
            ? `fal queue${queuePosition === undefined ? "" : ` · ${queuePosition} ahead`}`
            : `fal is generating the ${kind}…`;
      if (message !== lastMessage) {
        receipt = {
          ...receipt,
          status: status.status,
          ...(queuePosition === undefined ? {} : { queuePosition }),
        };
        await checkpoint({ providerOperation: receipt, message });
        lastMessage = message;
      }
      if (status.status === "COMPLETED") break;
      await delay(this.pollIntervalMs, undefined, { signal: abort });
    }
    const response = await this.request(urls.responseUrl, { signal: abort });
    if (!response.ok)
      throw new FalError(
        `fal result could not be read (HTTP ${response.status}). The saved request is retained.`,
      );
    const result = await this.json(response, abort);
    if (result.error || result.has_nsfw_concepts?.some(Boolean))
      throw new FalError("fal returned a failed or filtered generation.");
    const item = kind === "video" ? result.video : result.images?.[0];
    if (!item?.url || (kind === "image" && result.images.length !== 1))
      throw new FalError(
        "fal completed without the expected single media artifact.",
      );
    const data = await this.download(item.url, kind, abort);
    let dimensions;
    if (kind === "video") dimensions = inspectVideo(data);
    else {
      try {
        const info = await sharp(data, {
          limitInputPixels: 64_000_000,
        }).metadata();
        if (!["png", "jpeg", "webp"].includes(info.format)) throw new Error();
        dimensions = { width: info.width, height: info.height };
      } catch {
        throw new FalError("fal returned an invalid image artifact.");
      }
    }
    abort.throwIfAborted();
    await mkdir(directory, { recursive: true });
    const output = path.join(
        directory,
        kind === "video" ? "output.mp4" : "fal-original",
      ),
      temporary = `${output}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { flag: "wx" });
      abort.throwIfAborted();
      await rename(temporary, output);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return {
      kind,
      path: output,
      metadata: {
        requestedModel: model.id,
        providerRequestId: receipt.id,
        effectiveSettings: settings,
        seedMode: model.seeded ? "parameter" : "unsupported",
        ...(Number.isSafeInteger(result.seed)
          ? { effectiveSeed: result.seed }
          : {}),
        sizeBytes: data.length,
        ...dimensions,
      },
    };
  }
}
