import { readFile } from "node:fs/promises";
import { verifyImage } from "../shared/image.mjs";
import { modelArguments, promptBrief } from "../shared/text.mjs";
import { capture } from "../shared/process.mjs";
import { jsonLines, textSnapshots } from "../shared/stream.mjs";

export const provider = {
  id: "claude-code",
  name: "Claude Code",
  executable: process.env.WEFT_CLAUDE_BIN || "claude",
  acceptsImages: true,
  setup: "Run claude auth login",
  description: "Shape image prompts with your Claude Code sign-in.",
};

export function invocation({ job, onText }, imageBlocks = []) {
  return {
    args: [
      "-p",
      "--safe-mode",
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(onText ? ["--include-partial-messages"] : []),
      "--input-format",
      "stream-json",
      ...modelArguments(job),
      ...(job.reasoningEffort && job.reasoningEffort !== "inherit"
        ? ["--effort", job.reasoningEffort]
        : []),
    ],
    input:
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [...imageBlocks, { type: "text", text: promptBrief(job) }],
        },
      }) + "\n",
  };
}

export function stream(onText) {
  const output = textSnapshots(onText);
  return jsonLines((record) => {
    if (record.parent_tool_use_id) return;
    const event = record.type === "stream_event" && record.event;
    if (event?.type === "message_start") output.set("");
    if (
      event?.type === "content_block_delta" &&
      event.delta?.type === "text_delta"
    )
      output.append(event.delta.text);
    if (record.type === "result" && !record.is_error && !record.error)
      output.set(record.result);
  });
}

export async function imageInvocation(context) {
  const blocks = [];
  for (const file of context.imagePaths) {
    const format = await verifyImage(file);
    const bytes = await readFile(file);
    if (bytes.length > 5 * 1024 * 1024)
      throw new Error("Claude prompt references must be under 5 MB each.");
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[
          format
        ],
        data: bytes.toString("base64"),
      },
    });
  }
  return invocation(context, blocks);
}

export function parse(stdout) {
  let result;
  try {
    result = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter(
        (event) => event.type === "result" || (!event.type && event.result),
      )
      .at(-1);
    if (!result) throw new Error();
  } catch {
    throw new Error("Claude Code returned invalid final-answer JSON.");
  }
  if (result.is_error || result.error)
    throw new Error(
      String(
        result.error?.message ||
          result.result ||
          "Claude Code reported an error.",
      ).slice(0, 1200),
    );
  return result.result;
}

export async function status(provider) {
  try {
    const { stdout } = await capture(
      provider.executable,
      ["auth", "status", "--json"],
      { timeoutMs: 10000 },
    );
    const health = JSON.parse(stdout);
    return {
      ready: Boolean(health.loggedIn),
      authenticated: Boolean(health.loggedIn),
      status: health.loggedIn ? "Signed in with Claude" : provider.setup,
    };
  } catch {
    return {
      ready: false,
      authenticated: null,
      status: "CLI installed · could not verify sign-in",
    };
  }
}
