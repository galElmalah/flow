import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { FlowClient } from "../client/index.mjs";
import { projectManifestSchema } from "../shared/projects.mjs";
import { startServer, stopServer } from "./server.mjs";

const info = async (file) =>
  lstat(file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });

export async function migrateProjectFiles(projectRoot, backupRoot) {
  const legacy = path.join(projectRoot, ".weft-project.json");
  const target = path.join(projectRoot, "flow.project.json");
  const result = { root: projectRoot, manifest: false, documents: [] };
  if (await info(legacy)) {
    const source = projectManifestSchema.parse(
      JSON.parse(await readFile(legacy, "utf8")),
    );
    if (await info(target)) {
      const current = projectManifestSchema.parse(
        JSON.parse(await readFile(target, "utf8")),
      );
      if (JSON.stringify(source) !== JSON.stringify(current))
        throw new Error(
          `Conflicting project manifests in ${projectRoot}; neither was changed.`,
        );
    } else await copyFile(legacy, target, constants.COPYFILE_EXCL);
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    await copyFile(legacy, path.join(backupRoot, "project.legacy.json"));
    await unlink(legacy);
    result.manifest = true;
  }
  for (const name of ["AGENTS.md", ".gitignore"]) {
    const file = path.join(projectRoot, name);
    if (!(await info(file))) continue;
    const old = await readFile(file, "utf8");
    let updated = old
      .replaceAll(".weft-project.json", "flow.project.json")
      .replaceAll("cli/weft.mjs", "cli/flow.mjs")
      .replace(/\bWeft\b/g, "Flow")
      .replaceAll("WEFT_", "FLOW_");
    if (
      name === ".gitignore" &&
      !updated.split(/\r?\n/).includes("flow.project.json")
    )
      updated += "\n# Local Flow project pointer\nflow.project.json\n";
    if (updated === old) continue;
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    await writeFile(path.join(backupRoot, name + ".before-flow"), old, {
      mode: 0o600,
    });
    await writeFile(file, updated);
    result.documents.push(name);
  }
  return result;
}

export async function migrateDataFiles(root) {
  const canonical = path.join(root, ".flow");
  const legacy = path.join(root, ".weft");
  const old = await info(legacy),
    current = await info(canonical);
  if (old && !old.isSymbolicLink() && current)
    throw new Error(
      "Both .weft and .flow directories exist. No workspace was moved.",
    );
  if (
    old?.isSymbolicLink() &&
    (await realpath(legacy)) !== (await realpath(canonical))
  )
    throw new Error("The legacy data alias points to another workspace.");
  let moved = false;
  if (old && !old.isSymbolicLink()) {
    await writeFile(
      path.join(legacy, "legacy-path-alias.json"),
      JSON.stringify({ from: legacy, to: canonical }) + "\n",
      { mode: 0o600 },
    );
    await rename(legacy, canonical);
    moved = true;
    await symlink(canonical, legacy, "junction");
  }
  if (
    !old &&
    current &&
    (await info(path.join(canonical, "legacy-path-alias.json")))
  )
    await symlink(canonical, legacy, "junction");
  let receipts = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (
        entry.isDirectory() &&
        ![
          ".git",
          ".venv",
          "venv",
          "site-packages",
          "__pycache__",
          "runs",
          "uploads",
          "workflows",
          "telemetry",
          "probes",
          "image-editors",
          "migration-backup",
        ].includes(entry.name)
      )
        await walk(file);
      if (!entry.isFile() || !entry.name.endsWith(".weft.json")) continue;
      const target = file.slice(0, -".weft.json".length) + ".flow.json";
      if (await info(target))
        throw new Error(`Conflicting model receipt: ${target}`);
      await rename(file, target);
      receipts++;
    }
  }
  if (await info(canonical)) await walk(canonical);
  return {
    dataDirectory: canonical,
    moved,
    receipts,
    legacyPathAlias: Boolean(await info(legacy)),
  };
}

export async function migrateInstallation({ root, url, plan = false }) {
  const oldData = path.join(root, ".weft");
  const newData = path.join(root, ".flow");
  if (
    process.env.FLOW_DATA_DIR &&
    path.resolve(process.env.FLOW_DATA_DIR) !== newData
  )
    throw new Error(
      "Use the standard data directory for this migration; custom storage requires an explicit separate migration.",
    );
  let running = null;
  try {
    const response = await fetch(new URL("/api/server", url), {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new Error("The local port is serving another application.");
    running = await response.json();
    if (
      !["weft", "flow"].includes(running.application) ||
      running.root !== root ||
      ![oldData, newData].includes(running.dataDirectory)
    )
      throw new Error(
        "Another workspace is using this port. Nothing was changed.",
      );
  } catch (error) {
    if (error.cause?.code !== "ECONNREFUSED") throw error;
  }
  if (plan)
    return {
      root,
      from: oldData,
      to: newData,
      running: Boolean(running),
      activeJobs: running?.activeJobs || 0,
    };
  if (running)
    await stopServer({
      url,
      root,
      dataRoot: running.dataDirectory,
      allowLegacy: true,
    });
  const storage = await migrateDataFiles(root);
  await startServer({ url, root, dataRoot: storage.dataDirectory });
  const client = new FlowClient({ url });
  const projects = await client.projects({ archived: "all" });
  const migrated = [];
  for (const project of projects) {
    if (!(await info(project.root))) continue;
    if (project.root !== root)
      migrated.push(
        await migrateProjectFiles(
          project.root,
          path.join(
            storage.dataDirectory,
            "migration-backup",
            "projects",
            project.id,
          ),
        ),
      );
    if (!project.archived && project.name.includes("Weft"))
      await client.updateProject(project.id, {
        name: project.name.replaceAll("Weft", "Flow"),
      });
  }
  return { ...storage, projects: migrated, url };
}
