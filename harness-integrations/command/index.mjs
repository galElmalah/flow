import { spawn } from "node:child_process";
import { mkdir, writeFile, open, unlink } from "node:fs/promises";
import path from "node:path";
import { mediaArtifact } from "../../shared/media.mjs";

export async function runCommand(
  provider,
  { job, directory, imagePaths, signal, onProgress },
) {
  await mkdir(directory, { recursive: true });
  const output = path.join(
    directory,
    mediaArtifact(job.kind || "image").basename,
  );
  const input = path.join(directory, "request.json");
  await unlink(output).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const request = {
    version: 1,
    prompt: job.prompt,
    seed: job.seed,
    model: job.model || provider.models[0],
    ratio: job.ratio,
    quality: job.quality,
    kind: job.kind || "image",
    ...(job.video && { video: job.video }),
    images: imagePaths,
    ...(job.edit && { edit: job.edit }),
    output,
    directory,
  };
  await writeFile(input, JSON.stringify(request, null, 2));
  const substitute = (s) =>
    s
      .replaceAll("{input}", input)
      .replaceAll("{output}", output)
      .replaceAll("{directory}", directory);
  const [executable, ...args] = provider.command.map(substitute);
  const log = await open(path.join(directory, "command.log"), "w");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: directory,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: { ...process.env, FLOW_JOB_INPUT: input, FLOW_JOB_OUTPUT: output },
      });
      let stderr = "",
        killTimer,
        timedOut = false;
      const kill = (force) => {
        try {
          if (process.platform === "win32")
            child.kill(force ? "SIGKILL" : "SIGTERM");
          else process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
        } catch {}
      };
      const terminate = () => {
        kill(false);
        killTimer = setTimeout(() => kill(true), 3000);
        killTimer.unref();
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, provider.timeoutMs);
      const abort = () => terminate();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const clean = () => {
        clearTimeout(timeout);
        clearTimeout(killTimer);
        signal.removeEventListener("abort", abort);
      };
      child.stdout.on("data", (chunk) => {
        log.write(chunk).catch(() => {});
        onProgress?.(chunk.toString().trim().slice(-300));
      });
      child.stderr.on("data", (chunk) => {
        log.write(chunk).catch(() => {});
        stderr = (stderr + chunk.toString()).slice(-1500);
      });
      child.once("error", (error) => {
        clean();
        reject(new Error(`Cannot start ${provider.name}: ${error.message}`));
      });
      child.once("close", (code) => {
        clean();
        if (signal.aborted) reject(new Error("Cancelled"));
        else if (timedOut) reject(new Error(`${provider.name} timed out.`));
        else if (code !== 0)
          reject(
            new Error(`${provider.name} exited with code ${code}. ${stderr}`),
          );
        else resolve();
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(request) + "\n");
    });
    return output;
  } finally {
    await log.close();
  }
}
