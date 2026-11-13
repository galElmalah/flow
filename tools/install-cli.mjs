import { installCli } from "../cli/install.mjs";

try {
  const result = await installCli({
    action: process.argv.includes("--uninstall") ? "uninstall" : "install",
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.onPath === false)
    console.log(
      'Add the command directory to PATH, or run the absolute command path above. For the default directory: export PATH="$HOME/.local/bin:$PATH"',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
