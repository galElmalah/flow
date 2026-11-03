#!/usr/bin/env node
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

try {
  const here = dirname(fileURLToPath(import.meta.url));
  const installation = JSON.parse(
    await readFile(resolve(here, "../.flow-install.json"), "utf8"),
  );
  if (
    installation.managedBy !== "flow-skills-v1" ||
    typeof installation.cliPath !== "string"
  )
    throw new Error("Invalid Flow skill installation");
  await access(installation.cliPath);
  const child = spawn(
    process.execPath,
    [installation.cliPath, ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(
    `Flow skill launcher: ${error.message}. Run npm run setup from your Flow checkout to reinstall skills.`,
  );
  process.exitCode = 1;
}
