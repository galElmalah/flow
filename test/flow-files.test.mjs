import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { starter } from "../server/defaults.mjs";
import { Store } from "../server/store.mjs";
import {
  toFlowFile,
  fromFlowFile,
  flowFileName,
} from "../shared/flow-file.mjs";
import { migrateDataFiles, migrateProjectFiles } from "../cli/migration.mjs";
import { migrateBrowserStorage } from "../src/studio/storage-migration.mjs";

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flow-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("Flow files identify their version and round-trip graphs; legacy graph JSON remains readable", () => {
  const file = toFlowFile(starter);
  assert.equal(file.format, "flow");
  assert.equal(file.version, 1);
  assert.deepEqual(fromFlowFile(file), fromFlowFile(starter));
  assert.throws(() => fromFlowFile({ ...file, version: 2 }));
  assert.throws(() => fromFlowFile({ ...file, format: "another-app" }));
  assert.equal(flowFileName("campaign.json"), "campaign.flow.json");
  assert.equal(flowFileName("campaign.flow.json"), "campaign.flow.json");
});

test("browser migration preserves a draft and never replaces newer Flow preferences", () => {
  const values = new Map([
    ["weft:draft", "unsaved graph"],
    ["weft:theme", "old"],
    ["flow:theme", "new"],
  ]);
  const storage = {
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i],
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  migrateBrowserStorage(storage);
  assert.equal(values.get("flow:draft"), "unsaved graph");
  assert.equal(values.has("weft:draft"), false);
  assert.equal(values.get("flow:theme"), "new");
});

test("workspace migration preserves bytes, keeps installed absolute paths usable and is idempotent", async (t) => {
  const root = await temporary(t),
    legacy = path.join(root, ".weft");
  await mkdir(path.join(legacy, "models"), { recursive: true });
  await writeFile(
    path.join(legacy, "models", "weights.bin"),
    "original-model-bytes",
  );
  await writeFile(
    path.join(legacy, "models", "weights.bin.weft.json"),
    "original-receipt",
  );
  const first = await migrateDataFiles(root);
  assert.equal(first.moved, true);
  assert.equal(first.receipts, 1);
  assert.equal((await lstat(legacy)).isSymbolicLink(), true);
  assert.equal(
    await readFile(path.join(legacy, "models", "weights.bin"), "utf8"),
    "original-model-bytes",
  );
  assert.equal(
    await readFile(
      path.join(root, ".flow/models/weights.bin.flow.json"),
      "utf8",
    ),
    "original-receipt",
  );
  assert.equal((await migrateDataFiles(root)).moved, false);
});

test("migration refuses to combine two independent workspaces", async (t) => {
  const root = await temporary(t);
  await mkdir(path.join(root, ".flow"));
  await mkdir(path.join(root, ".weft"));
  await assert.rejects(migrateDataFiles(root), /Both/);
});

test("project migration updates the pointer and agent instructions without changing project identity", async (t) => {
  const root = await temporary(t),
    backup = path.join(root, "backup");
  const manifest = {
    version: 1,
    projectId: "demo",
    serverUrl: "http://localhost:4310",
    defaultWorkflowId: "scene",
  };
  await writeFile(
    path.join(root, ".weft-project.json"),
    JSON.stringify(manifest),
  );
  await writeFile(
    path.join(root, "AGENTS.md"),
    "Use Weft via cli/weft.mjs and .weft-project.json. Keep the source unchanged.\n",
  );
  await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  assert.equal((await migrateProjectFiles(root, backup)).manifest, true);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, "flow.project.json"))),
    manifest,
  );
  assert.equal(
    await readFile(path.join(root, "AGENTS.md"), "utf8"),
    "Use Flow via cli/flow.mjs and flow.project.json. Keep the source unchanged.\n",
  );
  assert.equal((await migrateProjectFiles(root, backup)).manifest, false);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(backup, "project.legacy.json"))),
    manifest,
  );
});

test("conflicting project pointers are retained for resolution", async (t) => {
  const root = await temporary(t);
  const manifest = {
    version: 1,
    projectId: "one",
    serverUrl: "http://localhost:4310",
  };
  await writeFile(
    path.join(root, ".weft-project.json"),
    JSON.stringify(manifest),
  );
  await writeFile(
    path.join(root, "flow.project.json"),
    JSON.stringify({ ...manifest, projectId: "two" }),
  );
  await assert.rejects(
    migrateProjectFiles(root, path.join(root, "backup")),
    /Conflicting/,
  );
  assert.equal(
    (await lstat(path.join(root, ".weft-project.json"))).isFile(),
    true,
  );
});

test("renaming the SQLite store preserves documents and creates a recoverable backup", async (t) => {
  const root = await temporary(t);
  const before = new Store(root);
  await before.init();
  await before.saveWorkflow(starter);
  await before.close();
  await rename(path.join(root, "flow.sqlite"), path.join(root, "weft.sqlite"));
  const after = new Store(root);
  await after.init();
  t.after(() => after.close());
  assert.equal(after.workflows.get(starter.id).name, starter.name);
  assert.equal(
    (
      await lstat(path.join(root, "migration-backup/database/legacy.sqlite"))
    ).isFile(),
    true,
  );
  assert.equal((await lstat(path.join(root, "flow.sqlite"))).mode & 0o077, 0);
});
