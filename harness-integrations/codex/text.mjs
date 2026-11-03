import { codexBin, codexStatus } from "./status.mjs";

export const provider = {
  id: "codex-text",
  name: "Codex",
  executable: codexBin,
  acceptsImages: true,
  setup: "Run codex login",
  description: "Write and refine prompts using your Codex sign-in.",
};

export { invocation, runCodexText as run } from "./text-stream.mjs";

export async function status(_provider, { codexHealth = codexStatus } = {}) {
  const health = await codexHealth();
  return {
    ready: health.signedIn,
    authenticated: Boolean(health.signedIn),
    authMethod: health.authMethod,
    status:
      health.auth ||
      (health.signedIn ? "Signed in with ChatGPT" : "Sign in to Codex"),
  };
}
