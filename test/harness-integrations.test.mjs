import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  chmod,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import {
  harnesses,
  harnessInvocation,
  parseHarnessText,
  runHarness,
  harnessStatus,
} from "../harness-integrations/harnesses.mjs";
import { ConnectionStore } from "../harness-integrations/openai-compatible/connections.mjs";

async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "flow-integrations-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

test("all built-in harness IDs are reserved and unknown adapters cannot fall through to Pi", async (t) => {
  const root = await directory(t);
  for (const id of ["codex", "local-color", ...harnesses.map((p) => p.id)]) {
    const registry = new ProviderRegistry({
      root,
      dataRoot: root,
      definitions: [
        {
          id,
          name: "Collision",
          kind: "command",
          command: [process.execPath],
          models: ["default"],
        },
      ],
    });
    await assert.rejects(() => registry.reload(), /reserved provider ID/);
  }
  assert.throws(
    () => harnessInvocation({ id: "unknown" }, {}),
    /Unknown text harness/,
  );
  assert.throws(
    () => parseHarnessText("unknown", "text"),
    /Unknown text harness/,
  );
  assert.throws(
    () => runHarness({ id: "unknown" }, {}),
    /Unknown text harness/,
  );
  assert.throws(
    () => parseHarnessText("gemini-cli", "null"),
    /invalid final-answer JSON/,
  );
});

test("CLI installation is distinct from verified sign-in", async () => {
  for (const id of ["pi", "gemini-cli"]) {
    const provider = {
      ...harnesses.find((p) => p.id === id),
      executable: process.execPath,
    };
    const installed = await harnessStatus(provider);
    assert.equal(installed.installed, true);
    assert.equal(installed.authenticated, null);
    assert.match(installed.status, /sign-in not verified/);
    const missing = await harnessStatus({
      ...provider,
      executable: "/flow-missing-harness",
    });
    assert.equal(missing.ready, false);
    assert.equal(missing.installed, false);
  }
});

test("the three print-mode adapters execute their declared protocol and return only final text", async (t) => {
  const root = await directory(t);
  const executable = path.join(root, "fixture");
  await writeFile(
    executable,
    `#!${process.execPath}
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const args = process.argv.slice(2);
await writeFile(path.join(process.cwd(), 'received.json'), JSON.stringify({ args, input }));
if (args.includes('stream-json')) process.stdout.write(JSON.stringify({type:'assistant',message:{content:'IGNORE PROGRESS'}})+'\\n'+JSON.stringify({type:'result',result:'CLAUDE FINAL'}));
else if (args.includes('--approval-mode')) process.stdout.write(JSON.stringify({response:'GEMINI FINAL',stats:{tokens:2}}));
else process.stdout.write('PI FINAL');
`,
  );
  await chmod(executable, 0o700);
  const expected = {
    "claude-code": "CLAUDE FINAL",
    "gemini-cli": "GEMINI FINAL",
    pi: "PI FINAL",
  };
  for (const preset of harnesses.filter((p) => p.id !== "codex-text")) {
    const jobDirectory = path.join(root, preset.id);
    await mkdir(jobDirectory);
    const prompt = "literal $(touch SHOULD_NOT_EXIST) `command`";
    const result = await runHarness(
      { ...preset, executable },
      {
        job: { prompt, model: "my-model" },
        directory: jobDirectory,
        imagePaths: [],
        signal: new AbortController().signal,
      },
    );
    assert.equal(result, expected[preset.id]);
    const received = JSON.parse(
      await readFile(path.join(jobDirectory, "received.json"), "utf8"),
    );
    assert.ok(received.input.includes(prompt));
    assert.ok(!received.args.some((arg) => arg.includes(prompt)));
    assert.equal(
      received.args[received.args.indexOf("--model") + 1],
      "my-model",
    );
    if (preset.id === "pi") {
      assert.ok(received.args.includes("--no-mcp"));
      assert.ok(received.args.includes("--no-context-files"));
    }
    if (preset.id === "claude-code") {
      assert.equal(received.args[received.args.indexOf("--tools") + 1], "");
      assert.equal(
        JSON.parse(received.input).message.content.at(-1).type,
        "text",
      );
    }
  }
});

test("malformed private connections fail without exposing credentials", async (t) => {
  const root = await directory(t);
  const secret = "canary-secret-not-for-errors";
  await writeFile(
    path.join(root, "connections.json"),
    JSON.stringify([{ apiKey: secret }]),
  );
  await assert.rejects(
    () => new ConnectionStore(root).load(),
    (error) => {
      assert.match(error.message, /Could not read private connections/);
      assert.ok(!error.message.includes(secret));
      return true;
    },
  );
});
