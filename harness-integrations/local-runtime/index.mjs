import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  stat,
  statfs,
  lstat,
  realpath,
  rm,
  chmod,
  readdir,
} from "node:fs/promises";
import { executeCommand, downloadFile, ndjson, readJson } from "./io.mjs";
import {
  localRuntimeSchema,
  localRuntimeConfigSchema,
  loopbackEndpointSchema,
} from "../../shared/local-models.mjs";
import { localModelPreset } from "../../shared/local-model-presets.mjs";
import {
  OLLAMA_VERSION,
  OLLAMA_RELEASES,
  COMFY_REVISION,
} from "./versions.mjs";

const defaults = {
  ollama: "http://127.0.0.1:11434",
  comfyui: "http://127.0.0.1:8188",
};
const folders = new Set([
  "checkpoints",
  "diffusion_models",
  "text_encoders",
  "vae",
  "loras",
  "clip_vision",
]);
const names = { ollama: "Ollama", comfyui: "ComfyUI" };
const now = () => new Date().toISOString();
const delay = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal.reason || new Error("Cancelled"));
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
const fileState = (file) =>
  stat(file).then(
    (s) => ({ size: s.size, modifiedMs: s.mtimeMs }),
    () => null,
  );
const json = (file, fallback = null) =>
  readFile(file, "utf8").then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return fallback;
    throw error;
  });
const inside = (root, candidate) => {
  const rel = path.relative(root, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
  );
};
function runtimeId(id) {
  return localRuntimeSchema.parse(id);
}
function endpoint(value) {
  return new URL(loopbackEndpointSchema.parse(value)).origin;
}

export class RuntimeManager {
  constructor({
    dataRoot,
    fetch: fetchFile = fetch,
    executeCommand: execute = executeCommand,
    spawnProcess = spawn,
    download = downloadFile,
    statfs: diskSpace = statfs,
    platform = process.platform,
    arch = process.arch,
    memoryBytes = os.totalmem(),
    pollMs = 250,
    probeTimeoutMs = 1800,
    startTimeoutMs = 180000,
    ollamaReleases = OLLAMA_RELEASES,
  } = {}) {
    if (!dataRoot) throw new Error("RuntimeManager requires dataRoot.");
    this.dataRoot = dataRoot;
    this.root = path.join(dataRoot, "models", "local");
    this.configFile = path.join(dataRoot, "local-runtimes.json");
    this.fetch = fetchFile;
    this.execute = execute;
    this.spawn = spawnProcess;
    this.download = download;
    this.diskSpace = diskSpace;
    this.platform = platform;
    this.arch = arch;
    this.memoryBytes = memoryBytes;
    this.ollamaReleases = ollamaReleases;
    this.configWrites = Promise.resolve();
    this.pollMs = pollMs;
    this.probeTimeoutMs = probeTimeoutMs;
    this.startTimeoutMs = startTimeoutMs;
    this.tasks = new Map();
    this.active = new Map();
    this.processes = new Map();
    this.writes = Promise.resolve();
    this.closed = false;
    this.initialized = this.initialize();
  }
  get activeCount() {
    return this.active.size;
  }
  directory(id) {
    return path.join(this.root, runtimeId(id));
  }
  modelsDirectory(id) {
    return path.join(
      this.directory(id),
      id === "ollama" ? "weights" : "source/models",
    );
  }
  binary(id) {
    return id === "ollama"
      ? path.join(
          this.directory(id),
          "runtime",
          this.platform === "darwin" ? "ollama" : "bin/ollama",
        )
      : path.join(
          this.directory(id),
          "venv",
          this.platform === "win32" ? "Scripts/python.exe" : "bin/python",
        );
  }
  async initialize() {
    this.config = await json(this.configFile, {});
    for (const id of Object.keys(defaults)) {
      if (this.config[id])
        this.config[id] = { baseUrl: endpoint(this.config[id].baseUrl) };
      const task = await json(path.join(this.directory(id), "task.json"));
      if (!task) continue;
      if (task.status === "running") {
        task.status = "interrupted";
        task.message =
          "The app stopped during this operation. Retry to continue setup or download.";
        task.updatedAt = now();
        await this.atomic(path.join(this.directory(id), "task.json"), task);
      }
      this.tasks.set(id, task);
    }
  }
  atomic(file, value) {
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.part`;
        try {
          await writeFile(temporary, JSON.stringify(value, null, 2), {
            mode: 0o600,
          });
          await rename(temporary, file);
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
      });
    this.writes = operation;
    return operation;
  }
  async getConfig(id) {
    runtimeId(id);
    await this.initialized;
    return { baseUrl: this.config[id]?.baseUrl || defaults[id] };
  }
  async configure(id, input) {
    runtimeId(id);
    const parsed = localRuntimeConfigSchema.parse(input);
    await this.initialized;
    const operation = this.configWrites
      .catch(() => {})
      .then(async () => {
        if (this.active.has(id) || this.processes.has(id))
          throw new Error(
            "Stop the managed runtime and finish its operation before changing the endpoint.",
          );
        const next = {
          ...this.config,
          [id]: { baseUrl: endpoint(parsed.baseUrl) },
        };
        await this.atomic(this.configFile, next);
        this.config = next;
      });
    this.configWrites = operation;
    await operation;
    return this.status(id);
  }

  async request(id, route, options = {}) {
    const { baseUrl } = await this.getConfig(id);
    const signal = options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(this.probeTimeoutMs),
        ])
      : AbortSignal.timeout(this.probeTimeoutMs);
    const response = await this.fetch(baseUrl + route, {
      ...options,
      signal,
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`${names[id]} request failed (${response.status}).`);
    return readJson(response);
  }
  async probe(id) {
    try {
      if (id === "ollama") {
        const [version, inventory] = await Promise.all([
          this.request(id, "/api/version"),
          this.request(id, "/api/tags"),
        ]);
        return {
          running: true,
          version: version.version,
          models: (inventory.models || []).slice(0, 500).map((model) => ({
            id: model.name || model.model,
            sizeBytes: model.size,
            digest: model.digest,
            details: model.details,
            ...(model.remote_host && { remoteHost: model.remote_host }),
          })),
        };
      }
      const report = await this.request(id, "/system_stats");
      const info = await this.request(
        id,
        "/object_info/CheckpointLoaderSimple",
      ).catch(() => ({}));
      const choices =
        info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
      return {
        running: true,
        version: report.system?.comfyui_version,
        models: Array.isArray(choices)
          ? choices
              .filter((value) => typeof value === "string")
              .slice(0, 500)
              .map((filename) => ({
                id: filename,
                filename,
                folder: "checkpoints",
                source: "runtime",
              }))
          : [],
        devices: report.devices || [],
      };
    } catch (error) {
      return {
        running: false,
        models: [],
        probeMessage: String(error.message).slice(0, 500),
      };
    }
  }
  async installation(id) {
    const receipt = await json(path.join(this.directory(id), "ready.json"));
    if (!receipt) return { installed: false };
    const current = await fileState(this.binary(id));
    const source =
      id === "comfyui"
        ? await fileState(path.join(this.directory(id), "source/main.py"))
        : null;
    return {
      installed: Boolean(
        current &&
        receipt.binary?.size === current.size &&
        receipt.binary?.modifiedMs === current.modifiedMs &&
        (id !== "comfyui" ||
          (source &&
            receipt.source?.size === source.size &&
            receipt.source?.modifiedMs === source.modifiedMs &&
            receipt.revision === COMFY_REVISION)),
      ),
      receipt,
    };
  }
  async status(id) {
    await this.initialized;
    if (!id)
      return {
        hardware: {
          platform: this.platform,
          arch: this.arch,
          memoryBytes: this.memoryBytes,
        },
        runtimes: await Promise.all(
          Object.keys(defaults).map((name) => this.status(name)),
        ),
      };
    runtimeId(id);
    const [configuration, install, live] = await Promise.all([
      this.getConfig(id),
      this.installation(id),
      this.probe(id),
    ]);
    if (id === "comfyui") {
      const managedModels = await this.inventory();
      const keys = new Set(
        managedModels.map((model) => model.folder + "/" + model.filename),
      );
      const runtimeKeys = new Set(
        live.models.map((model) => model.folder + "/" + model.filename),
      );
      live.models = [
        ...managedModels.map((model) => ({
          ...model,
          availableInRuntime: runtimeKeys.has(
            model.folder + "/" + model.filename,
          ),
        })),
        ...live.models.filter(
          (model) => !keys.has(model.folder + "/" + model.filename),
        ),
      ];
    }
    const task = this.tasks.get(id),
      managed = this.processes.has(id);
    return {
      id,
      name: names[id],
      ...configuration,
      directory: this.directory(id),
      modelDirectory: this.modelsDirectory(id),
      installed: install.installed,
      ...live,
      managed,
      verifiedInference: false,
      message: live.running
        ? managed
          ? "Managed local runtime is running. Model inference has not been verified."
          : "External local runtime is reachable. Model inference has not been verified."
        : install.installed
          ? "Installed locally. Start the runtime to use models."
          : "Not installed. Set up a managed local runtime or connect an existing loopback service.",
      ...(task && { task: structuredClone(task) }),
    };
  }
  async updateTask(id, patch) {
    const task = { ...this.tasks.get(id), ...patch, updatedAt: now() };
    this.tasks.set(id, task);
    await this.atomic(path.join(this.directory(id), "task.json"), task);
    return task;
  }
  async launch(id, action, operation, details = {}) {
    runtimeId(id);
    await this.initialized;
    await this.configWrites.catch(() => {});
    if (this.closed) throw new Error("Runtime manager is closed.");
    if (this.active.has(id)) {
      const task = this.tasks.get(id);
      if (
        action === "install-model" &&
        (task?.action !== action || task?.presetId !== details.presetId)
      ) {
        const error = new Error(
          "ComfyUI has another setup operation in progress. Finish or cancel it before installing this model.",
        );
        error.status = 409;
        throw error;
      }
      return this.status(id);
    }
    const controller = new AbortController();
    const active = { controller, promise: null };
    this.active.set(id, active);
    this.tasks.delete(id);
    const saved = this.updateTask(id, {
      id: randomUUID(),
      action,
      status: "running",
      stage: "checking",
      message: `Preparing ${names[id]}…`,
      ...details,
    });
    active.promise = (async () => {
      try {
        await saved;
        controller.signal.throwIfAborted();
        await operation(controller.signal);
        controller.signal.throwIfAborted();
        await this.updateTask(id, {
          status: "completed",
          stage: "complete",
          message: `${names[id]} ${action} completed.`,
        });
      } catch (error) {
        const cancelled =
          controller.signal.aborted &&
          controller.signal.reason?.message === "Cancelled";
        await this.updateTask(id, {
          status:
            this.closed && controller.signal.aborted
              ? "interrupted"
              : cancelled
                ? "cancelled"
                : "failed",
          message:
            cancelled || (this.closed && controller.signal.aborted)
              ? "Stopped locally. Retry to continue when ready."
              : String(
                  controller.signal.aborted
                    ? controller.signal.reason?.message || error.message
                    : error.message,
                ).slice(0, 2000),
        }).catch(() => {});
      } finally {
        this.active.delete(id);
      }
    })();
    await saved;
    return this.status(id);
  }

  progress(id, patch) {
    if (!this.active.has(id) || this.active.get(id).controller.signal.aborted)
      return;
    const task = { ...this.tasks.get(id), ...patch, updatedAt: now() };
    this.tasks.set(id, task);
    this.atomic(path.join(this.directory(id), "task.json"), task).catch(() =>
      this.active
        .get(id)
        ?.controller.abort(new Error("Unable to persist setup progress.")),
    );
  }
  setup(id) {
    return this.launch(id, "setup", async (signal) => {
      if (!(await this.installation(id)).installed) {
        if (this.processes.has(id))
          throw new Error("Stop the runtime before reinstalling it.");
        if (id === "ollama") await this.setupOllama(signal);
        else await this.setupComfy(signal);
      }
      this.progress(id, {
        stage: "starting",
        message: `Starting ${names[id]} on its configured loopback endpoint…`,
        download: undefined,
      });
      await this.startOwned(id, signal);
    });
  }
  async setupOllama(signal) {
    const release =
      this.ollamaReleases[
        this.platform === "darwin" ? "darwin" : `${this.platform}-${this.arch}`
      ];
    if (!release || !["arm64", "x64"].includes(this.arch))
      throw new Error(
        "Managed Ollama setup supports macOS and Linux on Apple/ARM64 or x64. Connect an existing Ollama runtime on this platform.",
      );
    const directory = this.directory("ollama");
    await mkdir(directory, { recursive: true });
    const archive = path.join(directory, release.file + ".part");
    await rm(archive, { force: true });
    this.progress("ollama", {
      stage: "download",
      message: `Downloading official Ollama ${OLLAMA_VERSION} runtime…`,
    });
    try {
      await this.download(
        `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/${release.file}`,
        archive,
        (download) => this.progress("ollama", { download }),
        {
          signal,
          fetchFile: this.fetch,
          sha256: release.sha256,
          maxBytes: 4 * 1024 ** 3,
        },
      );
      await this.verifyHash(archive, release.sha256);
      signal.throwIfAborted();
      const destination = path.join(directory, "runtime");
      await mkdir(destination, { recursive: true });
      this.progress("ollama", {
        stage: "extracting",
        message: "Extracting the verified Ollama archive…",
        download: undefined,
      });
      await this.execute("tar", ["-xf", archive, "-C", destination], {
        signal,
      });
      await chmod(this.binary("ollama"), 0o755);
      this.progress("ollama", {
        stage: "verification",
        message: "Checking the managed Ollama executable…",
      });
      await this.execute(this.binary("ollama"), ["--version"], { signal });
      const binary = await fileState(this.binary("ollama"));
      if (!binary?.size)
        throw new Error(
          "The Ollama archive did not contain its expected executable.",
        );
      await this.atomic(path.join(directory, "ready.json"), {
        runtime: "ollama",
        version: OLLAMA_VERSION,
        archiveSha256: release.sha256,
        binary,
        installedAt: now(),
      });
    } finally {
      await rm(archive, { force: true });
    }
  }
  async setupComfy(signal) {
    if (!["darwin", "linux", "win32"].includes(this.platform))
      throw new Error(
        "Managed ComfyUI setup is not supported on this platform.",
      );
    const directory = this.directory("comfyui"),
      source = path.join(directory, "source");
    await mkdir(source, { recursive: true });
    const execute = (command, args, extra = {}) =>
      this.execute(command, args, {
        signal,
        onProgress: (message) => this.progress("comfyui", { message }),
        ...extra,
      });
    this.progress("comfyui", {
      stage: "runtime",
      message: "Preparing an isolated Python environment…",
    });
    let uv = true;
    try {
      await execute("uv", ["--version"]);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      uv = false;
    }
    try {
      if (uv)
        await execute("uv", [
          "venv",
          "--allow-existing",
          "--python",
          "3.12",
          path.join(directory, "venv"),
        ]);
      else
        await execute("python3", ["-m", "venv", path.join(directory, "venv")]);
    } catch (error) {
      if (error.code === "ENOENT")
        throw new Error(
          "Install uv or Python 3.10+ and Git, then retry managed ComfyUI setup.",
        );
      throw error;
    }
    await execute(this.binary("comfyui"), [
      "-c",
      "import sys; assert (3,10) <= sys.version_info[:2] < (3,14), 'ComfyUI setup requires Python 3.10–3.13; install uv for isolated Python 3.12.'",
    ]);
    this.progress("comfyui", {
      stage: "source",
      message: "Fetching the pinned official ComfyUI source…",
    });
    try {
      if (!(await fileState(path.join(source, ".git/HEAD")))) {
        await execute("git", ["init", source]);
        await execute("git", [
          "-C",
          source,
          "remote",
          "add",
          "origin",
          "https://github.com/Comfy-Org/ComfyUI.git",
        ]);
      }
      await execute("git", [
        "-C",
        source,
        "remote",
        "set-url",
        "origin",
        "https://github.com/Comfy-Org/ComfyUI.git",
      ]);
      await execute("git", [
        "-C",
        source,
        "fetch",
        "--depth",
        "1",
        "origin",
        COMFY_REVISION,
      ]);
      await execute("git", [
        "-C",
        source,
        "checkout",
        "--detach",
        "FETCH_HEAD",
      ]);
      const revision = await execute("git", [
        "-C",
        source,
        "rev-parse",
        "HEAD",
      ]);
      if (String(revision.stdout ?? revision).trim() !== COMFY_REVISION)
        throw new Error(
          "ComfyUI source revision did not match its pinned release.",
        );
    } catch (error) {
      if (error.code === "ENOENT")
        throw new Error(
          "Git is required to install the pinned ComfyUI source. Install Git and retry setup.",
        );
      throw error;
    }
    this.progress("comfyui", {
      stage: "dependencies",
      message:
        "Installing isolated ComfyUI dependencies; this can take several minutes…",
    });
    await execute(
      uv ? "uv" : this.binary("comfyui"),
      [
        ...(uv
          ? ["pip", "install", "--python", this.binary("comfyui")]
          : ["-m", "pip", "install"]),
        "-r",
        path.join(source, "requirements.txt"),
      ],
      { directory: source },
    );
    this.progress("comfyui", {
      stage: "verification",
      message: "Verifying Python dependencies and available local compute…",
    });
    const result = await execute(this.binary("comfyui"), [
      "-c",
      'import json, torch, aiohttp, PIL, safetensors; print(json.dumps({"torch":torch.__version__,"cuda":torch.cuda.is_available(),"mps":bool(getattr(torch.backends,"mps",None) and torch.backends.mps.is_available())}))',
    ]);
    const compute = JSON.parse(
      String(result.stdout ?? result)
        .trim()
        .split("\n")
        .at(-1),
    );
    const [binary, sourceState] = await Promise.all([
      fileState(this.binary("comfyui")),
      fileState(path.join(source, "main.py")),
    ]);
    if (!binary?.size || !sourceState?.size)
      throw new Error(
        "ComfyUI setup did not produce the required runtime files.",
      );
    await this.atomic(path.join(directory, "ready.json"), {
      runtime: "comfyui",
      revision: COMFY_REVISION,
      binary,
      source: sourceState,
      compute,
      installedAt: now(),
    });
  }
  start(id) {
    return this.launch(id, "start", (signal) => this.startOwned(id, signal));
  }
  async startOwned(id, signal) {
    if ((await this.probe(id)).running) return;
    if (!(await this.installation(id)).installed)
      throw new Error(`${names[id]} is not installed. Run setup first.`);
    const { baseUrl } = await this.getConfig(id),
      target = new URL(baseUrl);
    if (target.protocol !== "http:")
      throw new Error(
        "Managed runtimes start with HTTP. Use an HTTP loopback endpoint or connect an external HTTPS service.",
      );
    const directory = this.directory(id),
      log = createWriteStream(path.join(directory, "runtime.log"), {
        flags: "a",
        mode: 0o600,
      });
    const receipt = (await this.installation(id)).receipt;
    const args =
      id === "ollama"
        ? ["serve"]
        : [
            path.join(directory, "source/main.py"),
            "--listen",
            target.hostname.replaceAll(/[\[\]]/g, ""),
            "--port",
            target.port || "80",
            "--disable-auto-launch",
            ...(!receipt.compute?.cuda && !receipt.compute?.mps
              ? ["--cpu"]
              : []),
          ];
    const env = {
      ...process.env,
      NO_COLOR: "1",
      ...(id === "ollama" && {
        OLLAMA_HOST: baseUrl,
        OLLAMA_MODELS: this.modelsDirectory(id),
        OLLAMA_NO_CLOUD: "1",
        OLLAMA_NUM_PARALLEL: "1",
      }),
    };
    await mkdir(this.modelsDirectory(id), { recursive: true });
    const child = this.spawn(this.binary(id), args, {
      cwd: id === "comfyui" ? path.join(directory, "source") : directory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: this.platform !== "win32",
    });
    const owned = { child, log, error: null };
    this.processes.set(id, owned);
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.once("error", (error) => {
      owned.error = error;
    });
    log.on("error", (error) => {
      owned.error = error;
    });
    child.once("close", () => {
      if (this.processes.get(id) === owned) this.processes.delete(id);
      log.end();
    });
    const started = Date.now(),
      deadline = started + this.startTimeoutMs;
    let latestOutput = "",
      lastProgress = 0,
      changed = true;
    const captureStartup = (chunk) => {
      const lines = chunk
        .toString("utf8")
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split(/[\r\n]+/)
        .filter((line) => line.trim());
      if (lines.length) {
        latestOutput = lines.at(-1).trim().slice(0, 360);
        changed = true;
      }
    };
    child.stdout?.on("data", captureStartup);
    child.stderr?.on("data", captureStartup);
    this.progress(id, {
      stage: "loading-runtime",
      message: `Loading ${names[id]} and its model libraries. First launch can take up to three minutes…`,
    });
    try {
      while (Date.now() < deadline) {
        signal?.throwIfAborted();
        if (owned.error) throw owned.error;
        if (child.exitCode != null)
          throw new Error(
            `${names[id]} stopped while starting. Installed files were kept; retry Start after checking ${path.join(directory, "runtime.log")}.`,
          );
        if ((await this.probe(id)).running) return;
        const current = Date.now();
        if (
          (changed && current - lastProgress >= 1000) ||
          current - lastProgress >= 4000
        ) {
          const seconds = Math.floor((current - started) / 1000);
          this.progress(id, {
            stage: "loading-runtime",
            message: `Loading ${names[id]} · ${seconds}s elapsed${latestOutput ? ` · ${latestOutput}` : " · importing local model libraries…"}`,
          });
          lastProgress = current;
          changed = false;
        }
        await delay(this.pollMs, signal);
      }
      throw new Error(
        `${names[id]} startup exceeded ${Math.round(this.startTimeoutMs / 1000)} seconds while loading local libraries. Installed files were kept; retry Start. See ${path.join(directory, "runtime.log")}.`,
      );
    } catch (error) {
      await this.stopOwned(id);
      throw error;
    } finally {
      child.stdout?.removeListener("data", captureStartup);
      child.stderr?.removeListener("data", captureStartup);
    }
  }

  async stopOwned(id) {
    const owned = this.processes.get(id);
    if (!owned) return;
    this.processes.delete(id);
    const kill = (force = false) => {
      try {
        if (this.platform === "win32")
          owned.child.kill(force ? "SIGKILL" : "SIGTERM");
        else process.kill(-owned.child.pid, force ? "SIGKILL" : "SIGTERM");
      } catch {
        try {
          owned.child.kill(force ? "SIGKILL" : "SIGTERM");
        } catch {}
      }
    };
    let timer;
    const exited = new Promise((resolve) => owned.child.once("close", resolve));
    kill();
    try {
      await Promise.race([
        exited,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (owned.child.exitCode == null) kill(true);
    owned.log.end();
  }
  async stop(id) {
    runtimeId(id);
    await this.initialized;
    await this.cancel(id);
    if (!this.processes.has(id)) {
      const result = await this.status(id);
      if (result.running)
        return {
          ...result,
          message:
            "This is an external runtime. Stop it in the application that owns it.",
        };
      return result;
    }
    await this.stopOwned(id);
    return this.status(id);
  }
  async pull(id, input) {
    runtimeId(id);
    if (id === "ollama") {
      if (
        !input ||
        Object.keys(input).some((key) => key !== "model") ||
        typeof input.model !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(input.model) ||
        /cloud/i.test(input.model)
      )
        throw new Error(
          "Choose a local Ollama model name without cloud or URL credentials.",
        );
      return this.launch(id, "pull", async (signal) => {
        if (!(await this.probe(id)).running)
          throw new Error("Start Ollama before downloading a model.");
        this.progress(id, {
          stage: "download",
          message: `Downloading ${input.model}…`,
          model: input.model,
        });
        const { baseUrl } = await this.getConfig(id);
        const response = await this.fetch(baseUrl + "/api/pull", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: input.model, stream: true }),
          signal,
          redirect: "error",
        });
        let complete = false;
        for await (const event of ndjson(response, { signal })) {
          if (event.error) throw new Error(String(event.error).slice(0, 1000));
          const completed = Number(event.completed),
            total = Number(event.total);
          const download =
            Number.isFinite(completed) && completed >= 0
              ? {
                  downloadedBytes: completed,
                  totalBytes:
                    Number.isFinite(total) && total > 0 ? total : null,
                  percent:
                    Number.isFinite(total) && total > 0
                      ? Math.min(100, (completed / total) * 100)
                      : null,
                  scope: "layer",
                  ...(typeof event.digest === "string" && {
                    digest: event.digest,
                  }),
                }
              : undefined;
          this.progress(id, {
            message: String(event.status || "Downloading model…").slice(0, 500),
            download,
          });
          if (event.status === "success") complete = true;
        }
        if (!complete)
          throw new Error(
            "Ollama download stream ended before success. Retry the model pull.",
          );
        const inventory = await this.request(id, "/api/tags");
        const requested = input.model.includes(":")
          ? input.model
          : input.model + ":latest";
        if (
          !(inventory.models || []).some((model) =>
            [input.model, requested].includes(model.name || model.model),
          )
        )
          throw new Error(
            "Ollama reported success but the requested model is not installed. Refresh and retry.",
          );
      });
    }
    if (
      !input ||
      Object.keys(input).some(
        (key) => !["url", "filename", "folder", "sha256"].includes(key),
      ) ||
      !folders.has(input.folder) ||
      typeof input.filename !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.safetensors$/.test(input.filename) ||
      !/^[a-fA-F0-9]{64}$/.test(input.sha256 || "")
    )
      throw new Error(
        "Supply a safetensors filename, supported model folder, HTTPS URL and SHA-256.",
      );
    const url = new URL(input.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Model downloads require HTTPS without URL credentials.");
    return this.launch(id, "pull", (signal) => this.pullWeights(input, signal));
  }
  async installPreset(presetId, onInstalled) {
    const preset = localModelPreset(presetId);
    return this.launch(
      "comfyui",
      "install-model",
      async (signal) => {
        const live = await this.probe("comfyui");
        if (live.running && !this.processes.has("comfyui"))
          throw new Error(
            "Preset setup uses Flow's managed ComfyUI. Stop the external server first, or add the profile and install its weights in that server.",
          );
        if (!(await this.installation("comfyui")).installed) {
          if (live.running)
            throw new Error(
              "Stop ComfyUI before updating its managed runtime.",
            );
          await this.setupComfy(signal);
        }
        const directory = this.modelsDirectory("comfyui");
        await mkdir(directory, { recursive: true });
        let remaining = 0;
        for (const weight of preset.weights)
          if (
            !(await fileState(
              path.join(directory, weight.folder, weight.filename),
            ))
          )
            remaining += weight.sizeBytes;
        const disk = await this.diskSpace(directory);
        if (disk.bavail * disk.bsize < remaining + 1024 ** 3)
          throw new Error(
            `Not enough free disk for ${preset.name}. Free at least ${Math.ceil((remaining + 1024 ** 3) / 1024 ** 3)} GB and retry.`,
          );
        for (const [index, weight] of preset.weights.entries()) {
          signal.throwIfAborted();
          this.progress("comfyui", {
            stage: "weights",
            message: `Checking file ${index + 1}/${preset.weights.length}: ${weight.filename}`,
            download: undefined,
            fileIndex: index + 1,
            fileCount: preset.weights.length,
          });
          await this.pullWeights(weight, signal);
        }
        this.progress("comfyui", {
          stage: "starting",
          message: "Starting ComfyUI with the downloaded MOSS weights…",
          download: undefined,
        });
        await this.startOwned("comfyui", signal);
        signal.throwIfAborted();
        this.progress("comfyui", {
          stage: "profile",
          message: "Registering the MOSS-Image generation profile…",
        });
        await onInstalled(preset);
      },
      { presetId, profileId: preset.id },
    );
  }
  async pullWeights(input, signal) {
    const id = "comfyui";
    const url = new URL(input.url);
    const directory = path.join(this.modelsDirectory(id), input.folder);
    await mkdir(directory, { recursive: true });
    if (!inside(await realpath(this.directory(id)), await realpath(directory)))
      throw new Error(
        "Model folder must remain inside the managed ComfyUI directory.",
      );
    const destination = path.join(directory, input.filename);
    const existing = await lstat(destination).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink())
        throw new Error("Model destination must be a regular file.");
      await this.verifyHash(destination, input.sha256);
      return;
    }
    const temporary = `${destination}.${randomUUID()}.part`;
    this.progress(id, {
      stage: "download",
      message: `Downloading ${input.filename}…`,
      model: input.filename,
    });
    try {
      const result = await this.download(
        url.href,
        temporary,
        (download) =>
          this.progress(id, {
            download,
            ...(download.phase === "verification" && {
              stage: "verification",
              message: `Verifying ${input.filename} SHA-256…`,
            }),
          }),
        { signal, fetchFile: this.fetch, sha256: input.sha256 },
      );
      this.progress(id, {
        stage: "verification",
        message: `Verifying ${input.filename} SHA-256…`,
      });
      await this.verifyHash(temporary, input.sha256);
      signal.throwIfAborted();
      await rename(temporary, destination);
      await this.atomic(destination + ".flow.json", {
        filename: input.filename,
        folder: input.folder,
        sha256: input.sha256.toLowerCase(),
        sizeBytes: result?.sizeBytes || (await stat(destination)).size,
        file: await fileState(destination),
        source: { origin: url.origin, pathname: url.pathname },
        downloadedAt: now(),
      });
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async inventory() {
    const root = this.modelsDirectory("comfyui"),
      results = [];
    for (const folder of folders) {
      const directory = path.join(root, folder);
      for (const entry of await readdir(directory, {
        withFileTypes: true,
      }).catch(() => [])) {
        if (
          !entry.isFile() ||
          !entry.name.endsWith(".safetensors") ||
          results.length >= 500
        )
          continue;
        const file = path.join(directory, entry.name),
          current = await fileState(file),
          receipt = await json(file + ".flow.json").catch(() => null);
        results.push({
          id: entry.name,
          folder,
          filename: entry.name,
          sizeBytes: current.size,
          source: "managed",
          ...(receipt?.file?.size === current.size &&
            receipt?.file?.modifiedMs === current.modifiedMs && {
              sha256: receipt.sha256,
              hashVerified: true,
            }),
        });
      }
    }
    return results;
  }
  async verifyHash(file, expected) {
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    if (hash.digest("hex") !== expected.toLowerCase())
      throw new Error(
        "SHA-256 did not match. The downloaded file was not installed.",
      );
  }
  async cancel(id) {
    runtimeId(id);
    await this.initialized;
    const operation = this.active.get(id);
    if (operation) {
      operation.controller.abort(new Error("Cancelled"));
      await operation.promise;
    }
    return this.status(id);
  }
  async close() {
    this.closed = true;
    await this.initialized;
    for (const operation of this.active.values())
      operation.controller.abort(new Error("App stopped"));
    await Promise.all(
      [...this.active.values()].map((operation) => operation.promise),
    );
    await Promise.all(
      [...this.processes.keys()].map((id) => this.stopOwned(id)),
    );
    await this.writes;
  }
}
