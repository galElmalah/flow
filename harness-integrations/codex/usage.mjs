import { spawn } from "node:child_process";
import { codexBin } from "./status.mjs";

const source = "Codex app-server · account/rateLimits/read";
const unavailable = (message) => ({
  status: "unavailable",
  source,
  message,
  windows: [],
});

function durationLabel(minutes, fallback) {
  if (!Number.isFinite(minutes) || !(minutes > 0)) return fallback;
  if (minutes % 10080 === 0) return `${minutes / 10080} week`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day`;
  if (minutes % 60 === 0) return `${minutes / 60} hour`;
  return `${minutes} minute`;
}

// Keep only quota fields. Account IDs, credits and other protocol fields stay private.
export function normalizeCodexUsage(result) {
  const multi = result?.rateLimitsByLimitId;
  const entries =
    multi &&
    typeof multi === "object" &&
    !Array.isArray(multi) &&
    Object.keys(multi).length
      ? Object.entries(multi)
      : result?.rateLimits
        ? [[result.rateLimits.limitId || "codex", result.rateLimits]]
        : [];
  const windows = [];
  const plans = new Set();
  for (const [bucket, snapshot] of entries) {
    if (!snapshot || typeof snapshot !== "object") continue;
    if (typeof snapshot.planType === "string") plans.add(snapshot.planType);
    for (const key of ["primary", "secondary"]) {
      const window = snapshot[key];
      if (!Number.isFinite(window?.usedPercent) || window.usedPercent < 0)
        continue;
      const minutes = window.windowDurationMins;
      const label = durationLabel(
        minutes,
        key === "primary" ? "Primary" : "Secondary",
      );
      const reset = Number.isFinite(window.resetsAt)
        ? new Date(window.resetsAt * 1000)
        : null;
      windows.push({
        id: `${bucket}:${key}`,
        label: `${snapshot.limitName || bucket} · ${label}`,
        usedPercent: Math.min(100, window.usedPercent),
        ...(Number.isFinite(minutes) && minutes > 0
          ? { windowMinutes: minutes }
          : {}),
        ...(reset && Number.isFinite(reset.getTime())
          ? { resetAt: reset.toISOString() }
          : {}),
      });
    }
  }
  if (!windows.length)
    return unavailable("Codex did not return subscription quota windows.");
  return {
    status: "available",
    source,
    windows,
    ...(plans.size === 1 ? { plan: [...plans][0] } : {}),
  };
}

function protocolError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/auth|sign.?in|log.?in|api.?key/i.test(message)) {
    return unavailable(
      "Sign in to Codex with a ChatGPT account to read subscription usage.",
    );
  }
  if (
    error?.code === -32601 ||
    /unsupported|unknown method|not available/i.test(message)
  ) {
    return unavailable(
      "This Codex CLI does not expose subscription usage. Update Codex and retry.",
    );
  }
  return {
    status: "error",
    source,
    message: "Codex could not read subscription usage.",
    windows: [],
  };
}

export async function readCodexUsage({
  executable = codexBin,
  timeoutMs = 12000,
  spawnProcess = spawn,
  args = [],
  env = process.env,
} = {}) {
  return new Promise((resolve) => {
    let child;
    let timer;
    let killTimer;
    let settled = false;
    let pending = "";
    let received = 0;
    let initialized = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child) {
        child.stdin.end();
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
        killTimer.unref();
      }
      resolve(value);
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    try {
      child = spawnProcess(
        executable,
        [...args, "app-server", "--listen", "stdio://"],
        {
          stdio: ["pipe", "pipe", "ignore"],
          env: { ...env, NO_COLOR: "1" },
        },
      );
    } catch {
      finish(unavailable("Codex CLI is unavailable."));
      return;
    }
    timer = setTimeout(
      () =>
        finish({
          status: "error",
          source,
          message: "Codex usage request timed out.",
          windows: [],
        }),
      timeoutMs,
    );
    child.once("error", (error) =>
      finish(
        error.code === "ENOENT"
          ? unavailable("Codex CLI is not installed.")
          : {
              status: "error",
              source,
              message: "Codex usage process could not start.",
              windows: [],
            },
      ),
    );
    child.stdin.on("error", () =>
      finish({
        status: "error",
        source,
        message: "Codex usage connection closed unexpectedly.",
        windows: [],
      }),
    );
    child.once("close", () => {
      clearTimeout(killTimer);
      finish({
        status: "error",
        source,
        message: "Codex usage process closed without a reply.",
        windows: [],
      });
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      received += Buffer.byteLength(chunk);
      if (received > 1024 * 1024) {
        finish({
          status: "error",
          source,
          message: "Codex usage reply exceeded the size limit.",
          windows: [],
        });
        return;
      }
      pending += chunk;
      let newline;
      while (!settled && (newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message?.id === 1 && !initialized) {
          if (message.error) {
            finish(protocolError(message.error));
            return;
          }
          if (!("result" in message)) continue;
          initialized = true;
          send({ method: "initialized" });
          send({ id: 2, method: "account/rateLimits/read" });
        } else if (message?.id === 2 && initialized) {
          finish(
            message.error
              ? protocolError(message.error)
              : normalizeCodexUsage(message.result),
          );
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "flow_usage",
          title: "Flow usage reader",
          version: "0.1.0",
        },
      },
    });
  });
}
