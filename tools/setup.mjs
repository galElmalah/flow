import { manageSkills } from "../cli/skills.mjs";
import { installCli } from "../cli/install.mjs";

try {
  const cli = await installCli();
  const skills = await manageSkills({ action: "install" });
  console.log(JSON.stringify({ cli, skills }, null, 2));
  if (!cli.onPath)
    console.log(
      'Use the absolute command path above, or add its directory to PATH. Default: export PATH="$HOME/.local/bin:$PATH"',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
