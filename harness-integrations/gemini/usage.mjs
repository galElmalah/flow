import { executableExists } from "../shared/process.mjs";
import { provider } from "./index.mjs";

export async function readGeminiUsage({
  executable = provider.executable,
} = {}) {
  const installed = await executableExists(executable);
  return {
    status: "unavailable",
    source: "Gemini CLI",
    message: installed
      ? "Quota percentages are not exposed through a supported headless Gemini CLI command. Check /stats model in an interactive session. Personal Google AI plans now use Antigravity CLI."
      : "Gemini CLI is not installed. Personal Google AI plans now use Antigravity CLI; subscription usage is unavailable here.",
    windows: [],
  };
}
