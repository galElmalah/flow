import { installCli } from "../cli/install.mjs";
import { parseArgs } from "node:util";

let values = {};
try {
  ({ values } = parseArgs({
    options: {
      uninstall: { type: "boolean" },
      help: { type: "boolean" },
      json: { type: "boolean" },
    },
  }));
  if (values.help) {
    const help = {
      command: "node tools/install-cli.mjs",
      usage: "node tools/install-cli.mjs [--uninstall] [--json]",
      effect: "install-or-remove-user-cli",
      note: "Installs only this checkout's CLI launcher. FLOW_BIN_DIR selects another command directory. Foreign commands are preserved.",
    };
    console.log(
      values.json ? JSON.stringify(help) : `${help.usage}\n${help.note}`,
    );
    process.exit(0);
  }
  const result = await installCli({
    action: values.uninstall ? "uninstall" : "install",
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.onPath === false)
    console.error(
      'Add the command directory to PATH, or run the absolute command path above. For the default directory: export PATH="$HOME/.local/bin:$PATH"',
    );
} catch (error) {
  console.error(
    values.json || process.argv.includes("--json")
      ? JSON.stringify({
          error: {
            code: error.code || "INSTALL_FAILED",
            message: error.message,
          },
        })
      : error.message,
  );
  process.exitCode = 1;
}
