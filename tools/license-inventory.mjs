import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8"),
);
const checkedFiles = new Map([
  ["busboy@1.6.0", "LICENSE"],
  ["streamsearch@1.1.0", "LICENSE"],
]);
const packages = [];
for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory) continue;
  const name = directory.split("node_modules/").at(-1);
  let license = entry.license || null,
    evidence = "lockfile";
  const known = checkedFiles.get(`${name}@${entry.version}`);
  if (!license && known) {
    const text = await readFile(path.join(root, directory, known), "utf8");
    if (
      text.includes("Copyright Brian White.") &&
      text.includes(
        "Permission is hereby granted, free of charge, to any person obtaining a copy",
      ) &&
      text.includes('THE SOFTWARE IS PROVIDED "AS IS"')
    ) {
      license = "MIT";
      evidence = `${directory}/${known}`;
    }
  }
  packages.push({
    name,
    version: entry.version,
    license,
    evidence,
    development: entry.dev === true,
    optional: entry.optional === true,
  });
}
packages.sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const missing = packages.filter((entry) => !entry.license);
const report = {
  scope:
    "Lockfile metadata and two reviewed missing-license files; not a legal compatibility determination or a compiled-bundle notice generator",
  packages,
  missing,
};
if (process.argv.includes("--json"))
  console.log(JSON.stringify(report, null, 2));
else {
  const counts = new Map();
  for (const entry of packages)
    counts.set(
      entry.license || "UNKNOWN",
      (counts.get(entry.license || "UNKNOWN") || 0) + 1,
    );
  console.log(
    `License metadata inventoried for ${packages.length} locked packages. ${missing.length} unresolved.`,
  );
  console.log(
    [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([license, count]) => `${license}: ${count}`)
      .join("\n"),
  );
  console.log(report.scope);
}
if (missing.length) process.exitCode = 1;
