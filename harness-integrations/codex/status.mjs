import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export const codexBin = process.env.FLOW_CODEX_BIN || "codex";
export async function codexStatus({
  env = process.env,
  args = [],
  executable = codexBin,
} = {}) {
  try {
    const [version, auth, features] = await Promise.all([
      execFileAsync(executable, ["--version"], { timeout: 10000, env }),
      execFileAsync(executable, [...args, "login", "status"], {
        timeout: 10000,
        env,
      }).catch((e) => ({ stdout: "", stderr: e.stderr || e.message })),
      execFileAsync(executable, [...args, "features", "list"], {
        timeout: 10000,
        env,
      }),
    ]);
    const output = auth.stdout + auth.stderr;
    const authMethod = /Logged in using ChatGPT/.test(output)
      ? "chatgpt"
      : /Logged in using (?:an? )?API key/i.test(output)
        ? "api-key"
        : null;
    const signedIn = Boolean(authMethod);
    const imageGeneration = /^image_generation\s+\S+\s+true$/m.test(
      features.stdout,
    );
    return {
      installed: true,
      signedIn,
      authMethod,
      imageGeneration,
      version: version.stdout.trim(),
      auth:
        authMethod === "chatgpt"
          ? "ChatGPT subscription"
          : authMethod === "api-key"
            ? "API key · API billing"
            : "Sign in to Codex",
      ready: signedIn && imageGeneration,
    };
  } catch (e) {
    return {
      installed: false,
      signedIn: false,
      imageGeneration: false,
      ready: false,
      auth: "Codex CLI not found. Set FLOW_CODEX_BIN or install Codex.",
      error: e.code,
    };
  }
}
