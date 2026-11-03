import { mkdir, readFile, unlink } from "node:fs/promises";
import { capture } from "./process.mjs";

export const promptBrief = (job) =>
  job.purpose === "app-assistant"
    ? `You are Flow's in-app assistant. Follow the supplied page context and JSON answer contract. Do not use tools or change files; the host validates and applies your proposed operations.\n\n${job.prompt}`
    : `You are an image prompt writer. Return only the requested final text. Do not use tools or change files.\n\n${job.prompt}`;

export const modelArguments = (job) =>
  job.model && job.model !== "default" ? ["--model", job.model] : [];

export async function runTextHarness(provider, context, adapter) {
  await mkdir(context.directory, { recursive: true });
  const invocation = await adapter.invocation(context);
  if (invocation.output)
    await unlink(invocation.output).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  context.onProgress?.(`Writing with ${provider.name}…`);
  const stream = context.onText && adapter.stream?.(context.onText);
  const { stdout } = await capture(provider.executable, invocation.args, {
    directory: context.directory,
    input: invocation.input,
    signal: context.signal,
    timeoutMs: provider.timeoutMs,
    onStdout: stream && ((text) => stream.write(text)),
  });
  stream?.end();
  const text = invocation.output
    ? readFile(invocation.output, "utf8")
    : adapter.parse(stdout, invocation);
  const result = await text;
  if (!context.signal?.aborted && typeof result === "string")
    context.onText?.(result);
  return result;
}
