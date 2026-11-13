import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  symlink,
  readFile,
  writeFile,
  rm,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installCli } from "../cli/install.mjs";

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

test("user CLI runs from another project, installs idempotently and uninstalls only its own launcher", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "flow-cli-install-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const binDir = path.join(dir, "bin");
  const result = await installCli({ binDir });
  assert.equal(result.alreadyInstalled, false);
  const before = await lstat(result.command);
  assert.equal((await installCli({ binDir })).alreadyInstalled, true);
  assert.equal((await lstat(result.command)).mtimeMs, before.mtimeMs);
  const { version } = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  // A malformed consuming-project manifest must not prevent offline version checks.
  await writeFile(path.join(dir, "flow.project.json"), "not JSON");
  const reported = JSON.parse(
    (await execute(result.command, ["--version", "--json"], { cwd: dir }))
      .stdout,
  );
  assert.deepEqual(reported, { name: "flow", version });
  assert.match(
    (await execute(result.command, ["--help"], { cwd: dir })).stdout,
    /flow plan/,
  );
  assert.equal(
    (await installCli({ binDir, action: "uninstall" })).removed,
    true,
  );
  assert.equal(
    (await installCli({ binDir, action: "uninstall" })).removed,
    false,
  );
});

test("CLI installation and uninstall preserve foreign commands and links", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "flow-cli-conflict-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const file = path.join(binDir, "flow");
  await writeFile(file, "other application");
  for (const action of ["install", "uninstall"])
    await assert.rejects(installCli({ binDir, action }), /Another command/);
  assert.equal(await readFile(file, "utf8"), "other application");
  await rm(file);
  await symlink(path.join(binDir, "other-cli"), file);
  await assert.rejects(installCli({ binDir }), /Another command/);
  assert.ok((await lstat(file)).isSymbolicLink());
});

test("concurrent setup and removal converge on the same managed command", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "flow-cli-race-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const results = await Promise.all(
    Array.from({ length: 4 }, () => installCli({ binDir })),
  );
  assert.ok((await lstat(results[0].command)).isSymbolicLink());
  const removals = await Promise.all(
    Array.from({ length: 4 }, () =>
      installCli({ binDir, action: "uninstall" }),
    ),
  );
  assert.ok(removals.some((result) => result.removed));
  await assert.rejects(lstat(results[0].command), { code: "ENOENT" });
});

test("a local consumer imports the SDK and catalog through package exports", async (t) => {
  const consumer = await mkdtemp(path.join(tmpdir(), "flow-sdk-consumer-"));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  await mkdir(path.join(consumer, "node_modules"));
  await symlink(root, path.join(consumer, "node_modules", "flow"), "dir");
  const program = `import {FlowClient, createImageWorkflow, toFlowFile} from 'flow';
import {builtInStyles} from 'flow/styles';
const client=new FlowClient({url:'http://127.0.0.1:4310'});
console.log(JSON.stringify({url:client.url,styles:builtInStyles.length,workflow:typeof createImageWorkflow,files:typeof toFlowFile}));`;
  const result = JSON.parse(
    (
      await execute(process.execPath, ["--input-type=module", "-e", program], {
        cwd: consumer,
      })
    ).stdout,
  );
  assert.deepEqual(result, {
    url: "http://127.0.0.1:4310",
    styles: 257,
    workflow: "function",
    files: "function",
  });
});
