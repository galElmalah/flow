import test from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  readClaudeUsageSnapshot as readClaudeUsage,
  readClaudeUsage as readLiveClaudeUsage,
  claudeControlUsage,
} from "../harness-integrations/claude-code/usage.mjs";
import {
  runClaudeUsageStatusline,
  saveClaudeUsage,
} from "../harness-integrations/claude-code/usage-statusline.mjs";
import { readPiUsage } from "../harness-integrations/pi/usage.mjs";

const now = Date.parse("2026-10-30T18:00:00Z");
const snapshot = () => ({
  model: { display_name: "Claude" },
  context_window: { used_percentage: 95 },
  auth: { token: "must-never-be-persisted" },
  transcript_path: "/private/transcript",
  rate_limits: {
    five_hour: { used_percentage: 0, resets_at: now / 1000 + 3600 },
    seven_day: { used_percentage: 42.75, resets_at: now / 1000 + 86400 },
    spend_limit: { used_percentage: 99, used_usd: 314 },
  },
});

async function usageFile(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "flow-claude-usage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return path.join(root, "private", "usage.json");
}

test("official Claude status-line data becomes private quota-only windows", async (t) => {
  const file = await usageFile(t);
  let displayed = "";
  await runClaudeUsageStatusline({
    input: Readable.from([JSON.stringify(snapshot())]),
    output: {
      write(value) {
        displayed += value;
      },
    },
    file,
    now,
  });
  const usage = await readClaudeUsage({ file, now });
  assert.equal(usage.status, "available");
  assert.deepEqual(
    usage.windows.map(({ id, usedPercent }) => [id, usedPercent]),
    [
      ["five_hour", 0],
      ["seven_day", 42.75],
    ],
  );
  assert.equal(usage.windows[0].resetAt, "2026-10-30T19:00:00.000Z");
  assert.match(displayed, /5h 0%.*7d 43%/);
  const stored = await readFile(file, "utf8");
  assert.doesNotMatch(stored, /auth|token|transcript|context|spend_limit|314/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
});

test("Claude quotas expire at reset time and stale snapshots never become zero usage", async (t) => {
  const file = await usageFile(t);
  await saveClaudeUsage(snapshot(), { file, now });
  assert.equal(
    (await readClaudeUsage({ file, now: now + 10 * 60 * 1000 + 1 })).status,
    "unavailable",
  );
  const value = snapshot();
  value.rate_limits.five_hour.resets_at = now / 1000;
  value.rate_limits.seven_day.used_percentage = "42";
  await saveClaudeUsage(value, { file, now });
  const unavailable = await readClaudeUsage({ file, now });
  assert.equal(unavailable.status, "unavailable");
  assert.deepEqual(unavailable.windows, []);
});

test("context/cost values are never mistaken for subscription usage and corrupt files stay private", async (t) => {
  const file = await usageFile(t);
  await saveClaudeUsage(
    { context_window: { used_percentage: 95 }, cost: { total_cost_usd: 5 } },
    { file, now },
  );
  assert.equal((await readClaudeUsage({ file, now })).status, "unavailable");
  await writeFile(file, "private malformed token", "utf8");
  const error = await readClaudeUsage({ file, now });
  assert.equal(error.status, "error");
  assert.doesNotMatch(JSON.stringify(error), /private malformed token/);
  assert.equal(
    (await readClaudeUsage({ file: file + "-missing", now })).status,
    "unavailable",
  );
  assert.equal((await readPiUsage()).status, "unavailable");
});

test("usage-only bridge does not alter an existing status line's stdout", async (t) => {
  const file = await usageFile(t);
  await runClaudeUsageStatusline({
    input: Readable.from([JSON.stringify(snapshot())]),
    output: {
      write() {
        assert.fail("Usage-only bridge must not print");
      },
    },
    file,
    now,
    usageOnly: true,
  });
  assert.equal((await readClaudeUsage({ file, now })).status, "available");
});

test("Claude usage control percentages keep their official 0–100 units and accept idle windows", () => {
  const usage = claudeControlUsage(
    {
      rate_limits_available: true,
      subscription_type: "max",
      rate_limits: {
        five_hour: { utilization: 0, resets_at: null },
        seven_day: { utilization: 47, resets_at: "2026-11-03T07:59:59Z" },
      },
    },
    { now },
  );
  assert.equal(usage.plan, "max");
  assert.deepEqual(
    usage.windows.map(({ usedPercent }) => usedPercent),
    [0, 47],
  );
  assert.equal(usage.windows[0].resetAt, undefined);
  assert.equal(
    claudeControlUsage({ rate_limits_available: false }, { now }).status,
    "unavailable",
  );
});

test("read-only Claude protocol sends control requests without user prompts and falls back on older CLIs", async (t) => {
  const file = await usageFile(t);
  const executable = path.join(path.dirname(file), "claude-fixture");
  await saveClaudeUsage(snapshot(), { file, now });
  await writeFile(
    executable,
    `#!${process.execPath}
import readline from 'node:readline';
const args = process.argv.slice(2);
if (!args.includes('--safe-mode') || !args.includes('--no-session-persistence')) process.exit(1);
for await (const line of readline.createInterface({ input: process.stdin })) {
  const event = JSON.parse(line);
  if (event.type !== 'control_request') process.exit(2);
  const type = event.request.subtype;
  if (type !== 'initialize' && type !== 'get_usage') process.exit(3);
  if (type === 'get_usage' && event.request.skip_behaviors !== true) process.exit(4);
  const response = type === 'get_usage' ? {rate_limits_available:true,subscription_type:'max',rate_limits:{seven_day:{utilization:47,resets_at:'2026-11-03T07:59:59Z'}},private:'secret'} : {};
  process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:event.request_id,response}})+'\\n');
}
`,
  );
  await chmod(executable, 0o755);
  const result = await readLiveClaudeUsage({
    executable,
    file,
    now,
    timeoutMs: 5000,
  });
  assert.equal(result.status, "available");
  assert.equal(result.source, "Claude Code usage control");
  assert.equal(result.windows[0].usedPercent, 47);
  assert.doesNotMatch(JSON.stringify(result), /secret|private/);
  const fallback = await readLiveClaudeUsage({
    executable: executable + "-missing",
    file,
    now,
    timeoutMs: 5000,
  });
  assert.equal(fallback.source, "Claude Code status line");
  assert.equal(fallback.status, "available");
  await writeFile(
    executable,
    `#!${process.execPath}
import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})) {
  const event=JSON.parse(line);
  process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'error',request_id:event.request_id,error:'private failure'}})+'\\n');
}
`,
  );
  const olderCli = await readLiveClaudeUsage({
    executable,
    file,
    now,
    timeoutMs: 5000,
  });
  assert.equal(olderCli.status, "available");
  assert.equal(olderCli.source, "Claude Code status line");
  assert.doesNotMatch(JSON.stringify(olderCli), /private failure/);
});
