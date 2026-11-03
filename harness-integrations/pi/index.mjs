import { modelArguments, promptBrief } from "../shared/text.mjs";
import { jsonLines, textSnapshots } from "../shared/stream.mjs";

export const provider = {
  id: "pi",
  name: "Pi",
  executable: process.env.WEFT_PI_BIN || "pi",
  acceptsImages: true,
  setup: "Install Pi and sign in with pi",
  description: "Prompt generation through your local Pi coding agent.",
};

export function invocation({ job, imagePaths, onText }) {
  return {
    streaming: Boolean(onText),
    args: [
      "--print",
      "--mode",
      onText ? "json" : "text",
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      ...modelArguments(job),
      ...(job.reasoningEffort && job.reasoningEffort !== "inherit"
        ? ["--thinking", job.reasoningEffort]
        : []),
      ...imagePaths.map((file) => "@" + file),
    ],
    input: promptBrief(job),
  };
}

export function stream(onText) {
  const output = textSnapshots(onText);
  const blocks = new Map();
  let final;
  let active = false;
  const decoder = jsonLines((event) => {
    if (event.type === "message_start") {
      active = event.message?.role === "assistant";
      if (active) {
        blocks.clear();
        final = undefined;
        output.set("");
      }
    }
    if (active && event.type === "message_update") {
      const delta = event.assistantMessageEvent;
      if (delta?.type === "text_delta" || delta?.type === "text_end") {
        const index = delta.contentIndex;
        if (!Number.isInteger(index) || index < 0 || index > 2048) return;
        const value =
          delta.type === "text_end"
            ? delta.content
            : (blocks.get(index) || "") + (delta.delta || "");
        if (typeof value !== "string") return;
        blocks.set(index, value);
        output.set(
          [...blocks]
            .sort((a, b) => a[0] - b[0])
            .map(([, text]) => text)
            .join(""),
        );
      }
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      final = event.message;
      active = false;
      if (final.stopReason === "stop")
        output.set(
          (final.content || [])
            .filter((part) => part.type === "text")
            .map((part) => part.text || "")
            .join(""),
        );
    }
  });
  return {
    ...decoder,
    get value() {
      if (!final || final.stopReason !== "stop")
        throw new Error(
          "Pi did not complete its streaming response successfully.",
        );
      return output.value;
    },
  };
}

export function parse(stdout, invocation) {
  if (!invocation?.streaming) return stdout;
  const decoder = stream();
  decoder.write(stdout);
  decoder.end();
  return decoder.value;
}
