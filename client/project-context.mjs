import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { projectManifestSchema } from "../shared/projects.mjs";

export const manifestName = "flow.project.json";
export async function readProjectManifest(file) {
  const path = resolve(file);
  const manifest = projectManifestSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  return { manifest, path, root: await realpath(dirname(path)) };
}
export async function findProjectContext(start = process.cwd()) {
  let directory = await realpath(resolve(start));
  if (!(await stat(directory)).isDirectory()) directory = dirname(directory);
  for (;;) {
    try {
      return await readProjectManifest(join(directory, manifestName));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          `Invalid ${join(directory, manifestName)}: ${error.message}`,
        );
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
