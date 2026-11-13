import { readFile, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { codexStatus } from "./codex/status.mjs";
import { CodexConnection } from "./codex/connection.mjs";
import { codexTextModels } from "./codex/models.mjs";
import { claudeTextModels } from "./claude-code/models.mjs";
import { runCodexImage } from "./codex/image.mjs";
import { verifyImage } from "./shared/image.mjs";
import { finalizeImage } from "./shared/image-output.mjs";
import {
  codexImageDetail,
  imageModelDetails,
  validateImageSettings,
} from "../shared/image-generation.mjs";
import { runCommand } from "./command/index.mjs";
import { randomUUID } from "node:crypto";
import { harnesses, runHarness, harnessStatus } from "./harnesses.mjs";
import { apiJson } from "./openai-compatible/client.mjs";
import { runTextApi } from "./openai-compatible/text.mjs";
import { redactPreview, redactTextResult } from "./shared/preview.mjs";
import { executableExists } from "./shared/process.mjs";
import { ConnectionStore } from "./openai-compatible/connections.mjs";
import { connectionSchema } from "../shared/provider-connections.mjs";
import { runImageApi } from "./openai-compatible/image.mjs";
import { ProviderRequirementsError } from "../shared/provider-errors.mjs";
import { reasoningLevels } from "../shared/reasoning.mjs";
import { traced } from "../observability/tracing.mjs";
import { GeminiVideo, inspectVideo } from "./gemini-video/index.mjs";
import { GrokMedia } from "./grok/index.mjs";
import { FalMedia } from "./fal/index.mjs";
import {
  falModels,
  FAL_IMAGE_RATIOS,
  FAL_VIDEO_RATIOS,
} from "../shared/fal.mjs";
import { RuntimeManager } from "./local-runtime/index.mjs";
import { OllamaText } from "./ollama/index.mjs";
import { ComfyMedia } from "./comfyui/index.mjs";
import {
  grokModels,
  GROK_IMAGE_RATIOS,
  GROK_VIDEO_RATIOS,
} from "../shared/grok.mjs";
import {
  prepareRegionInputs,
  compositeRegionFile,
} from "../image-tools/region-edit.mjs";

const sizes = { "1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536" };
const common = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().min(1).max(100),
  description: z.string().max(600).default(""),
  models: z.array(z.string().min(1).max(120)).min(1).max(100),
  timeoutMs: z.number().int().min(100).max(3600000).default(1200000),
};
const providerSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("command"),
    command: z.array(z.string().min(1)).min(1).max(100),
    seeded: z.boolean().default(false),
    requiresImage: z.boolean().default(false),
    outputKind: z.enum(["image", "video"]).default("image"),
  }),
  z.object({
    ...common,
    kind: z.literal("image-api"),
    baseUrl: z
      .url()
      .refine(
        (s) => ["http:", "https:"].includes(new URL(s).protocol),
        "Use HTTP or HTTPS",
      ),
    apiKeyEnv: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .optional(),
    sizes: z.record(z.string(), z.string()).default(sizes),
    parameters: z.record(z.string(), z.json()).default({}),
    seedParameter: z.string().min(1).max(100).optional(),
  }),
]);
const details = (p) =>
  (
    p.modelDetails ||
    p.models.map((id) => ({
      id,
      capabilities: p.capabilities || [p.outputKind || "image"],
      acceptsImages: p.acceptsImages !== false,
    }))
  ).map((model) => ({
    ...(["image-api", "compatible"].includes(p.kind)
      ? imageModelDetails(model.id)
      : {}),
    ...model,
  }));
const modelFor = (p, job) =>
  details(p).find(
    (m) => m.id === job.model && m.capabilities.includes(job.kind || "image"),
  );
const scrub = (value, token) =>
  token ? String(value).replaceAll(token, "[redacted]") : value;
export class ProviderRegistry {
  constructor({
    root,
    dataRoot,
    definitions,
    codexHealth,
    claudeModels = claudeTextModels,
    codex,
    video,
    grok,
    fal,
    runtimes,
    ollama,
    comfy,
  } = {}) {
    this.root = root;
    this.claudeModels = claudeModels;
    this.file = path.join(dataRoot, "providers.json");
    this.custom = definitions;
    this.connections = new ConnectionStore(dataRoot);
    this.video = video || new GeminiVideo({ dataRoot });
    this.grok = grok || new GrokMedia({ dataRoot });
    this.fal = fal || new FalMedia({ dataRoot });
    this.runtimes = runtimes || new RuntimeManager({ dataRoot });
    this.ollama = ollama || new OllamaText({ runtimes: this.runtimes });
    this.comfy = comfy || new ComfyMedia({ dataRoot, runtimes: this.runtimes });
    this.managed = [];
    this.codex = codex || new CodexConnection({ dataRoot });
    this.codexHealth =
      codexHealth || (async () => codexStatus(await this.codex.execution()));
    this.definitions = new Map();
    this.statusCache = new Map();
  }
  async reload() {
    let custom = this.custom;
    if (!custom) {
      try {
        const config = JSON.parse(await readFile(this.file, "utf8"));
        custom = z
          .object({ providers: z.array(providerSchema).max(50) })
          .parse(config).providers;
      } catch (error) {
        if (error.code === "ENOENT") custom = [];
        else throw new Error(`Invalid providers.json: ${error.message}`);
      }
    }
    const local = providerSchema.parse({
      id: "local-color",
      name: "Local color lab",
      description:
        "Fast, deterministic image processing on this computer. A working example of the command-harness protocol; no AI inference.",
      kind: "command",
      models: ["color-study", "duotone", "monochrome"],
      command: [
        process.execPath,
        path.join(this.root, "examples/harnesses/local-color.mjs"),
      ],
      seeded: true,
      requiresImage: true,
    });
    const definitions = new Map([
      [
        "codex",
        {
          id: "codex",
          name: "Codex Image",
          kind: "codex",
          description:
            "Native image generation through your signed-in Codex CLI.",
          models: ["native"],
          modelDetails: [codexImageDetail],
          seeded: false,
        },
      ],
      ["local-color", local],
      [
        "gemini-video",
        {
          id: "gemini-video",
          name: "Gemini Video",
          kind: "gemini-video",
          description:
            "Native video generation through the Gemini API. Supports API keys or Google OAuth; API project billing is separate from Flow credits.",
          models: ["gemini-omni-1.1-flash"],
          capabilities: ["video"],
          modelDetails: [
            {
              id: "gemini-omni-1.1-flash",
              capabilities: ["video"],
              acceptsImages: true,
            },
          ],
          ratios: ["16:9", "9:16"],
          seeded: false,
        },
      ],
      [
        "local-recolor",
        providerSchema.parse({
          id: "local-recolor",
          name: "Local region recolor",
          description:
            "Recolor selected image regions locally while preserving shading, texture and surrounding pixels. No model download or account required.",
          kind: "command",
          models: ["recolor"],
          command: [
            process.execPath,
            path.join(this.root, "examples/harnesses/recolor.mjs"),
          ],
          seeded: true,
          requiresImage: true,
        }),
      ],
    ]);
    for (const kind of ["image", "video"]) {
      const modelDetails = grokModels.filter((model) =>
        model.capabilities.includes(kind),
      );
      definitions.set(`grok-${kind}`, {
        id: `grok-${kind}`,
        name: kind === "image" ? "Grok Image" : "Grok Video",
        kind: "grok",
        description:
          "Native xAI Imagine API. Configure an xAI API key; consumer subscription login does not configure API access.",
        models: modelDetails.map((model) => model.id),
        modelDetails,
        ratios: kind === "image" ? GROK_IMAGE_RATIOS : GROK_VIDEO_RATIOS,
        capabilities: [kind],
        seeded: false,
      });
    }
    for (const kind of ["image", "video"]) {
      const modelDetails = falModels.filter((model) =>
        model.capabilities.includes(kind),
      );
      definitions.set(`fal-${kind}`, {
        id: `fal-${kind}`,
        name: kind === "image" ? "fal Image" : "fal Video",
        kind: "fal",
        description:
          "fal’s native queue API. Seedance video, Seedream images and FLUX. Private fal API key; pay per generation.",
        models: modelDetails.map((model) => model.id),
        modelDetails,
        capabilities: [kind],
        ratios: kind === "image" ? FAL_IMAGE_RATIOS : FAL_VIDEO_RATIOS,
        seeded: false,
      });
    }
    const localTextModels = await this.ollama.catalog();
    definitions.set("ollama", {
      id: "ollama",
      name: "Ollama",
      kind: "ollama",
      description:
        "Downloaded local text and vision models for prompts and the assistant. No API key or subscription.",
      models: localTextModels.map((model) => model.id),
      modelDetails: localTextModels,
      capabilities: ["text"],
      local: true,
      seeded: false,
    });
    for (const kind of ["image", "video"]) {
      const modelDetails = await this.comfy.catalog(kind);
      definitions.set(`comfyui-${kind}`, {
        id: `comfyui-${kind}`,
        name: `ComfyUI ${kind === "image" ? "Image" : "Video"}`,
        kind: "comfyui",
        local: true,
        description:
          "Local generation through your saved ComfyUI recipe and downloaded weights. GPU executions run one at a time.",
        models: modelDetails.map((model) => model.id),
        modelDetails,
        capabilities: [kind],
        seeded: false,
      });
    }
    for (const p of harnesses) definitions.set(p.id, p);
    const codexExecution = await this.codex.execution();
    const codexModels = await codexTextModels(codexExecution.env.CODEX_HOME);
    if (codexModels.length) {
      const codex = definitions.get("codex-text");
      const modelDetails = [
        { id: "default", capabilities: ["text"], acceptsImages: true },
        ...codexModels,
      ];
      definitions.set(codex.id, {
        ...codex,
        models: modelDetails.map((model) => model.id),
        modelDetails,
      });
    }
    const claude = definitions.get("claude-code");
    if (claude) {
      const discovered = await this.claudeModels({
        executable: claude.executable,
      });
      const modelDetails = discovered.length
        ? discovered
        : [{ id: "default", capabilities: ["text"], acceptsImages: true }];
      if (!modelDetails.some((model) => model.id === "default"))
        modelDetails.unshift({
          id: "default",
          capabilities: ["text"],
          acceptsImages: true,
        });
      definitions.set(claude.id, {
        ...claude,
        models: modelDetails.map((model) => model.id),
        modelDetails,
      });
    }
    for (const raw of custom) {
      const p = providerSchema.parse(raw);
      if (definitions.has(p.id))
        throw new Error(`Duplicate or reserved provider ID: ${p.id}`);
      definitions.set(p.id, p);
    }
    this.managed = await this.connections.load();
    for (const p of this.managed) {
      if (definitions.has(p.id)) throw new Error("Reserved connection ID.");
      definitions.set(p.id, {
        ...p,
        kind: "compatible",
        modelDetails: p.models,
        models: [...new Set(p.models.map((m) => m.id))],
        sizes,
        parameters: {},
        timeoutMs: 1200000,
        managed: true,
      });
    }
    this.definitions = definitions;
    this.statusCache.clear();
    return this.catalog();
  }
  get(id = "codex") {
    const p = this.definitions.get(id);
    if (!p)
      throw new Error(
        `Provider “${id}” is not configured. Reload providers after editing providers.json.`,
      );
    return p;
  }
  async status(p) {
    const cached = this.statusCache.get(p.id);
    if (cached && Date.now() - cached.at < 15000) return cached.value;
    let status;
    if (p.kind === "codex") {
      const h = await this.codexHealth();
      status = {
        ready: h.ready,
        installed: Boolean(h.installed),
        authenticated: Boolean(h.signedIn),
        authMethod: h.authMethod,
        status:
          h.auth || (h.ready ? "Signed in with ChatGPT" : "Sign in to Codex"),
        version: h.version,
      };
    } else if (p.kind === "gemini-video") {
      const connection = await this.video.status();
      status = { ...connection, status: connection.reason };
    } else if (p.kind === "grok") {
      const connection = await this.grok.status();
      status = { ...connection, status: connection.reason };
    } else if (p.kind === "fal") {
      const connection = await this.fal.status();
      status = { ...connection, status: connection.reason };
    } else if (p.kind === "ollama") {
      status = await this.ollama.status();
    } else if (p.kind === "comfyui") {
      status = await this.comfy.status(p.capabilities[0]);
    } else if (p.kind === "harness") {
      status = await harnessStatus(p, { codexHealth: this.codexHealth });
    } else if (p.kind === "command") {
      const ready = await executableExists(p.command[0]);
      status = {
        ready,
        status: ready ? "Local command ready" : "Executable not found",
      };
    } else {
      const ready = !p.apiKeyEnv || Boolean(process.env[p.apiKeyEnv]);
      status = {
        ready,
        status: ready
          ? "Configured · credentials not yet verified"
          : `Set ${p.apiKeyEnv} in the server environment`,
      };
    }
    this.statusCache.set(p.id, { at: Date.now(), value: status });
    return status;
  }
  async catalog() {
    return Promise.all(
      [...this.definitions.values()].map(async (p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        description: p.description,
        models: p.models,
        modelDetails: details(p),
        capabilities: p.capabilities || [
          ...new Set(details(p).flatMap((m) => m.capabilities)),
        ],
        ...(p.local && { local: true, setupPath: "/settings/local-models" }),
        ...(p.managed
          ? { managed: true, baseUrl: p.baseUrl, hasApiKey: Boolean(p.apiKey) }
          : {}),
        seeded: p.seeded || Boolean(p.seedParameter),
        requiresImage: p.requiresImage || false,
        ratios:
          p.ratios ||
          (["image-api", "compatible"].includes(p.kind)
            ? Object.keys(p.sizes)
            : ["1:1", "2:1", "3:2", "2:3", "16:9", "9:16"]),
        ...(await this.status(p)),
      })),
    );
  }
  async preflight(jobs) {
    const blockers = [];
    for (const id of new Set(jobs.map((j) => j.providerId || "codex"))) {
      const p = this.get(id),
        status = await this.status(p);
      const resumingComfy =
        p.kind === "comfyui" &&
        jobs
          .filter((job) => job.providerId === id)
          .every(
            (job) =>
              job.providerOperation?.providerId === id &&
              job.providerOperation.state === "accepted",
          );
      if (
        !status.ready &&
        !(resumingComfy && (await this.runtimes.status("comfyui")).running)
      )
        blockers.push({
          providerId: p.id,
          name: p.name,
          message:
            status.status || status.reason || "Provider setup is required.",
          nodeIds: [
            ...new Set(
              jobs
                .filter((job) => (job.providerId || "codex") === id)
                .map((job) => job.nodeId),
            ),
          ],
          setupPath: p.local ? "/settings/local-models" : "/settings/providers",
        });
    }
    if (blockers.length) throw new ProviderRequirementsError(blockers);
    for (const job of jobs) {
      if (
        job.images.some(
          (ref) =>
            /\.(gif|svg)$/i.test(ref.asset || "") ||
            ["gif", "svg"].includes(
              jobs.find((parent) => parent.id === ref.jobId)?.image
                ?.outputFormat,
            ),
        )
      )
        throw new Error(
          "GIF and SVG outputs cannot be used as raster references or SAM edit targets. Use a still PNG, JPEG or WebP reference.",
        );
      const p = this.get(job.providerId);
      job.kind ||= "image";
      job.model ||= details(p).find((m) =>
        m.capabilities.includes(job.kind),
      )?.id;
      validateImageSettings({ ...p, modelDetails: details(p) }, job);
      const frozenComfy =
        p.kind === "comfyui" &&
        job.providerOperation?.providerId === p.id &&
        job.providerOperation.state === "accepted";
      if (
        !modelFor(p, job) &&
        !frozenComfy &&
        !(p.kind === "harness" && job.kind === "text")
      )
        throw new Error(
          `Model “${job.model}” is not configured for ${p.name}.`,
        );
      if (
        !frozenComfy &&
        job.images.length &&
        (modelFor(p, job) || details(p)[0])?.acceptsImages === false
      )
        throw new Error(
          `${p.name} does not accept image inputs for this model.`,
        );
      if (p.requiresImage && !job.images.length)
        throw new Error(`Connect a seed image to ${p.name}.`);
      if (
        job.kind === "text" &&
        job.reasoningEffort &&
        job.reasoningEffort !== "inherit" &&
        !reasoningLevels(
          { id: p.id, modelDetails: details(p) },
          job.model,
        ).includes(job.reasoningEffort)
      )
        throw new Error(
          `${p.name} does not support the selected thinking level. Choose Auto or a supported model level.`,
        );
      if (p.kind === "grok") this.grok.preflight(job);
      if (p.kind === "fal") this.fal.preflight(job);
      if (p.kind === "ollama") await this.ollama.preflight(job);
      if (p.kind === "comfyui") await this.comfy.preflight(job);
      if (p.id === "local-recolor" && job.edit?.mode !== "recolor")
        throw new Error(
          "Local recolor requires an image editor recolor request with a region mask.",
        );
      if (
        p.kind === "gemini-video" &&
        (job.video?.durationSeconds !== undefined ||
          job.video?.mode !== undefined ||
          !p.ratios.includes(job.ratio) ||
          !["360p", "720p", "1080p", "4k"].includes(
            job.video?.resolution || "720p",
          ))
      )
        throw new Error(
          "Choose a supported Gemini video ratio and resolution; duration and reference-mode overrides are not supported.",
        );
      if (
        job.kind === "image" &&
        ["image-api", "compatible"].includes(p.kind) &&
        !p.sizes[job.ratio]
      )
        throw new Error(`${p.name} does not support the ${job.ratio} ratio.`);
    }
  }
  mutateConnection(operation) {
    return this.connections.mutate(operation);
  }
  saveConnection(id, input) {
    const edit = connectionSchema.parse(input);
    return this.mutateConnection(async () => {
      const old = id && this.managed.find((p) => p.id === id);
      if (id && !old) throw new Error("Compatible connection not found.");
      if (
        old?.apiKey &&
        old.baseUrl !== edit.baseUrl &&
        edit.apiKey.action === "keep"
      )
        throw new Error(
          "Enter a new API key or remove it when changing the base URL.",
        );
      const apiKey =
        edit.apiKey.action === "replace"
          ? edit.apiKey.value
          : edit.apiKey.action === "clear"
            ? undefined
            : old?.apiKey;
      const entry = {
        id: old?.id || `api-${randomUUID()}`,
        name: edit.name,
        description: "Your OpenAI-compatible endpoint",
        baseUrl: edit.baseUrl,
        models: edit.models,
        apiKey,
      };
      const next = [...this.managed.filter((p) => p.id !== entry.id), entry];
      await this.writeConnections(next);
      return this.reload();
    });
  }
  removeConnection(id) {
    return this.mutateConnection(async () => {
      if (!this.managed.some((p) => p.id === id))
        throw new Error("Compatible connection not found.");
      await this.writeConnections(this.managed.filter((p) => p.id !== id));
      return this.reload();
    });
  }
  async writeConnections(entries) {
    return this.connections.write(entries);
  }
  async testConnection(id) {
    const p = this.get(id);
    if (!p.managed) throw new Error("Choose a compatible connection.");
    try {
      const data = await apiJson({ ...p, timeoutMs: 15000 }, "/models");
      return {
        message:
          "Endpoint reachable · model listing verified. Inference support depends on your configured models.",
        models: (data.data || [])
          .map((m) => m.id)
          .filter((id) => typeof id === "string")
          .map((id) => scrub(id, p.apiKey))
          .slice(0, 200),
      };
    } catch (e) {
      throw new Error(scrub(e.message, p.apiKey));
    }
  }
  executionLane(job) {
    return ["ollama", "comfyui"].includes(
      this.definitions.get(job.providerId)?.kind,
    )
      ? "local-models"
      : undefined;
  }
  async run(context) {
    const p = this.get(context.job.providerId);
    await traced("provider.preflight", { "flow.provider_id": p.id }, () =>
      this.preflight([context.job]),
    );
    const token = p.apiKey || (p.apiKeyEnv && process.env[p.apiKeyEnv]);
    const cleanContext = {
      ...context,
      ...(["codex", "codex-text"].includes(p.id) && {
        codexExecution: await this.codex.execution(),
      }),
      onProgress: (message) => context.onProgress?.(scrub(message, token)),
      onText: context.preview
        ? (raw) => {
            context.onTiming?.("firstOutput");
            if (typeof raw !== "string" || Buffer.byteLength(raw) > 128 * 1024)
              throw new Error("Provider streaming text exceeded 128 KB.");
            const projected = context.preview.project(raw);
            if (typeof projected === "string")
              context.preview.update(redactPreview(projected, token));
          }
        : undefined,
    };
    try {
      if (context.job.kind === "video") {
        let result;
        if (p.kind === "gemini-video")
          result = await this.video.run(cleanContext);
        else if (p.kind === "grok") result = await this.grok.run(cleanContext);
        else if (p.kind === "fal") result = await this.fal.run(cleanContext);
        else if (p.kind === "comfyui")
          result = await this.comfy.run(cleanContext);
        else if (p.kind === "command" && p.outputKind === "video") {
          const file = await runCommand(p, cleanContext);
          const metadata = inspectVideo(await readFile(file));
          result = { kind: "video", path: file, metadata };
        } else throw new Error("This provider does not generate video.");
        return {
          ...result,
          metadata: {
            ...result.metadata,
            providerId: p.id,
            providerName: p.name,
            model: context.job.model,
            mimeType: "video/mp4",
          },
        };
      }
      if (context.job.kind === "text") {
        const nativeResult =
          p.kind === "ollama" ? await this.ollama.run(cleanContext) : null;
        const raw = nativeResult
          ? nativeResult.text
          : p.kind === "harness"
            ? await runHarness(p, cleanContext)
            : await runTextApi(p, cleanContext);
        if (
          typeof raw !== "string" ||
          !raw.trim() ||
          Buffer.byteLength(raw) > 128 * 1024
        )
          throw new Error(
            "Provider must return nonempty prompt text under 128 KB.",
          );
        return {
          kind: "text",
          text: redactTextResult(raw.trim(), token),
          metadata: {
            ...(nativeResult?.metadata || {}),
            ...(cleanContext.codexExecution && {
              authMode: cleanContext.codexExecution.mode,
            }),
            providerId: p.id,
            providerName: p.name,
            model: context.job.model,
          },
        };
      }
      const regionInputs = await prepareRegionInputs(
        context.job,
        context.imagePaths,
      );
      const nativeResult =
        p.kind === "fal"
          ? await this.fal.run(cleanContext)
          : p.kind === "grok"
            ? await this.grok.run(cleanContext)
            : p.kind === "comfyui"
              ? await this.comfy.run(cleanContext)
              : ["image-api", "compatible"].includes(p.kind)
                ? await runImageApi(p, cleanContext)
                : null;
      const file = nativeResult
        ? nativeResult.path
        : p.kind === "codex"
          ? await runCodexImage(cleanContext)
          : await runCommand(p, cleanContext);
      if (!regionInputs) {
        const result = await finalizeImage(
          file,
          context.directory,
          context.job,
          {
            spriteSheet:
              p.kind === "codex" && context.job.image?.outputFormat === "gif",
          },
        );
        return {
          kind: "image",
          ...result,
          metadata: {
            ...(nativeResult?.metadata || {}),
            ...result.metadata,
            ...(cleanContext.codexExecution && {
              authMode: cleanContext.codexExecution.mode,
            }),
            providerId: p.id,
            providerName: p.name,
            model: context.job.model,
            seedMode:
              nativeResult?.metadata?.seedMode ||
              (["local-color", "local-recolor"].includes(p.id)
                ? "deterministic"
                : p.seeded || p.seedParameter
                  ? "parameter"
                  : "variation-label"),
          },
        };
      }
      const originalFormat = await verifyImage(file);
      const originalFile = `original-attempt-${context.job.attempts || 1}.${originalFormat}`;
      await copyFile(file, path.join(context.directory, originalFile));
      const output = path.join(context.directory, "output.png"),
        temp = path.join(context.directory, "normalized.png");
      context.onProgress?.(
        "Preserving original pixels outside the selected regions…",
      );
      const metadata = await compositeRegionFile(regionInputs, file, temp);
      await rename(temp, output);
      return {
        kind: "image",
        path: output,
        metadata: {
          ...(nativeResult?.metadata || {}),
          originalFile,
          ...(cleanContext.codexExecution && {
            authMode: cleanContext.codexExecution.mode,
          }),
          width: metadata.width,
          height: metadata.height,
          providerId: p.id,
          providerName: p.name,
          model: context.job.model,
          regionComposite: true,
          outsidePixelsPreserved: true,
          seedMode:
            nativeResult?.metadata?.seedMode ||
            (["local-color", "local-recolor"].includes(p.id)
              ? "deterministic"
              : p.seeded || p.seedParameter
                ? "parameter"
                : "variation-label"),
        },
      };
    } catch (e) {
      throw new Error(scrub(e.message, token));
    }
  }
}
