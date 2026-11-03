import { modelArguments, promptBrief } from "../shared/text.mjs";
import { jsonLines, textSnapshots } from "../shared/stream.mjs";

export const provider = {
  id: "gemini-cli",
  name: "Gemini CLI",
  executable: process.env.FLOW_GEMINI_BIN || "gemini",
  acceptsImages: false,
  setup:
    "Install Gemini CLI for enterprise Code Assist or API-key access. Personal Google AI plans use Antigravity CLI.",
  description:
    "Generate text with Gemini CLI's configured enterprise or API account.",
};

export function invocation({ job, onText }) {
  return {
    streaming: Boolean(onText),
    args: [
      "--prompt",
      "Return only the final answer.",
      "--output-format",
      onText ? "stream-json" : "json",
      "--approval-mode",
      "plan",
      ...modelArguments(job),
    ],
    input: promptBrief(job),
  };
}

export function stream(onText) {
  const output = textSnapshots(onText);
  let result;
  const decoder = jsonLines((event) => {
    if (event.type === "message" && event.role === "assistant") {
      if (event.delta) output.append(event.content);
      else output.set(event.content);
    }
    if (event.type === "result") result = event;
  });
  return {
    ...decoder,
    get value() {
      if (!result || result.status !== "success")
        throw new Error(
          "Gemini CLI did not complete its streaming response successfully.",
        );
      return output.value;
    },
  };
}

export function parse(stdout, invocation) {
  if (invocation?.streaming) {
    const decoder = stream();
    decoder.write(stdout);
    decoder.end();
    return decoder.value;
  }
  let result;
  try {
    result = JSON.parse(stdout);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
  } catch {
    throw new Error("Gemini CLI returned invalid final-answer JSON.");
  }
  if (result.error)
    throw new Error(
      String(result.error.message || "Gemini CLI reported an error.").slice(
        0,
        1200,
      ),
    );
  return result.response;
}
