import {
  readdir,
  readFile,
  mkdir,
  mkdtemp,
  writeFile,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const marker = ".flow-install.json";
const owner = "flow-skills-v1";
const names = ["flow-workflows", "flow-image-editing", "flow-style-library"];
const hash = (content) => createHash("sha256").update(content).digest("hex");
const exists = async (file) =>
  Boolean(
    await lstat(file).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }),
  );

function targets(home, target) {
  if (!["all", "codex", "claude-code", "gemini", "pi"].includes(target))
    throw new Error(
      "Skill target must be all, codex, claude-code, gemini or pi.",
    );
  const result = [];
  if (target !== "claude-code")
    result.push({
      root: path.join(home, ".agents", "skills"),
      harnesses: ["codex", "gemini", "pi"],
    });
  if (target === "all" || target === "claude-code")
    result.push({
      root: path.join(home, ".claude", "skills"),
      harnesses: ["claude-code"],
    });
  return result;
}
async function filesIn(directory, prefix = "") {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Skill bundle cannot contain symlinks: ${relative}`);
    if (entry.isDirectory())
      Object.assign(
        result,
        await filesIn(path.join(directory, entry.name), relative),
      );
    else if (entry.isFile())
      result[relative] = await readFile(path.join(directory, entry.name));
  }
  return result;
}
async function inspect(directory, source) {
  if (!(await exists(directory))) return { status: "missing" };
  if (!(await lstat(directory)).isDirectory())
    return {
      status: "conflict",
      reason: "Destination is not a regular directory",
    };
  let receipt;
  try {
    receipt = JSON.parse(await readFile(path.join(directory, marker), "utf8"));
  } catch (error) {
    if (!["ENOENT", undefined].includes(error.code)) throw error;
    return { status: "conflict", reason: "Not installed by Flow" };
  }
  if (
    receipt.managedBy !== owner ||
    typeof receipt.files !== "object" ||
    !receipt.files
  )
    return { status: "conflict", reason: "Not installed by Flow" };
  const current = await filesIn(directory).catch(() => null);
  if (!current)
    return {
      status: "modified",
      reason: "Installed skill contains unreadable files or symlinks",
    };
  delete current[marker];
  if (
    Object.keys(current).length !== Object.keys(receipt.files).length ||
    Object.entries(current).some(
      ([file, bytes]) => receipt.files[file] !== hash(bytes),
    )
  )
    return {
      status: "modified",
      reason: "Locally edited skill; keep it or rename it before reinstalling",
    };
  const equal =
    receipt.cliPath === source.cliPath &&
    Object.keys(source.files).length === Object.keys(receipt.files).length &&
    Object.entries(source.files).every(
      ([file, bytes]) => receipt.files[file] === hash(bytes),
    );
  return { status: equal ? "installed" : "update-available" };
}

/** Per-user installation only; no provider login, shell configuration or inference. */
export async function manageSkills({
  action = "status",
  target = "all",
  home = homedir(),
  root = path.resolve(import.meta.dirname, ".."),
} = {}) {
  if (!["install", "status"].includes(action))
    throw new Error(
      "Use flow skills install|status [--target all|codex|claude-code|gemini|pi].",
    );
  const destinations = targets(home, target);
  const rows = [];
  for (const name of names) {
    const files = await filesIn(path.join(root, "skills", name));
    const source = { files, cliPath: path.join(root, "cli", "flow.mjs") };
    for (const destination of destinations) {
      const directory = path.join(destination.root, name);
      // Restore a previous installation if interruption occurred between the two renames.
      const backup = path.join(destination.root, `.${name}.flow-backup`);
      if (
        action === "install" &&
        !(await exists(directory)) &&
        (await exists(backup))
      ) {
        const prior = await inspect(backup, source);
        if (!["installed", "update-available"].includes(prior.status))
          throw new Error(`Cannot recover Flow skill backup: ${backup}`);
        await rename(backup, directory);
      }
      rows.push({
        name,
        directory,
        backup,
        harnesses: destination.harnesses,
        source,
        ...(await inspect(directory, source)),
      });
    }
  }
  if (action === "install") {
    const conflicts = rows.filter((row) =>
      ["modified", "conflict"].includes(row.status),
    );
    if (conflicts.length)
      throw new Error(
        "Skills were not replaced:\n" +
          conflicts.map((row) => `${row.directory}: ${row.reason}`).join("\n"),
      );
    for (const row of rows) {
      if (row.status === "installed") continue;
      await mkdir(path.dirname(row.directory), { recursive: true });
      if (await exists(row.backup)) {
        const prior = await inspect(row.backup, row.source);
        if (!["installed", "update-available"].includes(prior.status))
          throw new Error(`Unrecognized skill backup: ${row.backup}`);
        await rm(row.backup, { recursive: true });
      }
      const stage = await mkdtemp(
        path.join(path.dirname(row.directory), `.${row.name}-`),
      );
      let backedUp = false;
      try {
        for (const [file, bytes] of Object.entries(row.source.files)) {
          const output = path.join(stage, file);
          await mkdir(path.dirname(output), { recursive: true });
          await writeFile(output, bytes);
        }
        await writeFile(
          path.join(stage, marker),
          JSON.stringify(
            {
              managedBy: owner,
              cliPath: row.source.cliPath,
              files: Object.fromEntries(
                Object.entries(row.source.files).map(([file, bytes]) => [
                  file,
                  hash(bytes),
                ]),
              ),
            },
            null,
            2,
          ) + "\n",
        );
        if (await exists(row.directory)) {
          await rename(row.directory, row.backup);
          backedUp = true;
        }
        await rename(stage, row.directory);
        if (backedUp) await rm(row.backup, { recursive: true });
        row.status = "installed";
      } catch (error) {
        if (backedUp && !(await exists(row.directory)))
          await rename(row.backup, row.directory);
        throw error;
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }
  }
  const skills = rows.map(({ name, directory, harnesses, status, reason }) => ({
    name,
    directory,
    harnesses,
    status,
    ...(reason && { reason }),
  }));
  return {
    action,
    ready: skills.every((skill) => skill.status === "installed"),
    skills,
    hint: "Reload skills or start a new harness session. Codex, Gemini and Pi share ~/.agents/skills; Claude Code uses ~/.claude/skills.",
  };
}
