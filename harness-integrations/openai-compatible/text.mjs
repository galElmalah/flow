import { readFile } from "node:fs/promises";
import { verifyImage } from "../shared/image.mjs";
import { apiJson, apiStream } from "./client.mjs";
import { textSnapshots } from "../shared/stream.mjs";
export async function runTextApi(
  provider,
  { job, imagePaths, signal, onProgress, onText },
) {
  const content = [{ type: "text", text: job.prompt }];
  for (const file of imagePaths) {
    const format = await verifyImage(file);
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${{ png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[format]};base64,${(await readFile(file)).toString("base64")}`,
      },
    });
  }
  onProgress?.(`Writing with ${provider.name}…`);
  const options = {
    signal,
    body: {
      model: job.model,
      messages: [
        { role: "user", content: imagePaths.length ? content : job.prompt },
      ],
      stream: Boolean(onText),
    },
  };
  let result;
  if (onText) {
    const output = textSnapshots((text) => {
      if (!signal?.aborted) onText(text);
    });
    let finished = false;
    const response = await apiStream(provider, "/chat/completions", {
      ...options,
      onEvent(event) {
        if (event.error)
          throw new Error(
            `API streaming request failed: ${String(event.error.message || "Unknown error").slice(0, 1000)}`,
          );
        const choice =
          event.choices?.find((item) => item.index === 0) ?? event.choices?.[0];
        if (!choice || (choice.index !== undefined && choice.index !== 0))
          return;
        // Deliberately ignore reasoning_content, tools, logprobs and usage.
        if (typeof choice.delta?.content === "string")
          output.append(choice.delta.content);
        if (choice.finish_reason != null) {
          if (choice.finish_reason !== "stop")
            throw new Error(
              choice.finish_reason === "length"
                ? "API answer was truncated by the output limit."
                : choice.finish_reason === "content_filter"
                  ? "API answer was stopped by a content filter."
                  : ["tool_calls", "function_call"].includes(
                        choice.finish_reason,
                      )
                    ? "API returned a tool request instead of a completed answer."
                    : "API returned an unsupported completion reason.",
            );
          finished = true;
        }
      },
    });
    if (response.kind === "stream") {
      if (!response.done && !finished)
        throw new Error("API stream ended before the answer completed.");
      return output.value;
    }
    result = response.value;
  } else result = await apiJson(provider, "/chat/completions", options);
  const value = result.choices?.[0]?.message?.content;
  const text = Array.isArray(value)
    ? value.map((p) => p.text || "").join("")
    : value;
  if (!signal?.aborted && typeof text === "string") onText?.(text);
  return text;
}
