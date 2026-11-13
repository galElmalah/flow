import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

export async function installCli({
  binDir = process.env.FLOW_BIN_DIR || path.join(homedir(), ".local", "bin"),
  action = "install",
  installation = root,
} = {}) {
  if (process.platform === "win32")
    throw new Error(
      "Use npm link on Windows; the user launcher supports macOS and Linux.",
    );
  if (!["install", "uninstall"].includes(action))
    throw new Error("Choose install or uninstall.");
  const directory = path.resolve(binDir);
  const executable = path.join(directory, "flow");
  const target = path.resolve(installation, "cli", "flow.mjs");
  const isManaged = async () => {
    const link = await readlink(executable).catch((error) => {
      if (!["ENOENT", "EINVAL"].includes(error.code)) throw error;
      return null;
    });
    return link !== null && path.resolve(directory, link) === target;
  };
  const existing = await lstat(executable).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  const managed = existing?.isSymbolicLink() && (await isManaged());
  if (
    existing &&
    !managed &&
    (await lstat(executable).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    }))
  )
    throw new Error(
      `Another command already exists at ${executable}. It was not changed. Choose another FLOW_BIN_DIR or remove the old installation yourself.`,
    );
  if (action === "uninstall") {
    const removed =
      managed &&
      (await unlink(executable)
        .then(() => true)
        .catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return false;
        }));
    return { command: executable, removed: Boolean(removed) };
  }
  if (!managed) {
    await mkdir(directory, { recursive: true });
    await symlink(target, executable).catch(async (error) => {
      if (error.code !== "EEXIST" || !(await isManaged())) throw error;
    });
  }
  const onPath = (process.env.PATH || "")
    .split(path.delimiter)
    .some((entry) => path.resolve(entry || ".") === directory);
  return {
    command: executable,
    target,
    alreadyInstalled: Boolean(managed),
    onPath,
  };
}
