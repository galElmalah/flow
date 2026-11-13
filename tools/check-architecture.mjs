import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const roots = [
  "observability",
  "server",
  "shared",
  "client",
  "cli",
  "skills",
  "harness-integrations",
  "image-tools",
  "src",
  "examples",
  "test",
  "tools",
  "mcp",
];
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["results", "dual-flow-results", "node_modules"].includes(entry.name))
      continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(mjs|jsx)$/.test(entry.name)) files.push(file);
  }
}
if (existsSync(path.join(root, ".git"))) {
  const names = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...roots,
    ],
    { cwd: root, encoding: "utf8" },
  );
  for (const name of names.split("\0")) {
    const file = path.join(root, name);
    if (/\.(mjs|jsx)$/.test(name) && existsSync(file)) files.push(file);
  }
} else {
  // Source archives have no index or ignored working files.
  await Promise.all(roots.map((dir) => walk(path.join(root, dir))));
}
const errors = [],
  dependencies = new Map();
const relative = (file) => path.relative(root, file);
for (const file of files) {
  const source = await readFile(file, "utf8");
  if (relative(file).startsWith("src/") && /<\s*(select|option)\b/.test(source))
    errors.push(
      `${relative(file)}: use src/components/Autocomplete.jsx for searchable choices instead of native select/option elements`,
    );
  const imports = [
    ...source.matchAll(
      /(?:\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?|\bimport\s*\()\s*["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]);
  const local = [];
  for (const specifier of imports) {
    if (relative(file).startsWith("src/") && specifier.startsWith("node:"))
      errors.push(`${relative(file)}: browser UI cannot import ${specifier}`);
    if (!specifier.startsWith(".")) continue;
    const target = path.resolve(path.dirname(file), specifier);
    if (!(await stat(target).catch(() => null)))
      errors.push(`${relative(file)}: missing import ${specifier}`);
    local.push(target);
    const owner = relative(file).split(path.sep)[0],
      dependency = relative(target).split(path.sep)[0];
    if (owner === "mcp" && !["mcp", "client", "shared"].includes(dependency))
      errors.push(
        `${relative(file)}: MCP tools must call the supported client/shared contracts, not ${dependency}`,
      );
    if (
      owner === "harness-integrations" &&
      ["server", "cli", "client", "src"].includes(dependency)
    )
      errors.push(
        `${relative(file)}: harness adapters cannot depend on ${dependency}`,
      );
    if (owner === "shared" && dependency !== "shared")
      errors.push(
        `${relative(file)}: shared contracts cannot depend on ${dependency}`,
      );
    if (
      owner === "client" &&
      ["server", "harness-integrations", "src", "cli"].includes(dependency)
    )
      errors.push(`${relative(file)}: client cannot depend on ${dependency}`);
    if (
      owner === "src" &&
      ["server", "harness-integrations", "cli", "observability"].includes(
        dependency,
      )
    )
      errors.push(`${relative(file)}: browser UI cannot import ${dependency}`);
  }
  dependencies.set(file, local);
}
const visited = new Set(),
  visiting = new Set();
function visit(file, trail = []) {
  if (visiting.has(file)) {
    errors.push(`Import cycle: ${[...trail, file].map(relative).join(" → ")}`);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const target of dependencies.get(file) || [])
    if (dependencies.has(target)) visit(target, [...trail, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of files) visit(file);
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Architecture checks passed: ${files.length} modules, valid imports, no cycles, boundaries intact.`,
  );
