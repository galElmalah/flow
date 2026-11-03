import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  claudeModelsFromInitialization,
  claudeTextModels,
} from "../harness-integrations/claude-code/models.mjs";
import { harnessModelOptions } from "../src/agent/harness-model-options.mjs";
import { reasoningLevels, selectedReasoning } from "../shared/reasoning.mjs";
import { invocation } from "../harness-integrations/claude-code/index.mjs";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";

const report = {
  account: { token: "private-account-token" },
  models: [
    {
      value: "default",
      displayName: "Default",
      description: "Your account default",
      resolvedModel: "claude-fixture-opus",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      value: "opus",
      displayName: "Opus fixture",
      description: "Complex work",
      supportsEffort: true,
      supportedEffortLevels: ["low", "high", "max", "unknown", "high"],
    },
    {
      value: "haiku",
      displayName: "Haiku fixture",
      supportsEffort: false,
      supportedEffortLevels: ["high"],
    },
    null,
    { value: "bad\nvalue" },
    { value: "long".repeat(100) },
  ],
};

test("Claude native models reach searchable choices and thinking dial without leaking account data", () => {
  const details = claudeModelsFromInitialization(report);
  assert.deepEqual(
    details.map((m) => m.id),
    ["default", "opus", "haiku"],
  );
  assert.equal(
    JSON.stringify(details).includes("private-account-token"),
    false,
  );
  const provider = {
    id: "claude-code",
    name: "Claude Code",
    ready: true,
    capabilities: ["text"],
    models: details.map((m) => m.id),
    modelDetails: details,
  };
  const options = harnessModelOptions([provider], "claude-code", "default");
  assert.equal(
    options[0].children.find((m) => m.modelId === "opus").label,
    "Opus fixture",
  );
  assert.deepEqual(reasoningLevels(provider, "opus"), ["low", "high", "max"]);
  assert.deepEqual(reasoningLevels(provider, "haiku"), []);
  assert.equal(selectedReasoning(provider, "haiku", "high"), "inherit");
  const command = invocation({
    job: { model: "opus", prompt: "Scene", reasoningEffort: "max" },
  });
  assert.equal(command.args[command.args.indexOf("--model") + 1], "opus");
  assert.equal(command.args[command.args.indexOf("--effort") + 1], "max");
});

test("Claude model discovery uses read-only initialization, deduplicates concurrent loads and refreshes after expiry", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "flow-claude-model-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, "claude-fixture"),
    calls = path.join(directory, "requests.jsonl");
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
require('node:readline').createInterface({input:process.stdin}).on('line', line=>{
 const request=JSON.parse(line);
 fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(request)+'\\n');
 if(request.type!=='control_request'||request.request.subtype!=='initialize') process.exit(12);
 process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:request.request_id,response:${JSON.stringify(report)}}})+'\\n');
});
`,
  );
  await chmod(executable, 0o755);
  const results = await Promise.all([
    claudeTextModels({ executable, now: 100 }),
    claudeTextModels({ executable, now: 101 }),
  ]);
  assert.equal(results[0].length, 3);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 1);
  await claudeTextModels({ executable, now: 30101 });
  assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 2);
});

test("unsupported or unavailable Claude discovery returns no invented model names", async () => {
  assert.deepEqual(
    await claudeTextModels({
      executable: "/missing/claude-for-flow-test",
      timeoutMs: 100,
    }),
    [],
  );
  assert.deepEqual(
    await claudeTextModels({
      read: async () => ({ account: "private", models: null }),
    }),
    [],
  );
  assert.deepEqual(
    await claudeTextModels({
      read: async () => {
        throw new Error("Unsupported control");
      },
    }),
    [],
  );
});

test("provider reload replaces the Claude default-only catalog while preserving default on older CLIs", async (t) => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "flow-claude-registry-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  class FixtureRegistry extends ProviderRegistry {
    async status() {
      return { installed: true, ready: true };
    }
  }
  let discovered = claudeModelsFromInitialization(report);
  const registry = new FixtureRegistry({
    root: path.resolve(import.meta.dirname, ".."),
    dataRoot,
    definitions: [],
    claudeModels: async () => discovered,
    ollama: { catalog: async () => [] },
    comfy: { catalog: async () => [] },
  });
  let catalog = await registry.reload();
  let claude = catalog.find((p) => p.id === "claude-code");
  assert.deepEqual(claude.models, ["default", "opus", "haiku"]);
  assert.deepEqual(claude.modelDetails[1].reasoning.levels, [
    "low",
    "high",
    "max",
  ]);
  discovered = [];
  catalog = await registry.reload();
  claude = catalog.find((p) => p.id === "claude-code");
  assert.deepEqual(claude.models, ["default"]);
});
