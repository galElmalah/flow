import { open } from "node:fs/promises";
import { requestClaudeControl } from "./control.mjs";
import os from "node:os";
import path from "node:path";

const source = "Claude Code status line";
export const CLAUDE_USAGE_MAX_AGE_MS = 10 * 60 * 1000;

export function claudeUsageFile() {
  return (
    process.env.FLOW_CLAUDE_USAGE_FILE ||
    path.join(
      process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
      "flow",
      "claude-usage.json",
    )
  );
}

export function claudeUsageWindows(snapshot, { now = Date.now() } = {}) {
  return [
    ["five_hour", "5 hours", 300],
    ["seven_day", "7 days", 10080],
  ].flatMap(([id, label, windowMinutes]) => {
    const value = snapshot?.rate_limits?.[id];
    if (
      typeof value?.used_percentage !== "number" ||
      !Number.isFinite(value.used_percentage) ||
      value.used_percentage < 0 ||
      value.used_percentage > 100
    )
      return [];
    const resetsAt = value.resets_at;
    if (
      typeof resetsAt !== "number" ||
      !Number.isFinite(resetsAt) ||
      resetsAt <= now / 1000 ||
      resetsAt > 8.64e12
    )
      return [];
    return [
      {
        id,
        label,
        usedPercent: value.used_percentage,
        windowMinutes,
        resetAt: new Date(resetsAt * 1000).toISOString(),
      },
    ];
  });
}

export function claudeControlUsage(report, { now = Date.now() } = {}) {
  if (!report?.rate_limits_available || !report.rate_limits)
    return {
      status: "unavailable",
      source: "Claude Code usage control",
      windows: [],
      message: "Claude did not expose subscription limits for this account.",
    };
  const candidates = [
    ["five_hour", "5 hours", 300, report.rate_limits.five_hour],
    ["seven_day", "7 days", 10080, report.rate_limits.seven_day],
    [
      "seven_day_oauth_apps",
      "7 days · OAuth apps",
      10080,
      report.rate_limits.seven_day_oauth_apps,
    ],
    [
      "seven_day_opus",
      "7 days · Opus",
      10080,
      report.rate_limits.seven_day_opus,
    ],
    [
      "seven_day_sonnet",
      "7 days · Sonnet",
      10080,
      report.rate_limits.seven_day_sonnet,
    ],
    ...(Array.isArray(report.rate_limits.model_scoped)
      ? report.rate_limits.model_scoped.slice(0, 20)
      : []
    )
      .filter((value) => typeof value?.display_name === "string")
      .map((value, index) => [
        `model_weekly_${index}`,
        `7 days · ${value.display_name.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 80)}`,
        10080,
        value,
      ]),
  ];
  const windows = candidates.flatMap(([id, label, windowMinutes, value]) => {
    if (
      typeof value?.utilization !== "number" ||
      !Number.isFinite(value.utilization) ||
      value.utilization < 0 ||
      value.utilization > 100
    )
      return [];
    const resetsAt =
      value.resets_at == null ? null : Date.parse(value.resets_at);
    if (
      value.resets_at != null &&
      (!Number.isFinite(resetsAt) || resetsAt <= now)
    )
      return [];
    return [
      {
        id,
        label,
        windowMinutes,
        usedPercent: value.utilization,
        ...(resetsAt == null
          ? {}
          : { resetAt: new Date(resetsAt).toISOString() }),
      },
    ];
  });
  return {
    status: windows.length ? "available" : "unavailable",
    source: "Claude Code usage control",
    windows,
    fetchedAt: new Date(now).toISOString(),
    ...(["pro", "max", "team", "enterprise"].includes(report.subscription_type)
      ? { plan: report.subscription_type }
      : {}),
    ...(!windows.length
      ? { message: "Claude did not report current subscription percentages." }
      : {}),
  };
}

export async function readClaudeUsage({
  executable = process.env.FLOW_CLAUDE_BIN || "claude",
  timeoutMs = 10000,
  live = true,
  ...options
} = {}) {
  if (live) {
    try {
      return claudeControlUsage(
        await requestClaudeControl({
          executable,
          timeoutMs,
          prefix: "flow-usage",
          request: { subtype: "get_usage", skip_behaviors: true },
        }),
        options,
      );
    } catch {
      /* Older CLIs may not implement the experimental read-only control. */
    }
  }
  return readClaudeUsageSnapshot(options);
}

export async function readClaudeUsageSnapshot({
  file = claudeUsageFile(),
  now = Date.now(),
  maxAgeMs = CLAUDE_USAGE_MAX_AGE_MS,
} = {}) {
  let handle;
  try {
    handle = await open(file, "r");
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024) throw new Error();
    const snapshot = JSON.parse(await handle.readFile("utf8"));
    const fetchedAt = Date.parse(snapshot.fetchedAt);
    if (
      !Number.isFinite(fetchedAt) ||
      fetchedAt > now + 5000 ||
      now - fetchedAt > maxAgeMs
    ) {
      return {
        status: "unavailable",
        source,
        windows: [],
        message:
          "Claude usage snapshot is stale. Use Claude Code to refresh its status line.",
      };
    }
    const windows = claudeUsageWindows(snapshot, { now });
    if (!windows.length)
      return {
        status: "unavailable",
        source,
        windows: [],
        message:
          "Claude has not reported current subscription limits. Check /usage in Claude Code.",
      };
    return {
      status: "available",
      source,
      windows,
      fetchedAt: new Date(fetchedAt).toISOString(),
      message:
        "Last reported by Claude Code's status line; refreshes when Claude receives a response.",
    };
  } catch (error) {
    if (error.code === "ENOENT")
      return {
        status: "unavailable",
        source,
        windows: [],
        message:
          "Live Claude usage is unavailable with this CLI. Connect its status line for quota reporting on supported subscription accounts.",
      };
    return {
      status: "error",
      source,
      windows: [],
      message: "Could not read Claude's usage snapshot.",
    };
  } finally {
    await handle?.close();
  }
}
