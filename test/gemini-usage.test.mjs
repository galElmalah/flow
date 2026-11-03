import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readGeminiUsage } from "../harness-integrations/gemini/usage.mjs";

test("missing Gemini CLI reports unavailable without inventing account usage", async () => {
  const result = await readGeminiUsage({
    executable: "/nonexistent/flow-gemini-usage-test",
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.windows, []);
  assert.match(result.message, /not installed/);
  assert.match(result.message, /Antigravity/);
});

test("Gemini usage checks never start a prompt or execute slash commands headlessly", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flow-gemini-usage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, "gemini");
  const marker = path.join(directory, "executed");
  await writeFile(executable, `#!/bin/sh\nprintf invoked > '${marker}'\n`);
  await chmod(executable, 0o700);
  const result = await readGeminiUsage({ executable });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.windows, []);
  assert.match(result.message, /\/stats model/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});
