import path from "node:path";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { stat, statfs } from "node:fs/promises";

export function executeCommand(
  command,
  args,
  { directory, signal, env, onProgress, timeoutMs = 1800000 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: directory,
      env: { ...process.env, ...env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "",
      stderr = "",
      failure,
      escalation;
    const kill = (force = false) => {
      try {
        if (process.platform === "win32")
          child.kill(force ? "SIGKILL" : "SIGTERM");
        else process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
      } catch {}
    };
    const abort = () => {
      failure ||= new Error("Cancelled");
      kill();
      escalation ||= setTimeout(() => kill(true), 2000);
      escalation.unref();
    };
    const timer = setTimeout(() => {
      failure = new Error(
        "Local runtime setup command timed out. Retry setup.",
      );
      abort();
    }, timeoutMs);
    const collect = (chunk, isError) => {
      const text = chunk.toString("utf8");
      if (isError) stderr = (stderr + text).slice(-8000);
      else stdout = (stdout + text).slice(-256000);
      onProgress?.(
        text
          .replace(/\u001b\[[0-9;]*m/g, "")
          .trim()
          .slice(-500),
      );
    };
    child.stdout.on("data", (chunk) => collect(chunk, false));
    child.stderr.on("data", (chunk) => collect(chunk, true));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (!failure) clearTimeout(escalation);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code) => {
      cleanup();
      if (failure || code !== 0)
        reject(
          failure ||
            new Error(`${command} exited ${code}: ${stderr.slice(-2000)}`),
        );
      else resolve({ stdout, stderr });
    });
  });
}

export async function downloadFile(
  url,
  file,
  onProgress,
  { signal, fetchFile = fetch, sha256, maxBytes = 80 * 1024 ** 3 } = {},
) {
  let downloadedBytes = 0,
    totalBytes = null,
    created = false,
    last = 0,
    attempt = 0;
  const report = (phase) =>
    onProgress?.({
      downloadedBytes,
      totalBytes,
      percent: totalBytes
        ? Math.min(100, (downloadedBytes / totalBytes) * 100)
        : null,
      scope: "artifact",
      attempt,
      ...(phase && { phase }),
    });
  const request = async (offset) => {
    let response,
      current = new URL(url);
    for (let redirects = 0; redirects <= 6; redirects++) {
      if (current.protocol !== "https:" || current.username || current.password)
        throw new Error("Downloads require HTTPS without URL credentials.");
      response = await fetchFile(current.href, {
        signal,
        redirect: "manual",
        ...(offset && {
          headers: { Range: `bytes=${offset}-`, "Accept-Encoding": "identity" },
        }),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const target = response.headers.get("location");
      await response.body?.cancel();
      if (!target || redirects === 6)
        throw new Error("Model download redirected too many times.");
      current = new URL(target, current);
    }
  };
  for (attempt = 1; attempt <= 4; attempt++) {
    signal?.throwIfAborted();
    downloadedBytes = created ? (await stat(file)).size : 0;
    let response;
    try {
      response = await request(downloadedBytes);
    } catch (error) {
      if (signal?.aborted || attempt === 4 || !(error instanceof TypeError))
        throw error;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      if (
        [408, 429, 500, 502, 503, 504].includes(response.status) &&
        attempt < 4
      )
        continue;
      throw new Error(`Model download failed (${response.status}).`);
    }
    const length = Number(response.headers.get("content-length"));
    const responseLength =
      Number.isFinite(length) && length > 0 ? length : null;
    let append = false;
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
        response.headers.get("content-range") || "",
      );
      if (
        !range ||
        Number(range[1]) !== downloadedBytes ||
        Number(range[2]) < downloadedBytes ||
        Number(range[2]) >= Number(range[3]) ||
        (totalBytes && totalBytes !== Number(range[3])) ||
        (responseLength &&
          responseLength !== Number(range[2]) - Number(range[1]) + 1)
      ) {
        await response.body.cancel();
        throw new Error(
          "Model server returned an invalid resume range. Retry the download.",
        );
      }
      totalBytes = Number(range[3]);
      append = created;
    } else {
      // A server may ignore Range. Restart this owned temporary file, never append a full response.
      downloadedBytes = 0;
      totalBytes = responseLength;
    }
    if (totalBytes && totalBytes > maxBytes) {
      await response.body.cancel();
      throw new Error("Model download exceeds the supported size.");
    }
    const disk = await statfs(path.dirname(file)).catch(() => null);
    if (
      totalBytes &&
      disk &&
      disk.bavail * disk.bsize < totalBytes - downloadedBytes + 512 * 1024 ** 2
    ) {
      await response.body.cancel();
      throw new Error("Not enough disk space for this download.");
    }
    report();
    const flags = created ? (append ? "a" : "w") : "wx";
    const output = createWriteStream(file, { flags, mode: 0o600 });
    created = true;
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        new Transform({
          transform(chunk, _, callback) {
            downloadedBytes += chunk.length;
            if (downloadedBytes > maxBytes)
              return callback(
                new Error("Model download exceeds the supported size."),
              );
            if (Date.now() - last > 150) {
              report();
              last = Date.now();
            }
            callback(null, chunk);
          },
        }),
        output,
        { signal },
      );
    } catch (error) {
      const code = error.cause?.code || error.code;
      const transient =
        error instanceof TypeError ||
        [
          "ECONNRESET",
          "ETIMEDOUT",
          "UND_ERR_SOCKET",
          "UND_ERR_BODY_TIMEOUT",
        ].includes(code);
      if (signal?.aborted || !transient || attempt === 4)
        throw new Error(
          signal?.aborted
            ? "Cancelled"
            : `Model download interrupted. Retry setup to continue: ${error.message}`,
          { cause: error },
        );
      continue;
    }
    downloadedBytes = (await stat(file)).size;
    if (!downloadedBytes) throw new Error("The model download was empty.");
    if (totalBytes && totalBytes !== downloadedBytes) {
      if (attempt < 4 && downloadedBytes < totalBytes) continue;
      throw new Error("Model download was incomplete. Retry setup.");
    }
    report("verification");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) {
      signal?.throwIfAborted();
      hash.update(chunk);
    }
    const digest = hash.digest("hex");
    if (sha256 && digest !== sha256.toLowerCase())
      throw new Error(
        "Model SHA-256 does not match. The file was not installed.",
      );
    report();
    return { sha256: digest, sizeBytes: downloadedBytes };
  }
  throw new Error(
    "Model download remained interrupted after four attempts. Retry setup.",
  );
}

export async function readJson(response, { limit = 4 * 1024 * 1024 } = {}) {
  if (!response.body)
    throw new Error("Local runtime returned an empty response.");
  let size = 0,
    raw = "";
  const decoder = new TextDecoder();
  for await (const bytes of response.body) {
    size += bytes.byteLength;
    if (size > limit)
      throw new Error("Local runtime response exceeded its size limit.");
    raw += decoder.decode(bytes, { stream: true });
  }
  raw += decoder.decode();
  return JSON.parse(raw);
}

export async function* ndjson(response, { signal, limit = 1024 * 1024 } = {}) {
  if (!response.ok || !response.body)
    throw new Error(`Local runtime request failed (${response.status}).`);
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const bytes of response.body) {
    signal?.throwIfAborted();
    buffer += decoder.decode(bytes, { stream: true });
    if (Buffer.byteLength(buffer) > limit)
      throw new Error("Local runtime stream line exceeded its size limit.");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield JSON.parse(buffer);
}
