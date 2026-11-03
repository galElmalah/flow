import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { HarnessUsage, publicUsage } from "../harness-integrations/usage.mjs";
import { registerProviderRoutes } from "../server/routes/providers.mjs";
import { FlowClient } from "../client/index.mjs";
import { usageIsStale } from "../shared/harness-usage.mjs";

const unavailable = async () => ({
  status: "unavailable",
  source: "Fixture",
  windows: [],
});
const readers = (codex = unavailable) => ({
  codex,
  "claude-code": unavailable,
  "gemini-cli": unavailable,
  pi: unavailable,
});
const quota = (percent) => ({
  status: "available",
  source: "Fixture",
  windows: [
    {
      id: "weekly",
      label: "Weekly",
      usedPercent: percent,
      resetAt: "2030-11-04T10:00:00Z",
    },
  ],
});

test("stale indicators cover failed reads, expired quota windows and old account reads", () => {
  const checkedAt = "2026-10-30T10:00:00Z";
  const account = { ...quota(0), checkedAt };
  assert.equal(usageIsStale(account, Date.parse(checkedAt)), false);
  assert.equal(usageIsStale(account, Date.parse(checkedAt) + 120001), true);
  assert.equal(
    usageIsStale({ ...account, stale: true }, Date.parse(checkedAt)),
    true,
  );
  assert.equal(
    usageIsStale(
      { ...account, windows: [{ resetAt: checkedAt }] },
      Date.parse(checkedAt),
    ),
    true,
  );
});

test("quota DTO preserves zero and reported time, rejects invalid percentages, and strips unrelated private fields", () => {
  const value = publicUsage({
    ...quota(0),
    fetchedAt: "2026-10-30T09:00:00Z",
    apiKey: "SECRET",
    windows: [
      ...quota(0).windows,
      { usedPercent: null },
      { usedPercent: "50" },
      { usedPercent: -1 },
      { usedPercent: 101 },
      { usedPercent: Infinity },
    ],
  });
  assert.equal(value.windows.length, 1);
  assert.equal(value.windows[0].usedPercent, 0);
  assert.equal(value.reportedAt, "2026-10-30T09:00:00.000Z");
  assert.ok(!JSON.stringify(value).includes("SECRET"));
  assert.equal(
    publicUsage({ status: "available", windows: [] }).status,
    "unavailable",
  );
});

test("concurrent hover/agent reads share a quota request, group Codex image/text, and cache for a minute", async () => {
  let calls = 0,
    now = 100000;
  let resolve;
  const usage = new HarnessUsage({
    now: () => now,
    adapters: readers(() => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    }),
  });
  const first = usage.read([]),
    second = usage.read([]);
  assert.equal(calls, 1);
  resolve(quota(0));
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.accounts[0].providerIds, ["codex", "codex-text"]);
  now += 9000;
  await usage.read([], { refresh: true });
  assert.equal(calls, 1);
  await usage.read([]);
  assert.equal(calls, 1);
});

test("refresh failures retain explicitly stale quota with its original timestamp and never leak raw errors", async () => {
  let now = 100000,
    fail = false;
  const usage = new HarnessUsage({
    now: () => now,
    adapters: readers(async () => {
      if (fail) throw new Error("secret-auth-token");
      return quota(28);
    }),
  });
  const first = (await usage.read([])).accounts[0];
  now += 60001;
  fail = true;
  const failed = (await usage.read([])).accounts[0];
  assert.equal(failed.status, "error");
  assert.equal(failed.stale, true);
  assert.equal(failed.windows[0].usedPercent, 28);
  assert.equal(failed.checkedAt, first.checkedAt);
  assert.equal(failed.attemptedAt, new Date(now).toISOString());
  assert.ok(!JSON.stringify(failed).includes("secret-auth-token"));
});

test("usage endpoint and client expose read-only quota without provider credentials, unavailable API is not 0%", async (t) => {
  const usage = new HarnessUsage({ adapters: readers(async () => quota(46)) });
  const definitions = new Map([
    ["codex", { id: "codex", name: "Codex Image", kind: "codex" }],
    [
      "byok",
      {
        id: "byok",
        name: "My endpoint",
        kind: "compatible",
        apiKey: "private-key",
        baseUrl: "https://private.example/v1",
      },
    ],
    ["local-color", { id: "local-color", kind: "command" }],
  ]);
  const app = express();
  registerProviderRoutes(app, { providers: { definitions }, usage });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  t.after(() => new Promise((done) => server.close(done)));
  const client = new FlowClient({
    url: `http://127.0.0.1:${server.address().port}`,
  });
  const report = await client.harnessUsage({ refresh: true });
  assert.equal(report.accounts[0].windows[0].usedPercent, 46);
  const api = report.accounts.find((account) => account.id === "byok");
  assert.equal(api.billing, "api");
  assert.equal(api.status, "unavailable");
  assert.deepEqual(api.windows, []);
  assert.ok(!JSON.stringify(report).includes("private-key"));
  assert.ok(!JSON.stringify(report).includes("private.example"));
  assert.ok(!report.accounts.some((account) => account.id === "local-color"));
});

test("local models have no API billing quota and native paid media providers keep API billing", async () => {
  const usage = new HarnessUsage({ adapters: readers(async () => quota(0)) });
  const report = await usage.read([
    { id: "ollama", name: "Ollama", kind: "ollama" },
    { id: "comfyui-image", name: "ComfyUI", kind: "comfyui" },
    { id: "grok-image", name: "Grok", kind: "grok" },
    { id: "gemini-video", name: "Gemini Video", kind: "gemini-video" },
  ]);
  for (const id of ["ollama", "comfyui-image"]) {
    const account = report.accounts.find((a) => a.id === id);
    assert.equal(account.billing, "local");
    assert.match(account.message, /No subscription quota or API billing/);
    assert.deepEqual(account.windows, []);
  }
  for (const id of ["grok-image", "gemini-video"])
    assert.equal(report.accounts.find((a) => a.id === id).billing, "api");
});

test("switching Codex authentication discards an in-flight previous account's quota", async () => {
  let release;
  const old = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const usage = new HarnessUsage({
    adapters: readers(async () => {
      calls++;
      if (calls === 1) return old;
      return {
        status: "unavailable",
        source: "OpenAI API",
        billing: "api",
        message: "API billing",
        windows: [],
      };
    }),
  });
  const previous = usage.read([]);
  usage.invalidate("codex");
  const current = await usage.read([]);
  release(quota(88));
  const resolved = await previous;
  assert.equal(current.accounts[0].billing, "api");
  assert.deepEqual(current.accounts[0].windows, []);
  assert.deepEqual(resolved.accounts[0].windows, []);
  assert.equal((await usage.read([])).accounts[0].billing, "api");
  assert.equal(calls, 2);
});
