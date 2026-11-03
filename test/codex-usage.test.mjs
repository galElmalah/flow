import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  normalizeCodexUsage,
  readCodexUsage,
} from "../harness-integrations/codex/usage.mjs";

test("Codex usage preserves every metered quota window and never exposes account details", () => {
  const actual = normalizeCodexUsage({
    accountId: "private-account-id",
    rateLimits: { primary: { usedPercent: 99 } },
    rateLimitsByLimitId: {
      codex: {
        planType: "pro",
        accountId: "also-private",
        credits: { balance: "secret" },
        primary: {
          usedPercent: 12,
          windowDurationMins: 300,
          resetsAt: 1800000000,
        },
        secondary: {
          usedPercent: 42,
          windowDurationMins: 10080,
          resetsAt: null,
        },
      },
      review: {
        planType: "pro",
        limitName: "Code review",
        primary: { usedPercent: 7, windowDurationMins: 1440 },
      },
    },
  });
  assert.equal(actual.status, "available");
  assert.equal(actual.plan, "pro");
  assert.deepEqual(actual.windows, [
    {
      id: "codex:primary",
      label: "codex · 5 hour",
      usedPercent: 12,
      windowMinutes: 300,
      resetAt: "2027-01-15T08:00:00.000Z",
    },
    {
      id: "codex:secondary",
      label: "codex · 1 week",
      usedPercent: 42,
      windowMinutes: 10080,
    },
    {
      id: "review:primary",
      label: "Code review · 1 day",
      usedPercent: 7,
      windowMinutes: 1440,
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(actual),
    /private|secret|balance|accountId/,
  );
});

test("Codex legacy quotas retain zero and distinguish missing usage from zero", () => {
  assert.equal(
    normalizeCodexUsage({ rateLimits: { primary: { usedPercent: 0 } } })
      .windows[0].usedPercent,
    0,
  );
  for (const usedPercent of [null, undefined, NaN, "10", -1]) {
    assert.equal(
      normalizeCodexUsage({ rateLimits: { primary: { usedPercent } } }).status,
      "unavailable",
    );
  }
  assert.equal(
    normalizeCodexUsage({
      rateLimitsByLimitId: {},
      rateLimits: { primary: { usedPercent: 2 } },
    }).windows[0].usedPercent,
    2,
  );
  assert.equal(
    normalizeCodexUsage({ rateLimits: { primary: { usedPercent: 110 } } })
      .windows[0].usedPercent,
    100,
  );
});

async function fixture(t, reply, { wait = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "weft-codex-usage-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const script = path.join(root, "server.mjs");
  const log = path.join(root, "methods.json");
  await writeFile(
    script,
    `
    import { createInterface } from "node:readline";
    import { writeFileSync } from "node:fs";
    const methods = [];
    const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const message = JSON.parse(line);
      methods.push(message.method);
      writeFileSync(${JSON.stringify(log)}, JSON.stringify(methods));
      if (message.method === "initialize") {
        send({ method: "unrelated/updated", params: { private: "never expose" } });
        send({ id: message.id, result: { userAgent: "fixture" } });
      } else if (message.method === "account/rateLimits/read" && !${wait}) {
        send({ id: message.id, ...${JSON.stringify(reply)} });
      }
    });
  `,
  );
  return {
    log,
    spawnProcess: (executable, args, options) => {
      assert.deepEqual(args, ["app-server", "--listen", "stdio://"]);
      assert.equal(options.stdio[2], "ignore");
      return spawn(process.execPath, [script], options);
    },
  };
}

test("Codex usage performs only initialize and a read-only quota request", async (t) => {
  const fake = await fixture(t, {
    result: {
      rateLimits: { primary: { usedPercent: 23, windowDurationMins: 300 } },
    },
  });
  const actual = await readCodexUsage({ spawnProcess: fake.spawnProcess });
  assert.equal(actual.status, "available");
  assert.equal(actual.windows[0].usedPercent, 23);
  assert.deepEqual(JSON.parse(await readFile(fake.log, "utf8")), [
    "initialize",
    "initialized",
    "account/rateLimits/read",
  ]);
});

test("Codex usage reports authentication and protocol errors without reflecting raw server messages", async (t) => {
  for (const [error, status] of [
    [
      {
        code: -32000,
        message: "Authentication required; secret=private-token",
      },
      "unavailable",
    ],
    [{ code: -32601, message: "private-token" }, "unavailable"],
    [{ code: -32000, message: "private-token" }, "error"],
  ]) {
    const fake = await fixture(t, { error });
    const actual = await readCodexUsage({ spawnProcess: fake.spawnProcess });
    assert.equal(actual.status, status);
    assert.doesNotMatch(JSON.stringify(actual), /private-token/);
  }
});

test("Codex usage bounds stalled processes and handles a missing CLI", async (t) => {
  const fake = await fixture(t, {}, { wait: true });
  const actual = await readCodexUsage({
    spawnProcess: fake.spawnProcess,
    timeoutMs: 150,
  });
  assert.equal(actual.status, "error");
  assert.match(actual.message, /timed out/);
  assert.equal(
    (await readCodexUsage({ executable: "/does-not-exist/weft-codex" })).status,
    "unavailable",
  );
});
