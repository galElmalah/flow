import { readFile } from "node:fs/promises";
import { ollamaReasoning, ollamaThink } from "../../shared/reasoning.mjs";
import { verifyImage } from "../shared/image.mjs";

const MAX_RESPONSE = 2 * 1024 * 1024;
const isRemote = (model, info = {}) =>
  /(?:^|[:/-])cloud(?:$|[:/-])/i.test(model) ||
  Boolean(info.remote_model || info.remote_host || info.details?.remote_model);

async function response(
  baseUrl,
  route,
  { body, signal, timeoutMs = 10000 } = {},
) {
  const result = await fetch(baseUrl + route, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body && JSON.stringify(body),
    signal: AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(timeoutMs),
    ]),
    redirect: "error",
  });
  if (!result.ok) {
    await result.body?.cancel();
    throw new Error(
      `Ollama returned HTTP ${result.status}. Check Settings → Local models.`,
    );
  }
  return result;
}
async function json(baseUrl, route, options) {
  const result = await response(baseUrl, route, options);
  const chunks = [];
  let length = 0;
  for await (const chunk of result.body) {
    length += chunk.length;
    if (length > MAX_RESPONSE)
      throw new Error("Ollama response exceeded 2 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export class OllamaText {
  constructor({ runtimes } = {}) {
    this.runtimes = runtimes;
  }
  async config() {
    return this.runtimes.getConfig("ollama");
  }
  async inspect(model, { signal } = {}) {
    if (isRemote(model))
      throw new Error(
        "Choose a downloaded local Ollama model, not a cloud model.",
      );
    const { baseUrl } = await this.config();
    const info = await json(baseUrl, "/api/show", { body: { model }, signal });
    if (isRemote(model, info))
      throw new Error(
        "This Ollama model runs remotely. Download a local model instead.",
      );
    if (!info.capabilities?.includes("completion"))
      throw new Error(
        `Ollama model ${model} does not advertise text generation.`,
      );
    return info;
  }
  async catalog() {
    try {
      const { baseUrl } = await this.config();
      const data = await json(baseUrl, "/api/tags", { timeoutMs: 2500 });
      const models = (data.models || [])
        .filter(
          (m) =>
            typeof m.name === "string" &&
            m.name.length <= 120 &&
            !isRemote(m.name, m),
        )
        .slice(0, 100);
      const entries = [];
      for (let start = 0; start < models.length; start += 8) {
        const batch = await Promise.allSettled(
          models.slice(start, start + 8).map(async (model) => {
            const info = await this.inspect(model.name);
            return {
              id: model.name,
              capabilities: ["text"],
              acceptsImages: info.capabilities.includes("vision"),
              modelDigest: model.digest,
              sizeBytes: model.size,
              local: true,
              reasoning: ollamaReasoning(info),
            };
          }),
        );
        entries.push(
          ...batch
            .filter((entry) => entry.status === "fulfilled")
            .map((entry) => entry.value),
        );
      }
      return entries;
    } catch {
      return [];
    }
  }
  async status() {
    const runtime = await this.runtimes.status("ollama");
    return {
      ready: runtime.running && (await this.catalog()).length > 0,
      installed: runtime.installed,
      authenticated: null,
      local: true,
      status: !runtime.running
        ? "Start Ollama in Settings → Local models."
        : "Local Ollama running · choose a downloaded text model.",
    };
  }
  async preflight(job) {
    const info = await this.inspect(job.model);
    ollamaThink(info, job.reasoningEffort);
    if (job.kind !== "text")
      throw new Error(
        "Ollama generates text and scene prompts, not images or video. Use ComfyUI for local media.",
      );
    if (job.images?.length && !info.capabilities.includes("vision"))
      throw new Error(
        `Ollama model ${job.model} has no vision input. Choose a vision model or remove image references.`,
      );
    return info;
  }
  async run({ job, imagePaths = [], signal, onText, onProgress }) {
    const info = await this.preflight(job);
    const thinking = ollamaThink(info, job.reasoningEffort);
    const { baseUrl } = await this.config();
    const inventory = await json(baseUrl, "/api/tags", { signal });
    const observed = inventory.models?.find(
      (model) => model.name === job.model,
    );
    const images = [];
    for (const file of imagePaths) {
      await verifyImage(file);
      const buffer = await readFile(file);
      if (buffer.length > 32 * 1024 * 1024)
        throw new Error("Ollama image input exceeded 32 MB.");
      images.push(buffer.toString("base64"));
    }
    onProgress?.(`Loading ${job.model} locally…`);
    const result = await response(baseUrl, "/api/chat", {
      body: {
        model: job.model,
        messages: [
          {
            role: "user",
            content: job.prompt,
            ...(images.length ? { images } : {}),
          },
        ],
        stream: true,
        ...(thinking !== undefined && { think: thinking }),
        options: { seed: job.seed ?? 0, num_predict: 8192 },
      },
      signal,
      timeoutMs: 1200000,
    });
    const decoder = new TextDecoder();
    let pending = "",
      text = "",
      length = 0,
      final;
    let thinkingReported = false;
    const consume = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error("Ollama returned invalid streaming JSON.");
      }
      if (event.error)
        throw new Error(`Ollama: ${String(event.error).slice(0, 1000)}`);
      if (final) throw new Error("Ollama sent data after completion.");
      if (event.message?.thinking && !thinkingReported) {
        thinkingReported = true;
        onProgress?.(`${job.model} is thinking locally…`);
      }
      if (typeof event.message?.content === "string") {
        text += event.message.content;
        if (Buffer.byteLength(text) > 128 * 1024)
          throw new Error("Ollama answer exceeded 128 KB.");
        if (!signal?.aborted) onText?.(text);
      }
      if (event.done === true) {
        if (event.done_reason && event.done_reason !== "stop")
          throw new Error(
            `Ollama answer did not complete (${event.done_reason}).`,
          );
        final = event;
      }
    };
    for await (const chunk of result.body) {
      length += chunk.length;
      if (length > MAX_RESPONSE)
        throw new Error("Ollama stream exceeded 2 MB.");
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) consume(line);
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
    if (!final || !text.trim())
      throw new Error("Ollama stream ended before a complete answer arrived.");
    const facts = (names) =>
      Object.fromEntries(
        names
          .filter((name) => Number.isFinite(final[name]) && final[name] >= 0)
          .map((name) => [name, final[name]]),
      );
    return {
      kind: "text",
      text: text.trim(),
      metadata: {
        local: true,
        runtime: "ollama",
        actualModel: final.model,
        modelDigestObserved: observed?.digest || null,
        modelSizeBytesObserved: observed?.size || null,
        seedMode: "parameter",
        effectiveSettings: {
          seed: job.seed ?? 0,
          numPredict: 8192,
          thinking: thinking ?? "model-default",
          local: true,
          endpoint: baseUrl,
          modelDigestObserved: observed?.digest || null,
          modelSizeBytesObserved: observed?.size || null,
        },
        usage: facts(["prompt_eval_count", "eval_count"]),
        timingsNanoseconds: facts([
          "total_duration",
          "load_duration",
          "prompt_eval_duration",
          "eval_duration",
        ]),
      },
    };
  }
}
