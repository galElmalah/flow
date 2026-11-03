import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export async function executableExists(command) {
  const candidates = command.includes(path.sep)
    ? [command]
    : (process.env.PATH || "")
        .split(path.delimiter)
        .map((dir) => path.join(dir, command));
  for (const file of candidates)
    try {
      await access(file, constants.X_OK);
      return true;
    } catch {}
  return false;
}

export function capture(
  executable,
  args,
  {
    directory,
    input = "",
    signal,
    timeoutMs = 600000,
    maxBytes = 2 * 1024 * 1024,
    onStdout,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: directory,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "",
      stderr = "",
      bytes = 0,
      failure,
      killTimer;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const kill = (force) => {
      try {
        if (process.platform === "win32")
          child.kill(force ? "SIGKILL" : "SIGTERM");
        else process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
      } catch {}
    };
    const terminate = (message) => {
      failure ||= message;
      kill(false);
      killTimer ||= setTimeout(() => kill(true), 2000);
      killTimer.unref();
    };
    const timeout = setTimeout(
      () => terminate("Harness timed out."),
      timeoutMs,
    );
    const abort = () => terminate("Cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (chunk, err) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        terminate("Harness output exceeded 2 MB.");
        return;
      }
      if (err) stderr = (stderr + stderrDecoder.write(chunk)).slice(-4000);
      else {
        const text = stdoutDecoder.write(chunk);
        stdout += text;
        try {
          if (text) onStdout?.(text);
        } catch (error) {
          terminate(error.message || "Invalid harness stream.");
        }
      }
    };
    child.stdout.on("data", (c) => collect(c, false));
    child.stderr.on("data", (c) => collect(c, true));
    const clean = () => {
      clearTimeout(timeout);
      // A terminated leader can exit while a descendant ignores SIGTERM.
      // Keep the unref'd process-group escalation until its deadline.
      if (!failure) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
    };
    child.once("error", (e) => {
      clean();
      reject(new Error(`Cannot start ${executable}: ${e.message}`));
    });
    child.once("close", (code) => {
      const tail = stdoutDecoder.end();
      stdout += tail;
      stderr = (stderr + stderrDecoder.end()).slice(-4000);
      if (tail && !failure && code === 0)
        try {
          onStdout?.(tail);
        } catch (error) {
          failure = error.message || "Invalid harness stream.";
        }
      clean();
      if (failure || code !== 0)
        reject(
          new Error(
            failure || `Harness exited ${code}: ${stderr.slice(-1500)}`,
          ),
        );
      else resolve({ stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
