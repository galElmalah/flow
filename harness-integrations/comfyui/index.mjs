import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import {
  comfyProfileSchema,
  loopbackEndpointSchema,
} from "../../shared/local-models.mjs";
import { inspectVideo } from "../gemini-video/index.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const providerId = (kind) => `comfyui-${kind}`;
const remoteNode =
  /(?:openai|anthropic|gemini|grok|veo|fal[_ -]|replicate|stabilityapi|ideogram|recraft|runway|luma|kling|vidu|minimax|bria|api[_ -]?node)/i;
const safeId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const setBinding = (graph, binding, value) => {
  if (binding) graph[binding.nodeId].inputs[binding.input] = value;
};
function inputBindings(profile) {
  return [profile.bindings.prompt, ...(profile.bindings.images || [])];
}
async function responseBytes(response, max, signal) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > max)
    throw new Error("ComfyUI response exceeds the local size limit.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    signal?.throwIfAborted();
    size += chunk.byteLength;
    if (size > max)
      throw new Error("ComfyUI response exceeds the local size limit.");
    chunks.push(Buffer.from(chunk));
  }
  if (
    response.headers.has("content-length") &&
    !response.headers.has("content-encoding") &&
    length !== size
  )
    throw new Error(
      "ComfyUI response was truncated. Resume the saved operation.",
    );
  return Buffer.concat(chunks);
}
function fileDescriptor(value) {
  if (
    !value ||
    typeof value.filename !== "string" ||
    value.filename.length > 240 ||
    /[\\/]/.test(value.filename) ||
    [".", ".."].includes(value.filename)
  )
    throw new Error("ComfyUI returned an invalid output filename.");
  const subfolder = value.subfolder || "";
  if (
    typeof subfolder !== "string" ||
    subfolder.length > 500 ||
    subfolder.includes("\\") ||
    subfolder.startsWith("/") ||
    subfolder.split("/").some((part) => [".", ".."].includes(part))
  )
    throw new Error("ComfyUI returned an invalid output folder.");
  if (value.type && !["output", "temp", "input"].includes(value.type))
    throw new Error("ComfyUI returned an invalid output type.");
  return { filename: value.filename, subfolder, type: value.type || "output" };
}

export class ComfyMedia {
  constructor({
    dataRoot,
    runtimes,
    fetch: fetcher = globalThis.fetch,
    pollMs = 1000,
    timeoutMs = 60 * 60 * 1000,
    WebSocket: Socket = globalThis.WebSocket,
  } = {}) {
    this.file = path.join(dataRoot, "comfy-profiles.json");
    this.runtimes = runtimes;
    this.fetch = fetcher;
    this.pollMs = pollMs;
    this.timeoutMs = timeoutMs;
    this.Socket = Socket;
    this.pending = Promise.resolve();
    this.validationCache = new Map();
  }
  async profiles() {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      if (!Array.isArray(data) || data.length > 100)
        throw new Error("profiles");
      return data.map((entry) => comfyProfileSchema.parse(entry));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new Error(
        "Could not read ComfyUI profiles. Check comfy-profiles.json.",
      );
    }
  }
  mutate(operation) {
    const task = this.pending.catch(() => {}).then(operation);
    this.pending = task;
    return task;
  }
  async write(profiles) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(profiles, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  saveProfile(input) {
    const profile = comfyProfileSchema.parse(input);
    if (
      Object.values(profile.graph).some((node) =>
        remoteNode.test(node.class_type),
      )
    )
      throw new Error(
        "Cloud/API partner nodes cannot be used in a local ComfyUI profile.",
      );
    return this.mutate(async () => {
      const profiles = await this.profiles(),
        index = profiles.findIndex((entry) => entry.id === profile.id);
      if (index < 0) {
        if (profiles.length >= 100)
          throw new Error("ComfyUI supports at most 100 saved profiles.");
        profiles.push(profile);
      } else profiles[index] = profile;
      await this.write(profiles);
      return profile;
    });
  }
  removeProfile(id) {
    return this.mutate(async () => {
      const profiles = await this.profiles();
      if (!profiles.some((entry) => entry.id === id))
        throw new Error("ComfyUI profile not found.");
      await this.write(profiles.filter((entry) => entry.id !== id));
      return { removed: true, id };
    });
  }
  async endpoint() {
    return loopbackEndpointSchema
      .parse((await this.runtimes.getConfig("comfyui")).baseUrl)
      .replace(/\/$/, "");
  }
  async request(baseUrl, route, { signal, ...options } = {}) {
    let response;
    try {
      response = await this.fetch(`${baseUrl}${route}`, {
        ...options,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        "ComfyUI is offline or did not respond. Start the local runtime and retry; accepted jobs retain their receipt.",
      );
    }
    return response;
  }
  async json(baseUrl, route, options) {
    const response = await this.request(baseUrl, route, options);
    if (!response.ok)
      throw new Error(`ComfyUI request failed (HTTP ${response.status}).`);
    try {
      return JSON.parse(
        (
          await responseBytes(response, 8 * 1024 * 1024, options?.signal)
        ).toString(),
      );
    } catch (error) {
      if (error.message.startsWith("ComfyUI")) throw error;
      throw new Error("ComfyUI returned an invalid JSON response.");
    }
  }
  async inspectProfile(profile, baseUrl = null) {
    const errors = [],
      modelFacts = [];
    const endpoint = baseUrl || (await this.endpoint());
    const [info, system, runtimeStatus] = await Promise.all([
      this.json(endpoint, "/object_info"),
      this.json(endpoint, "/system_stats"),
      this.runtimes.status("comfyui"),
    ]);
    for (const [id, node] of Object.entries(profile.graph)) {
      if (remoteNode.test(node.class_type)) {
        errors.push(
          `Node ${id} (${node.class_type}) is a cloud/API node; choose a local workflow.`,
        );
        continue;
      }
      const description = info[node.class_type];
      if (!description) {
        errors.push(
          `Missing node ${node.class_type} (${id}). Install its trusted local extension or choose another profile.`,
        );
        continue;
      }
      const inputs = {
        ...description.input?.required,
        ...description.input?.optional,
      };
      for (const [name, value] of Object.entries(node.inputs)) {
        const definition = inputs[name];
        if (!definition) {
          errors.push(
            `Node ${id}.${name} is not supported by the installed ${node.class_type}.`,
          );
          continue;
        }
        if (Array.isArray(value)) {
          if (
            value.length !== 2 ||
            !profile.graph[String(value[0])] ||
            !Number.isInteger(value[1]) ||
            value[1] < 0
          )
            errors.push(`Node ${id}.${name} has an invalid node link.`);
        } else if (
          Array.isArray(definition[0]) &&
          !definition[0].includes(value) &&
          !inputBindings(profile).some(
            (binding) => binding.nodeId === id && binding.input === name,
          )
        )
          errors.push(
            `Node ${id}.${name}: “${String(value).slice(0, 120)}” is unavailable. Choose an installed model or supported value.`,
          );
      }
      for (const [name, definition] of Object.entries(
        description.input?.required || {},
      )) {
        if (
          !Object.hasOwn(node.inputs, name) &&
          !Object.hasOwn(definition?.[1] || {}, "default")
        )
          errors.push(`Node ${id} is missing required input ${name}.`);
      }
    }
    for (const model of profile.requiredModels) {
      const available = await this.json(
        endpoint,
        `/models/${encodeURIComponent(model.folder)}`,
      );
      const present =
        Array.isArray(available) && available.includes(model.filename);
      const verified =
        runtimeStatus.managed &&
        runtimeStatus.running &&
        runtimeStatus.baseUrl?.replace(/\/$/, "") === endpoint &&
        runtimeStatus.models?.find(
          (entry) =>
            entry.folder === model.folder &&
            entry.filename === model.filename &&
            entry.source === "managed" &&
            entry.hashVerified === true &&
            /^[a-fA-F0-9]{64}$/.test(entry.sha256 || ""),
        );
      modelFacts.push({
        folder: model.folder,
        filename: model.filename,
        present,
        ...(model.sha256 && { declaredSha256: model.sha256 }),
        hashVerified: Boolean(verified),
        ...(verified && {
          sha256: verified.sha256.toLowerCase(),
          sizeBytes: verified.sizeBytes,
        }),
      });
      if (
        verified &&
        model.sha256 &&
        verified.sha256.toLowerCase() !== model.sha256.toLowerCase()
      )
        errors.push(
          `Model ${model.folder}/${model.filename} does not match the profile's required SHA-256. Select matching weights.`,
        );
      if (!present)
        errors.push(
          `Missing model ${model.folder}/${model.filename}. Download it in Local models or select an installed model.`,
        );
    }
    return {
      valid: !errors.length,
      profileId: profile.id,
      errors,
      modelFacts,
      locality: "local-runtime-graph-unverified",
      runtime: {
        ...(typeof system.system?.comfyui_version === "string" && {
          version: system.system.comfyui_version,
        }),
        devices: Array.isArray(system.devices)
          ? system.devices.slice(0, 16).map((device) => ({
              name: String(device.name || "").slice(0, 200),
              type: String(device.type || "").slice(0, 40),
            }))
          : [],
      },
    };
  }
  async validateProfile(id) {
    const profile = (await this.profiles()).find((entry) => entry.id === id);
    if (!profile) throw new Error("ComfyUI profile not found.");
    try {
      return await this.inspectProfile(profile);
    } catch (error) {
      return {
        valid: false,
        profileId: id,
        errors: [error.message],
        modelFacts: [],
      };
    }
  }
  async catalog(kind) {
    return (await this.profiles())
      .filter((profile) => profile.kind === kind)
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        label: profile.name,
        capabilities: [kind],
        acceptsImages: Boolean(profile.bindings.images?.length),
        maxImages: profile.bindings.images?.length || 0,
      }));
  }
  async status(kind) {
    const runtime = await this.runtimes.status("comfyui"),
      models = await this.catalog(kind);
    const ready = Boolean(runtime.running && models.length);
    return {
      ready,
      installed: runtime.installed,
      running: runtime.running,
      status: !runtime.running
        ? runtime.message || "Start ComfyUI in Settings → Local models."
        : !models.length
          ? `Add a ${kind} API workflow profile in Settings → Local models.`
          : "Local runtime reachable · profile dependencies are checked before generation",
      baseUrl: runtime.baseUrl,
    };
  }
  async preflight(job) {
    const receipt = job.providerOperation;
    const baseUrl = await this.endpoint();
    let profile;
    if (receipt) {
      if (
        receipt.providerId !== job.providerId ||
        receipt.state !== "accepted" ||
        receipt.endpoint !== baseUrl ||
        !safeId(receipt.id)
      )
        throw new Error(
          "ComfyUI has an uncertain submission or changed endpoint. Review the saved operation before creating a new run.",
        );
      profile = comfyProfileSchema.parse(receipt.profile);
    } else
      profile = (await this.profiles()).find((entry) => entry.id === job.model);
    if (
      !profile ||
      profile.id !== job.model ||
      providerId(profile.kind) !== job.providerId ||
      profile.kind !== job.kind
    )
      throw new Error(
        "Choose a saved ComfyUI profile matching this output type.",
      );
    if ((job.images?.length || 0) !== (profile.bindings.images?.length || 0))
      throw new Error(
        `This ComfyUI profile needs exactly ${profile.bindings.images?.length || 0} source images. Connect matching references or choose another profile.`,
      );
    if (
      job.video?.durationSeconds !== undefined ||
      job.video?.mode !== undefined
    )
      throw new Error(
        "ComfyUI video duration and mode come from its API workflow profile. Edit the profile instead of applying provider overrides.",
      );
    if (!receipt) {
      const key = `${baseUrl}:${hash(JSON.stringify(profile))}`;
      let cached = this.validationCache.get(key);
      if (!cached || Date.now() - cached.at > 5000) {
        if (this.validationCache.size >= 100) this.validationCache.clear();
        cached = {
          at: Date.now(),
          promise: this.inspectProfile(profile, baseUrl),
        };
        this.validationCache.set(key, cached);
        cached.promise.catch(() => this.validationCache.delete(key));
      }
      const validation = await cached.promise;
      if (!validation.valid) throw new Error(validation.errors.join(" "));
      return { profile, baseUrl, validation };
    }
    return { profile, baseUrl, validation: receipt.validation };
  }
  listen(baseUrl, clientId, job, checkpoint) {
    if (!this.Socket) return () => {};
    let socket,
      pending = Promise.resolve(),
      last = "",
      closed = false;
    try {
      socket = new this.Socket(
        `${baseUrl.replace(/^http/, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`,
      );
      socket.addEventListener("error", () => {});
      socket.addEventListener("message", (event) => {
        if (closed) return;
        let value;
        try {
          value = JSON.parse(event.data);
        } catch {
          return;
        }
        if (value.data?.prompt_id !== job.providerOperation?.id) return;
        let message;
        if (
          value.type === "progress" &&
          Number.isFinite(value.data.value) &&
          value.data.value >= 0 &&
          Number.isFinite(value.data.max) &&
          value.data.max > 0 &&
          value.data.value <= value.data.max
        )
          message = `ComfyUI node ${String(value.data.node || "").slice(0, 100)} · ${value.data.value}/${value.data.max} steps`;
        else if (value.type === "executing" && value.data.node != null)
          message = `ComfyUI executing node ${String(value.data.node).slice(0, 100)}…`;
        if (!message || message === last) return;
        last = message;
        pending = pending.then(() => checkpoint({ message })).catch(() => {});
      });
    } catch {
      return () => {};
    }
    return async () => {
      closed = true;
      try {
        socket.close();
      } catch {}
      await pending;
    };
  }
  async run({ job, directory, imagePaths = [], signal, checkpoint }) {
    if (typeof checkpoint !== "function")
      throw new Error("ComfyUI requires durable operation checkpoints.");
    const abort = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);
    const { profile, baseUrl, validation } = await this.preflight(job);
    const inputHashes = [];
    for (const file of imagePaths) inputHashes.push(hash(await readFile(file)));
    const inputHash = hash(
      JSON.stringify({
        model: job.model,
        prompt: job.prompt,
        seed: job.seed,
        ratio: job.ratio,
        inputHashes,
      }),
    );
    let receipt = job.providerOperation;
    if (receipt && receipt.inputHash !== inputHash)
      throw new Error(
        "ComfyUI inputs changed after submission. Resume with the original inputs.",
      );
    const clientId = receipt?.clientId || randomUUID();
    const close = this.listen(baseUrl, clientId, job, checkpoint);
    try {
      if (!receipt) {
        const graph = structuredClone(profile.graph);
        setBinding(graph, profile.bindings.prompt, job.prompt);
        if (profile.bindings.seed)
          setBinding(graph, profile.bindings.seed, job.seed ?? 0);
        if (profile.bindings.width || profile.bindings.height) {
          const [w, h] = String(job.ratio || "1:1")
            .split(":")
            .map(Number);
          if (!(w > 0 && h > 0))
            throw new Error("ComfyUI needs a numeric aspect ratio.");
          const { longEdge = 768, multiple = 64 } = profile.resolution || {};
          const scale = longEdge / Math.max(w, h);
          setBinding(
            graph,
            profile.bindings.width,
            Math.max(multiple, Math.round((w * scale) / multiple) * multiple),
          );
          setBinding(
            graph,
            profile.bindings.height,
            Math.max(multiple, Math.round((h * scale) / multiple) * multiple),
          );
        }
        if (imagePaths.length !== (profile.bindings.images?.length || 0))
          throw new Error(
            "ComfyUI source image count changed before execution.",
          );
        for (const [index, file] of imagePaths.entries()) {
          const data = await readFile(file);
          if (data.length > 64 * 1024 * 1024)
            throw new Error("ComfyUI source image exceeds 64 MB.");
          if (hash(data) !== inputHashes[index])
            throw new Error(
              "ComfyUI source image changed while preparing upload.",
            );
          const metadata = await sharp(data, {
            limitInputPixels: 64_000_000,
          }).metadata();
          const mime = {
            png: "image/png",
            jpeg: "image/jpeg",
            webp: "image/webp",
          }[metadata.format];
          if (!mime)
            throw new Error("ComfyUI needs PNG, JPEG, or WebP source images.");
          const form = new FormData();
          form.append(
            "image",
            new Blob([data], { type: mime }),
            `weft-${randomUUID()}.${metadata.format}`,
          );
          form.append("type", "input");
          form.append("overwrite", "false");
          const uploaded = await this.json(baseUrl, "/upload/image", {
            method: "POST",
            body: form,
            signal: abort,
          });
          const descriptor = fileDescriptor({
            filename: uploaded.name,
            subfolder: uploaded.subfolder,
            type: uploaded.type || "input",
          });
          setBinding(
            graph,
            profile.bindings.images[index],
            [descriptor.subfolder, descriptor.filename]
              .filter(Boolean)
              .join("/"),
          );
        }
        receipt = {
          providerId: job.providerId,
          state: "submitting",
          endpoint: baseUrl,
          inputHash,
          clientId,
          profile,
          graph,
          validation,
          requestHash: hash(JSON.stringify(graph)),
        };
        await checkpoint({
          providerOperation: receipt,
          message: "Submitting the workflow to local ComfyUI…",
        });
        const response = await this.request(baseUrl, "/prompt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: graph, client_id: clientId }),
          signal: abort,
        });
        const accepted = JSON.parse(
          (await responseBytes(response, 1024 * 1024, abort)).toString(),
        );
        if (
          !response.ok ||
          accepted.error ||
          Object.keys(accepted.node_errors || {}).length
        ) {
          if (
            (response.status >= 400 &&
              response.status < 500 &&
              response.status !== 408) ||
            (!accepted.prompt_id &&
              (accepted.error ||
                Object.keys(accepted.node_errors || {}).length))
          )
            await checkpoint({
              providerOperation: null,
              message: "ComfyUI rejected this workflow before acceptance.",
            });
          const nodeNames = Object.keys(accepted.node_errors || {})
            .slice(0, 10)
            .join(", ");
          throw new Error(
            `ComfyUI rejected the workflow${nodeNames ? ` at nodes ${nodeNames}` : ` (HTTP ${response.status})`}. Validate its profile and installed models.`,
          );
        }
        if (!safeId(accepted.prompt_id))
          throw new Error(
            "ComfyUI did not return a valid prompt ID; the uncertain submission is retained.",
          );
        receipt = { ...receipt, state: "accepted", id: accepted.prompt_id };
        await checkpoint({
          providerOperation: receipt,
          message:
            "ComfyUI accepted the local workflow. Waiting for execution…",
        });
      }
      if (receipt.requestHash !== hash(JSON.stringify(receipt.graph)))
        throw new Error(
          "ComfyUI saved workflow snapshot failed integrity verification.",
        );
      let result;
      for (;;) {
        abort.throwIfAborted();
        const history = await this.json(
          baseUrl,
          `/history/${encodeURIComponent(receipt.id)}`,
          { signal: abort },
        );
        result = history[receipt.id];
        if (
          result?.status?.status_str === "error" ||
          result?.status?.messages?.some((entry) =>
            ["execution_error", "execution_interrupted"].includes(entry[0]),
          )
        )
          throw new Error(
            "ComfyUI workflow failed or was interrupted. Inspect the runtime and saved profile before creating another run.",
          );
        if (
          result?.status?.completed ||
          result?.status?.status_str === "success"
        )
          break;
        const queue = await this.json(baseUrl, "/queue", { signal: abort });
        const pending = queue.queue_pending?.findIndex(
          (entry) => entry[1] === receipt.id,
        );
        if (pending >= 0)
          await checkpoint({
            message: `ComfyUI local queue · position ${pending + 1}`,
          });
        else if (!queue.queue_running?.some((entry) => entry[1] === receipt.id))
          throw new Error(
            "ComfyUI no longer has this accepted job in queue/history. Its receipt is retained; no duplicate workflow was submitted.",
          );
        await delay(this.pollMs, undefined, { signal: abort });
      }
      const values =
        result.outputs?.[profile.output.nodeId]?.[profile.output.field];
      const descriptor = fileDescriptor(values?.[profile.output.index]);
      const response = await this.request(
        baseUrl,
        `/view?${new URLSearchParams(descriptor)}`,
        { signal: abort },
      );
      if (!response.ok)
        throw new Error(
          `ComfyUI media download failed (HTTP ${response.status}); resume the accepted operation.`,
        );
      const data = await responseBytes(
        response,
        profile.kind === "video" ? 256 * 1024 * 1024 : 64 * 1024 * 1024,
        abort,
      );
      let dimensions;
      if (profile.kind === "video") {
        try {
          dimensions = inspectVideo(data);
        } catch {
          throw new Error(
            "ComfyUI profile did not produce a valid MP4 video. Choose an MP4 output node.",
          );
        }
      } else {
        const metadata = await sharp(data, {
          limitInputPixels: 64_000_000,
        }).metadata();
        if (!["png", "jpeg", "webp"].includes(metadata.format))
          throw new Error(
            "ComfyUI did not produce a valid PNG, JPEG, or WebP image.",
          );
        dimensions = { width: metadata.width, height: metadata.height };
      }
      await mkdir(directory, { recursive: true });
      const output = path.join(
          directory,
          profile.kind === "video" ? "output.mp4" : "comfy-original",
        ),
        temporary = `${output}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, data, { flag: "wx" });
        abort.throwIfAborted();
        await rename(temporary, output);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return {
        kind: profile.kind,
        path: output,
        metadata: {
          ...dimensions,
          sizeBytes: data.length,
          providerRequestId: receipt.id,
          requestedModel: profile.id,
          seedMode: profile.bindings.seed ? "parameter" : "unsupported",
          ...(profile.bindings.seed && {
            effectiveSeed:
              receipt.graph[profile.bindings.seed.nodeId].inputs[
                profile.bindings.seed.input
              ],
          }),
          localExecution: true,
          locality: "local-runtime-graph-unverified",
          endpoint: baseUrl,
          comfyProfile: profile,
          comfyGraph: receipt.graph,
          comfyGraphSha256: receipt.requestHash,
          modelFacts: receipt.validation?.modelFacts || [],
          runtime: receipt.validation?.runtime,
          effectiveSettings: {
            comfyProfile: profile,
            comfyGraph: receipt.graph,
            comfyGraphSha256: receipt.requestHash,
            modelFacts: receipt.validation?.modelFacts || [],
            runtime: receipt.validation?.runtime,
            endpoint: baseUrl,
            locality: "local-runtime-graph-unverified",
            ...(profile.bindings.seed && {
              seed: receipt.graph[profile.bindings.seed.nodeId].inputs[
                profile.bindings.seed.input
              ],
            }),
            ...(profile.bindings.width && {
              width:
                receipt.graph[profile.bindings.width.nodeId].inputs[
                  profile.bindings.width.input
                ],
            }),
            ...(profile.bindings.height && {
              height:
                receipt.graph[profile.bindings.height.nodeId].inputs[
                  profile.bindings.height.input
                ],
            }),
          },
        },
      };
    } finally {
      await close();
    }
  }
}
