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
import {
  GEMINI_INTERACTIONS_URL,
  GeminiVideoConnection,
  GeminiVideoConnectionError,
} from "./connection.mjs";

class VideoError extends Error {}

const MODEL = "gemini-omni-1.1-flash";
const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 1024 * 1024;
const PENDING = new Set(["queued", "in_progress", "requires_continuation"]);
const FAILED = new Set([
  "budget_exceeded",
  "cancelled",
  "failed",
  "incomplete",
]);
const opaqueId = (value) =>
  typeof value === "string" &&
  value !== "." &&
  value !== ".." &&
  /^[a-zA-Z0-9._~-]{1,1024}$/.test(value);

async function responseBytes(response, maximum, signal) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum)
    throw new VideoError("Gemini video response exceeds the local size limit.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    signal?.throwIfAborted();
    size += chunk.byteLength;
    if (size > maximum)
      throw new VideoError(
        "Gemini video response exceeds the local size limit.",
      );
    chunks.push(Buffer.from(chunk));
  }
  if (
    response.headers.has("content-length") &&
    !response.headers.has("content-encoding") &&
    Number.isFinite(declared) &&
    size !== declared
  )
    throw new VideoError(
      "Gemini video response was truncated. Resume the saved operation to retry.",
    );
  return Buffer.concat(chunks);
}

function boxes(buffer, start, end) {
  const found = [];
  for (let offset = start; offset < end;) {
    if (end - offset < 8)
      throw new VideoError("Gemini returned an invalid MP4 container.");
    let size = buffer.readUInt32BE(offset),
      header = 8;
    if (size === 1) {
      if (end - offset < 16)
        throw new VideoError("Gemini returned an invalid MP4 container.");
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER))
        throw new VideoError("Gemini returned an invalid MP4 container.");
      size = Number(large);
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end)
      throw new VideoError("Gemini returned an invalid MP4 container.");
    found.push({
      type: buffer.toString("ascii", offset + 4, offset + 8),
      start: offset + header,
      end: offset + size,
    });
    offset += size;
  }
  return found;
}

export function inspectVideo(buffer) {
  const top = boxes(buffer, 0, buffer.length);
  if (
    !top.some((box) => box.type === "ftyp" && box.end - box.start >= 8) ||
    !top.some((box) => box.type === "mdat" && box.end > box.start)
  )
    throw new VideoError("Gemini returned an invalid MP4 container.");
  for (const movie of top.filter((box) => box.type === "moov")) {
    for (const track of boxes(buffer, movie.start, movie.end).filter(
      (box) => box.type === "trak",
    )) {
      const children = boxes(buffer, track.start, track.end);
      const media = children.find((box) => box.type === "mdia");
      const header = children.find((box) => box.type === "tkhd");
      if (!media || !header) continue;
      const handler = boxes(buffer, media.start, media.end).find(
        (box) => box.type === "hdlr",
      );
      if (
        !handler ||
        handler.end - handler.start < 12 ||
        buffer.toString("ascii", handler.start + 8, handler.start + 12) !==
          "vide"
      )
        continue;
      if (header.end - header.start < 84) continue;
      const width = buffer.readUInt32BE(header.end - 8) / 65536;
      const height = buffer.readUInt32BE(header.end - 4) / 65536;
      if (width > 0 && height > 0 && width <= 32768 && height <= 32768)
        return { width, height };
    }
  }
  throw new VideoError("Gemini returned an MP4 without a valid video track.");
}

function artifactUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new VideoError(
      "Gemini returned an unsupported video download address.",
    );
  }
  const googleApi =
    url.hostname === "generativelanguage.googleapis.com" &&
    /^\/(?:download\/)?v1(?:beta)?\/files\//.test(url.pathname);
  const storage =
    url.hostname === "storage.googleapis.com" && url.pathname.length > 1;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    (!googleApi && !storage)
  )
    throw new VideoError(
      "Gemini returned an unsupported video download address.",
    );
  return { url, googleApi };
}

export class GeminiVideo {
  constructor({
    dataRoot,
    fetch: fetcher = globalThis.fetch,
    baseUrl = GEMINI_INTERACTIONS_URL,
    pollIntervalMs = 5000,
    timeoutMs = 15 * 60 * 1000,
    env,
    googleAuth,
  } = {}) {
    this.connection = new GeminiVideoConnection({ dataRoot, env, googleAuth });
    this.fetch = fetcher;
    this.baseUrl = baseUrl;
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
  }

  status() {
    return this.connection.status();
  }
  configure(patch) {
    return this.connection.configure(patch);
  }

  async request(url, { method = "GET", body, signal } = {}) {
    const headers = await this.connection.headers();
    let response;
    try {
      response = await this.fetch(url, {
        method,
        body,
        signal,
        redirect: "error",
        headers: { ...headers, "Content-Type": "application/json" },
      });
    } catch {
      if (signal?.aborted)
        throw new VideoError(
          "Gemini video was cancelled or timed out. Its saved operation can be resumed.",
        );
      throw new VideoError(
        "Gemini video could not reach Google. Its saved operation can be resumed without submitting again.",
      );
    }
    return response;
  }

  async json(response, signal) {
    const bytes = await responseBytes(response, MAX_JSON_BYTES, signal);
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new VideoError(
        "Google returned an invalid video response. Keep the saved operation instead of submitting again.",
      );
    }
  }

  async payload(job, imagePaths) {
    const model = job.model || MODEL;
    if (model !== MODEL)
      throw new VideoError(
        "Choose Gemini Omni 1.1 Flash for this video connection.",
      );
    if (!["16:9", "9:16"].includes(job.ratio))
      throw new VideoError("Gemini video supports 16:9 or 9:16 framing.");
    if (
      job.video?.durationSeconds !== undefined ||
      job.video?.mode !== undefined
    )
      throw new VideoError(
        "Gemini video does not expose duration or reference mode controls. Remove those settings or choose a compatible provider.",
      );
    const resolution = job.video?.resolution || "720p";
    if (!["360p", "720p", "1080p", "4k"].includes(resolution))
      throw new VideoError("Choose a supported Gemini video resolution.");
    const content = [{ type: "text", text: job.prompt }];
    let total = 0;
    for (const filename of imagePaths) {
      const details = await stat(filename);
      total += details.size;
      if (!details.isFile() || total > MAX_IMAGE_BYTES)
        throw new VideoError(
          "Gemini video seed images exceed the 14 MB inline limit.",
        );
      const data = await readFile(filename);
      if (data.length !== details.size)
        throw new VideoError(
          "A Gemini video seed image changed while it was being read. Try again with the saved image.",
        );
      let format;
      try {
        format = (
          await sharp(data, { limitInputPixels: 64_000_000 }).metadata()
        ).format;
      } catch {
        throw new VideoError(
          "Gemini video needs a valid PNG, JPEG, or WebP seed image.",
        );
      }
      const mime = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[
        format
      ];
      if (!mime)
        throw new VideoError(
          "Gemini video needs a valid PNG, JPEG, or WebP seed image.",
        );
      content.push({
        type: "image",
        mime_type: mime,
        data: data.toString("base64"),
      });
    }
    return {
      background: true,
      model,
      response_format: { type: "video", aspect_ratio: job.ratio, resolution },
      stream: false,
      input: content,
    };
  }

  async download(uri, signal) {
    let target = artifactUrl(uri);
    for (let count = 0; count < 4; count++) {
      const headers = target.googleApi ? await this.connection.headers() : {};
      let response;
      try {
        response = await this.fetch(target.url.href, {
          headers,
          signal,
          redirect: "manual",
        });
      } catch {
        throw new VideoError(
          "Gemini video download failed. Resume the saved operation to retry.",
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location)
          throw new VideoError("Gemini video download redirect is invalid.");
        target = artifactUrl(new URL(location, target.url).href);
        continue;
      }
      if (!response.ok)
        throw new VideoError(
          `Gemini video download failed (HTTP ${response.status}).`,
        );
      return responseBytes(response, MAX_VIDEO_BYTES, signal);
    }
    throw new VideoError("Gemini video download redirected too many times.");
  }

  async run(context) {
    try {
      return await this.execute(context);
    } catch (error) {
      if (
        error instanceof VideoError ||
        error instanceof GeminiVideoConnectionError
      )
        throw error;
      if (
        context.signal?.aborted ||
        error.name === "AbortError" ||
        error.name === "TimeoutError"
      )
        throw new VideoError(
          "Gemini video was cancelled or timed out. Any saved operation can be resumed.",
        );
      throw new VideoError(
        "Gemini video failed locally. Check the connection and seed files; any saved operation has been retained.",
      );
    }
  }

  async execute({
    job,
    directory,
    imagePaths = [],
    signal,
    onProgress,
    checkpoint,
  }) {
    if (typeof checkpoint !== "function")
      throw new VideoError(
        "Gemini video requires durable operation checkpoints.",
      );
    const abort = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);
    const body = await this.payload(job, imagePaths);
    const requestHash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    await this.connection.headers();
    let receipt = job.providerOperation,
      result;
    if (receipt?.id && this.connection.containsSecret(receipt.id))
      throw new VideoError("The saved video operation is invalid.");
    if (
      receipt &&
      (receipt.providerId !== "gemini-video" ||
        receipt.requestHash !== requestHash ||
        !opaqueId(receipt.id))
    )
      throw new VideoError(
        "This video submission has an uncertain outcome or changed inputs. Check Google before explicitly creating another run.",
      );
    if (!receipt) {
      await this.connection.headers();
      abort.throwIfAborted();
      onProgress?.("Submitting video to Google…");
      await checkpoint({
        providerOperation: {
          providerId: "gemini-video",
          state: "submitting",
          requestHash,
        },
        message: "Submitting video to Google…",
      });
      const response = await this.request(this.baseUrl, {
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
            message: "Google rejected the video request before acceptance.",
          });
        throw new VideoError(
          [401, 403].includes(response.status)
            ? "Google rejected video access. Check public Gemini API credentials, quota project, and API billing; Flow subscription credits are separate."
            : `Google rejected the video request (HTTP ${response.status}).`,
        );
      }
      result = await this.json(response, abort);
      if (!opaqueId(result.id) || this.connection.containsSecret(result.id))
        throw new VideoError(
          "Google did not return a valid video operation ID. Check Google before submitting another run.",
        );
      receipt = {
        providerId: "gemini-video",
        state: "accepted",
        requestHash,
        id: result.id,
      };
      await checkpoint({
        providerOperation: receipt,
        message: "Google accepted the video. Waiting for generation…",
      });
    }
    let phase;
    const reportPhase = async (status) => {
      if (status === phase) return;
      phase = status;
      const message =
        status === "queued"
          ? "Video queued at Google…"
          : status === "download"
            ? "Saving generated video…"
            : "Google is generating the video…";
      await checkpoint({ providerOperation: receipt, message });
      onProgress?.(message);
    };
    if (PENDING.has(result?.status)) await reportPhase(result.status);
    while (!result || result.status !== "completed") {
      abort.throwIfAborted();
      if (result && FAILED.has(result.status))
        throw new VideoError(
          `Google video generation ended with status ${result.status}.`,
        );
      if (result?.status === "requires_action")
        throw new VideoError(
          "Google video generation needs additional action. Review the saved operation before retrying.",
        );
      if (result && !PENDING.has(result.status))
        throw new VideoError(
          "Google returned an unsupported video operation status. The saved operation has been retained.",
        );
      if (result)
        await delay(this.pollIntervalMs, undefined, { signal: abort });
      const response = await this.request(
        `${this.baseUrl}/${encodeURIComponent(receipt.id)}?stream=false`,
        { signal: abort },
      );
      if (!response.ok)
        throw new VideoError(
          `Google video status could not be read (HTTP ${response.status}). Resume the saved operation to retry.`,
        );
      result = await this.json(response, abort);
      if (result.id && result.id !== receipt.id)
        throw new VideoError(
          "Google returned a different video operation. The saved operation has been retained.",
        );
      if (PENDING.has(result.status)) await reportPhase(result.status);
    }
    const video = result.steps
      ?.filter((step) => step.type === "model_output")
      .flatMap((step) => step.content || [])
      .find((part) => part.type === "video");
    if (!video || video.mime_type !== "video/mp4")
      throw new VideoError(
        "Google completed the operation without an MP4 video.",
      );
    await reportPhase("download");
    let bytes;
    if (typeof video.data === "string" && video.data) {
      if (
        video.data.length > MAX_JSON_BYTES ||
        !/^[a-zA-Z0-9+/]*={0,2}$/.test(video.data)
      )
        throw new VideoError("Google returned invalid video data.");
      bytes = Buffer.from(video.data, "base64");
      if (bytes.length > MAX_VIDEO_BYTES)
        throw new VideoError("Gemini video exceeds the local size limit.");
    } else if (video.uri) bytes = await this.download(video.uri, abort);
    else
      throw new VideoError(
        "Google completed the operation without video data.",
      );
    const dimensions = inspectVideo(bytes);
    abort.throwIfAborted();
    await mkdir(directory, { recursive: true });
    const output = path.join(directory, "output.mp4"),
      temporary = `${output}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      abort.throwIfAborted();
      await rename(temporary, output);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return {
      kind: "video",
      path: output,
      metadata: {
        provider: "gemini-video",
        model: body.model,
        interactionId: receipt.id,
        resolution: body.response_format.resolution,
        aspectRatio: body.response_format.aspect_ratio,
        sizeBytes: bytes.length,
        ...dimensions,
      },
    };
  }
}
