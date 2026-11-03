#!/usr/bin/env node
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { claudeUsageFile, claudeUsageWindows } from "./usage.mjs";

export async function saveClaudeUsage(
  snapshot,
  { file = claudeUsageFile(), now = Date.now() } = {},
) {
  const windows = claudeUsageWindows(snapshot, { now });
  const value = {
    fetchedAt: new Date(now).toISOString(),
    rate_limits: Object.fromEntries(
      windows.map((window) => [
        window.id,
        {
          used_percentage: window.usedPercent,
          resets_at: Date.parse(window.resetAt) / 1000,
        },
      ]),
    ),
  };
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return windows;
}

export async function runClaudeUsageStatusline({
  input = process.stdin,
  output = process.stdout,
  file = claudeUsageFile(),
  usageOnly = false,
  now = Date.now(),
} = {}) {
  let text = "";
  for await (const chunk of input) {
    text += chunk;
    if (Buffer.byteLength(text) > 512 * 1024)
      throw new Error("Status-line input is too large.");
  }
  const snapshot = JSON.parse(text);
  const windows = await saveClaudeUsage(snapshot, { file, now });
  if (!usageOnly) {
    const model = String(snapshot.model?.display_name || "Claude")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
      .slice(0, 80);
    output.write(
      [
        model,
        ...windows.map(
          (window) =>
            `${window.id === "five_hour" ? "5h" : "7d"} ${Math.round(window.usedPercent)}%`,
        ),
      ].join(" · ") + "\n",
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--usage-only")) {
    process.stderr.write("Usage: node usage-statusline.mjs [--usage-only]\n");
    process.exitCode = 1;
  } else {
    await runClaudeUsageStatusline({
      usageOnly: args.includes("--usage-only"),
    }).catch(() => {
      process.stderr.write("Could not update Flow's Claude usage snapshot.\n");
      process.exitCode = 1;
    });
  }
}
