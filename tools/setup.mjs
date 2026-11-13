import { manageSkills } from "../cli/skills.mjs";
import { installCli } from "../cli/install.mjs";
import { parseArgs } from "node:util";

let values = {};
try {
  ({ values } = parseArgs({
    options: { help: { type: "boolean" }, json: { type: "boolean" } },
  }));
  if (values.help) {
    const help = {
      command: "node tools/setup.mjs",
      usage: "node tools/setup.mjs [--json]",
      effect: "install-user-cli-and-skills",
      note: "Build once with npm run setup. This command installs the user CLI and managed agent skills without configuring providers or downloading models.",
    };
    console.log(
      values.json ? JSON.stringify(help) : `${help.usage}\n${help.note}`,
    );
    process.exit(0);
  }
  const cli = await installCli();
  const skills = await manageSkills({ action: "install" });
  console.log(JSON.stringify({ cli, skills }, null, 2));
  if (!cli.onPath)
    console.error(
      'Use the absolute command path above, or add its directory to PATH. Default: export PATH="$HOME/.local/bin:$PATH"',
    );
} catch (error) {
  console.error(
    values.json || process.argv.includes("--json")
      ? JSON.stringify({
          error: { code: error.code || "SETUP_FAILED", message: error.message },
        })
      : error.message,
  );
  process.exitCode = 1;
}
