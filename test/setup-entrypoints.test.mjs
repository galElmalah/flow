import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
test("setup, launcher and demo help or invalid arguments never install files or start work", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "flow-entrypoint-help-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    FLOW_DATA_DIR: path.join(home, "data"),
  };
  for (const script of ["setup", "install-cli", "demo"]) {
    const entry = path.join(root, "tools", script + ".mjs");
    const help = JSON.parse(
      (
        await execute(process.execPath, [entry, "--help", "--json"], {
          env,
          cwd: home,
        })
      ).stdout,
    );
    assert.equal(help.command, `node tools/${script}.mjs`);
    assert.ok(help.effect);
    const invalid = [
      ["--unknown", "--json"],
      ["unwanted", "--json"],
    ];
    if (script === "demo")
      invalid.push([
        "--url",
        "http://localhost:1",
        "--url",
        "http://localhost:2",
        "--json",
      ]);
    for (const args of invalid) {
      await assert.rejects(
        execute(process.execPath, [entry, ...args], { env, cwd: home }),
        (error) => {
          assert.equal(error.code, 1);
          assert.equal(error.stdout, "");
          const body = JSON.parse(error.stderr);
          assert.ok(body.error.code);
          assert.ok(body.error.message);
          if (args.includes("--url"))
            assert.match(body.error.message, /Conflicting values for --url/);
          return true;
        },
      );
    }
    assert.deepEqual(await readdir(home), []);
  }
});

test("machine-readable setup keeps PATH instructions on stderr", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "flow-entrypoint-install-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    FLOW_BIN_DIR: path.join(home, "bin"),
  };
  const result = await execute(
    process.execPath,
    [path.join(root, "tools/setup.mjs"), "--json"],
    { env, cwd: home },
  );
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.cli.onPath, false);
  assert.equal(parsed.skills.ready, true);
  assert.match(result.stderr, /PATH/);
});
