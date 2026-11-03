import test from "node:test";
import assert from "node:assert/strict";
import {
  realpath,
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
  rename,
  symlink,
  cp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { manageSkills } from "../cli/skills.mjs";

const exec = promisify(execFile);
const names = ["flow-workflows", "flow-image-editing", "flow-style-library"];
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "flow skills "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "Flow checkout"),
    home = path.join(directory, "user home");
  await mkdir(path.join(root, "cli"), { recursive: true });
  await writeFile(
    path.join(root, "cli", "flow.mjs"),
    "console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));",
  );
  for (const name of names) {
    const folder = path.join(root, "skills", name, "scripts");
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, "..", "SKILL.md"),
      `---\nname: ${name}\ndescription: Operate Flow workflows.\n---\nOriginal instructions\n`,
    );
    await cp(
      path.resolve(import.meta.dirname, "../skills", name, "scripts/flow.mjs"),
      path.join(folder, "flow.mjs"),
    );
  }
  return { root, home, directory };
}

test("setup installs discoverable user skills, reruns without writes, and launchers preserve cwd/arguments without shell expansion", async (t) => {
  const options = await fixture(t);
  const before = await manageSkills(options);
  assert.equal(before.ready, false);
  await assert.rejects(stat(options.home), { code: "ENOENT" });
  const installed = await manageSkills({ ...options, action: "install" });
  assert.equal(installed.ready, true);
  assert.equal(installed.skills.length, 6);
  const skill = installed.skills.find(
    (row) => row.harnesses.includes("codex") && row.name === "flow-workflows",
  );
  const marker = path.join(skill.directory, ".flow-install.json");
  const writtenAt = (await stat(marker)).mtimeMs;
  assert.equal(
    (await manageSkills({ ...options, action: "install" })).ready,
    true,
  );
  assert.equal((await stat(marker)).mtimeMs, writtenAt);
  const cwd = path.join(options.directory, "consuming project");
  await mkdir(cwd);
  const args = [
    "workflow",
    "create",
    "--prompt",
    'Literal $(echo secret) `command` "words"',
  ];
  const result = await exec(
    process.execPath,
    [path.join(skill.directory, "scripts/flow.mjs"), ...args],
    { cwd },
  );
  assert.deepEqual(JSON.parse(result.stdout), { args, cwd: await realpath(cwd) });
});

test("bundled updates and relocated checkouts refresh managed skills; user edits and collisions are preserved", async (t) => {
  const options = await fixture(t);
  const installed = await manageSkills({ ...options, action: "install" });
  const updated = path.join(options.root, "skills/flow-workflows/SKILL.md");
  await writeFile(updated, (await readFile(updated, "utf8")) + "New version\n");
  assert.equal((await manageSkills(options)).ready, false);
  await manageSkills({ ...options, action: "install" });
  const file = path.join(installed.skills[0].directory, "SKILL.md");
  assert.match(await readFile(file, "utf8"), /New version/);
  const relocatedRoot = path.join(options.directory, "renamed checkout");
  await rename(options.root, relocatedRoot);
  await manageSkills({ ...options, root: relocatedRoot, action: "install" });
  const receipt = JSON.parse(
    await readFile(
      path.join(installed.skills[0].directory, ".flow-install.json"),
      "utf8",
    ),
  );
  assert.equal(receipt.cliPath, path.join(relocatedRoot, "cli/flow.mjs"));
  await writeFile(file, "My customized instructions");
  await assert.rejects(
    manageSkills({ ...options, root: relocatedRoot, action: "install" }),
    /Locally edited skill/,
  );
  assert.equal(await readFile(file, "utf8"), "My customized instructions");

  const fresh = await fixture(t);
  const foreign = path.join(fresh.home, ".claude/skills/flow-style-library");
  await mkdir(foreign, { recursive: true });
  await writeFile(path.join(foreign, "SKILL.md"), "Unrelated skill");
  await assert.rejects(
    manageSkills({ ...fresh, action: "install" }),
    /Not installed by Flow/,
  );
  assert.equal(
    await readFile(path.join(foreign, "SKILL.md"), "utf8"),
    "Unrelated skill",
  );
  await assert.rejects(stat(path.join(fresh.home, ".agents")), {
    code: "ENOENT",
  });
});

test("skill setup recovers interrupted replacement, honors harness selection, and refuses foreign symlink destinations", async (t) => {
  const options = await fixture(t);
  const installed = await manageSkills({
    ...options,
    target: "pi",
    action: "install",
  });
  assert.equal(installed.skills.length, 3);
  await assert.rejects(stat(path.join(options.home, ".claude")), {
    code: "ENOENT",
  });
  const first = installed.skills[0];
  await rename(
    first.directory,
    path.join(path.dirname(first.directory), `.${first.name}.flow-backup`),
  );
  assert.equal(
    (await manageSkills({ ...options, target: "codex", action: "install" }))
      .ready,
    true,
  );
  const other = await fixture(t);
  const destination = path.join(other.home, ".agents/skills/flow-workflows");
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(other.root, destination, "dir");
  await assert.rejects(
    manageSkills({ ...other, action: "install" }),
    /not a regular directory/,
  );
  assert.equal(
    (await stat(path.join(other.root, "cli/flow.mjs"))).isFile(),
    true,
  );
});

test("skills CLI runs offline independently of a consuming project manifest, and rejects invalid targets without writes", async (t) => {
  const options = await fixture(t);
  const cwd = path.join(options.directory, "consumer");
  await mkdir(cwd);
  await writeFile(path.join(cwd, "flow.project.json"), "not JSON");
  const command = path.resolve(import.meta.dirname, "../cli/flow.mjs");
  const { stdout } = await exec(
    process.execPath,
    [command, "skills", "status", "--json"],
    {
      cwd,
      env: { ...process.env, HOME: options.home },
    },
  );
  assert.equal(JSON.parse(stdout).ready, false);
  await assert.rejects(
    exec(
      process.execPath,
      [command, "skills", "install", "--target", "unknown", "--json"],
      {
        cwd,
        env: { ...process.env, HOME: options.home },
      },
    ),
    /Skill target must be/,
  );
  await assert.rejects(stat(options.home), { code: "ENOENT" });
});
