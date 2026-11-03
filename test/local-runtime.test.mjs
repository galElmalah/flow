import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { RuntimeManager } from "../harness-integrations/local-runtime/index.mjs";
import { downloadFile } from "../harness-integrations/local-runtime/io.mjs";
import { COMFY_REVISION } from "../harness-integrations/local-runtime/versions.mjs";
import { localModelPreset } from "../shared/local-model-presets.mjs";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const response = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
async function fixture(t, options = {}) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "weft-local-runtime-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const commands = [],
    children = [],
    downloads = [];
  let online = options.online || false,
    installedModels = [],
    pulls = 0,
    startOnline = options.startOnline !== false;
  const fetchFile = async (url, init) => {
    if (String(url).endsWith("/api/pull")) {
      pulls++;
      options.onPull?.(init);
      installedModels = [{ name: "test:latest", size: 9, digest: "abc" }];
      return new Response(
        '{"status":"pulling layer","digest":"abc","total":10,"completed":5}\n{"status":"success"}\n',
      );
    }
    if (!online) throw new Error("Offline fixture");
    if (String(url).endsWith("/api/version"))
      return response({ version: "fixture-local" });
    if (String(url).endsWith("/api/tags"))
      return response({ models: installedModels });
    if (String(url).endsWith("/system_stats"))
      return response({
        system: { comfyui_version: "fixture-comfy" },
        devices: [{ type: "cpu" }],
      });
    if (String(url).endsWith("/object_info/CheckpointLoaderSimple"))
      return response({
        CheckpointLoaderSimple: {
          input: { required: { ckpt_name: [["external.safetensors"]] } },
        },
      });
    throw new Error("Unexpected fixture URL: " + url);
  };
  const manager = new RuntimeManager({
    dataRoot,
    platform: options.platform || "darwin",
    arch: options.arch || "arm64",
    pollMs: 1,
    probeTimeoutMs: 100,
    startTimeoutMs: 100,
    ollamaReleases: Object.fromEntries(
      ["darwin", "linux-x64", "linux-arm64"].map((key) => [
        key,
        { file: "fixture.tgz", sha256: digest("archive") },
      ]),
    ),
    statfs: options.statfs || (async () => ({ bavail: 100, bsize: 1024 ** 3 })),
    fetch: fetchFile,
    download: async (url, file, progress, opts) => {
      downloads.push({ url, file });
      progress({
        downloadedBytes: 3,
        totalBytes: 7,
        percent: (3 / 7) * 100,
        scope: "artifact",
      });
      await options.download?.(url, file, progress, opts);
      if (!options.download) await writeFile(file, "archive");
      return { sizeBytes: 7 };
    },
    executeCommand: async (command, args, opts) => {
      commands.push({ command, args, env: opts?.env });
      await options.execute?.(command, args, opts);
      if (args[0] === "-xf") {
        await mkdir(path.dirname(manager.binary("ollama")), {
          recursive: true,
        });
        await writeFile(manager.binary("ollama"), "managed-ollama");
      }
      if (args[0] === "venv" || args.includes("venv")) {
        await mkdir(path.dirname(manager.binary("comfyui")), {
          recursive: true,
        });
        await writeFile(manager.binary("comfyui"), "managed-python");
      }
      if (command === "git" && args.includes("checkout")) {
        await writeFile(
          path.join(manager.directory("comfyui"), "source/main.py"),
          "fixture-comfy-main",
        );
      }
      if (command === "git" && args.includes("rev-parse"))
        return { stdout: COMFY_REVISION };
      if (args[1]?.includes("torch.cuda"))
        return {
          stdout: JSON.stringify({ torch: "fixture", cuda: false, mps: false }),
        };
      return { stdout: "fixture command" };
    },
    spawnProcess: (command, args, opts) => {
      const child = new EventEmitter();
      child.pid = 2000000000;
      child.exitCode = null;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = (signal) => {
        child.signals ||= [];
        child.signals.push(signal);
        online = false;
        child.exitCode = 0;
        setImmediate(() => child.emit("close", 0));
        return true;
      };
      children.push({ command, args, opts, child });
      online = startOnline;
      if (options.onSpawn) options.onSpawn(child);
      return child;
    },
  });
  t.after(() => manager.close());
  return {
    manager,
    dataRoot,
    commands,
    children,
    downloads,
    setStartOnline(value) {
      startOnline = value;
    },
    setOnline(value) {
      online = value;
    },
    get pulls() {
      return pulls;
    },
  };
}
async function finish(manager, runtime) {
  await manager.active.get(runtime)?.promise;
  return manager.status(runtime);
}

test("empty runtime state is honest, managed Ollama setup is pinned and isolated, and installation survives restart", async (t) => {
  const { manager, dataRoot, children, downloads, commands } = await fixture(t);
  const cold = await manager.status("ollama");
  assert.equal(cold.installed, false);
  assert.equal(cold.running, false);
  assert.equal(cold.managed, false);
  assert.equal(cold.verifiedInference, false);
  const initial = await manager.setup("ollama");
  assert.equal(initial.task.action, "setup");
  const ready = await finish(manager, "ollama");
  assert.equal(ready.task.status, "completed");
  assert.equal(ready.installed, true);
  assert.equal(ready.running, true);
  assert.equal(ready.managed, true);
  assert.equal(ready.verifiedInference, false);
  assert.equal(children.length, 1);
  assert.equal(children[0].opts.env.OLLAMA_NO_CLOUD, "1");
  assert.equal(children[0].opts.env.OLLAMA_NUM_PARALLEL, "1");
  assert.ok(children[0].opts.env.OLLAMA_MODELS.startsWith(dataRoot));
  assert.match(
    downloads[0].url,
    /github.com\/ollama\/ollama\/releases\/download\/v0\.40\.13/,
  );
  assert.equal(
    commands.some((item) => item.command === "sudo" || item.command === "sh"),
    false,
  );
  await manager.setup("ollama");
  await finish(manager, "ollama");
  assert.equal(downloads.length, 1);
  assert.equal(children.length, 1);
  await manager.stop("ollama");
  const restarted = new RuntimeManager({
    dataRoot,
    platform: manager.platform,
    arch: manager.arch,
    fetch: async () => {
      throw new Error("offline");
    },
  });
  t.after(() => restarted.close());
  assert.equal((await restarted.status("ollama")).installed, true);
  assert.equal((await restarted.status("ollama")).running, false);
  await writeFile(manager.binary("ollama"), "changed-runtime");
  assert.equal((await restarted.status("ollama")).installed, false);
});

test("Comfy setup uses pinned source and isolated venv, records actual compute and reports external checkpoint choices", async (t) => {
  const { manager, commands, children } = await fixture(t);
  await manager.setup("comfyui");
  const ready = await finish(manager, "comfyui");
  assert.equal(ready.task.status, "completed");
  assert.equal(ready.installed, true);
  assert.equal(ready.running, true);
  assert.ok(
    commands.some(
      ({ command, args }) => command === "git" && args.includes(COMFY_REVISION),
    ),
  );
  assert.ok(
    commands.some(
      ({ command, args }) =>
        command === "uv" &&
        args.includes("--python") &&
        args.includes(manager.binary("comfyui")),
    ),
  );
  assert.ok(children[0].args.includes("--cpu"));
  assert.equal(ready.models[0].filename, "external.safetensors");
  assert.equal(ready.models[0].source, "runtime");
});

test("missing Python and uv leaves recoverable failed setup rather than false readiness", async (t) => {
  let missing = true;
  const env = await fixture(t, {
    execute: async (command) => {
      if (missing && ["uv", "python3"].includes(command))
        throw Object.assign(new Error("not installed"), { code: "ENOENT" });
    },
  });
  await env.manager.setup("comfyui");
  let status = await finish(env.manager, "comfyui");
  assert.equal(status.task.status, "failed");
  assert.equal(status.installed, false);
  assert.match(status.task.message, /Install uv or Python/);
  missing = false;
  await env.manager.setup("comfyui");
  status = await finish(env.manager, "comfyui");
  assert.equal(status.task.status, "completed");
  assert.equal(status.installed, true);
});

test("configure rejects nonlocal endpoints, serializes unrelated changes, and never kills external runtimes", async (t) => {
  const { manager, dataRoot, children } = await fixture(t, { online: true });
  await assert.rejects(
    manager.configure("ollama", { baseUrl: "https://api.remote.invalid" }),
  );
  await assert.rejects(
    manager.configure("ollama", { baseUrl: "http://127.0.0.1:11434/path" }),
  );
  await Promise.all([
    manager.configure("ollama", { baseUrl: "http://127.0.0.1:11435" }),
    manager.configure("comfyui", { baseUrl: "http://localhost:8189" }),
  ]);
  const saved = JSON.parse(
    await readFile(path.join(dataRoot, "local-runtimes.json")),
  );
  assert.equal(saved.ollama.baseUrl, "http://127.0.0.1:11435");
  assert.equal(saved.comfyui.baseUrl, "http://localhost:8189");
  await manager.start("ollama");
  await finish(manager, "ollama");
  assert.equal(children.length, 0);
  const stopped = await manager.stop("ollama");
  assert.equal(stopped.running, true);
  assert.equal(stopped.managed, false);
  assert.match(stopped.message, /external runtime/);
});

test("Ollama pull requires complete success and inventory, preserves native layer progress, and rejects cloud models", async (t) => {
  const env = await fixture(t, { online: true });
  const { manager } = env;
  await assert.rejects(
    manager.pull("ollama", { model: "test:cloud" }),
    /local Ollama model/,
  );
  await manager.pull("ollama", { model: "test" });
  const status = await finish(manager, "ollama");
  assert.equal(status.task.status, "completed");
  assert.equal(status.models[0].id, "test:latest");
  assert.equal(env.pulls, 1);
  manager.fetch = async (url) =>
    String(url).endsWith("/api/pull")
      ? new Response('{"status":"pulling","total":10,"completed":5}\n')
      : response(
          String(url).endsWith("/api/tags")
            ? { models: [] }
            : { version: "fixture" },
        );
  await manager.pull("ollama", { model: "test" });
  const incomplete = await finish(manager, "ollama");
  assert.equal(incomplete.task.status, "failed");
  assert.match(incomplete.task.message, /ended before success/);
  assert.equal(incomplete.task.download.scope, "layer");
  assert.equal(incomplete.task.download.percent, 50);
});

test("checkpoint download validates hash before atomic install and exposes verified inventory without secrets", async (t) => {
  const bytes = "fixture checkpoint";
  const { manager, dataRoot } = await fixture(t, {
    download: async (url, file, progress) => {
      await writeFile(file, bytes);
      progress({
        downloadedBytes: bytes.length,
        totalBytes: bytes.length,
        percent: 100,
      });
    },
  });
  const input = {
    url: "https://models.example/weights/model.safetensors?token=private",
    folder: "checkpoints",
    filename: "model.safetensors",
    sha256: digest(bytes),
  };
  await manager.pull("comfyui", { ...input, sha256: digest("wrong") });
  let status = await finish(manager, "comfyui");
  assert.equal(status.task.status, "failed");
  assert.equal(status.models.length, 0);
  await assert.rejects(
    stat(
      path.join(
        manager.modelsDirectory("comfyui"),
        "checkpoints/model.safetensors",
      ),
    ),
  );
  await manager.pull("comfyui", input);
  status = await finish(manager, "comfyui");
  assert.equal(status.task.status, "completed");
  assert.equal(status.models[0].sha256, digest(bytes));
  assert.equal(status.models[0].hashVerified, true);
  const receipt = await readFile(
    path.join(
      dataRoot,
      "models/local/comfyui/source/models/checkpoints/model.safetensors.weft.json",
    ),
    "utf8",
  );
  assert.equal(receipt.includes("private"), false);
  await writeFile(
    path.join(
      manager.modelsDirectory("comfyui"),
      "checkpoints/model.safetensors",
    ),
    "edited",
  );
  assert.equal((await manager.status("comfyui")).models[0].sha256, undefined);
  await assert.rejects(
    manager.pull("comfyui", { ...input, filename: "../outside.safetensors" }),
  );
  await assert.rejects(manager.pull("comfyui", { ...input, folder: ".." }));
  await assert.rejects(
    manager.pull("comfyui", { ...input, url: "http://example.com/x" }),
  );
});

test("download cancellation is durable and a restart marks incomplete tasks interrupted", async (t) => {
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const { manager, dataRoot } = await fixture(t, {
    download: async (url, file, progress, { signal }) => {
      await writeFile(file, "part");
      progress({ downloadedBytes: 4, totalBytes: 100, percent: 4 });
      began();
      await new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      );
    },
  });
  await manager.setup("ollama");
  await started;
  assert.equal(manager.activeCount, 1);
  await assert.rejects(
    manager.configure("ollama", { baseUrl: "http://127.0.0.1:1234" }),
    /finish its operation/,
  );
  const stopped = await manager.cancel("ollama");
  assert.equal(stopped.task.status, "cancelled");
  assert.equal(stopped.installed, false);
  assert.equal(manager.activeCount, 0);
  const taskPath = path.join(dataRoot, "models/local/ollama/task.json");
  await writeFile(
    taskPath,
    JSON.stringify({
      id: "old",
      action: "setup",
      status: "running",
      stage: "download",
    }),
  );
  const restarted = new RuntimeManager({
    dataRoot,
    fetch: async () => {
      throw new Error("offline");
    },
  });
  t.after(() => restarted.close());
  assert.equal((await restarted.status("ollama")).task.status, "interrupted");
  assert.equal(JSON.parse(await readFile(taskPath)).status, "interrupted");
});

test("real streaming downloader requires HTTPS on redirects, validates hash, and never finalizes a corrupt artifact", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "weft-download-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "weights.part");
  let progress;
  await downloadFile(
    "https://example.test/model",
    file,
    (value) => {
      progress = value;
    },
    {
      sha256: digest("abc"),
      fetchFile: async () =>
        new Response("abc", { headers: { "content-length": "3" } }),
    },
  );
  assert.equal(await readFile(file, "utf8"), "abc");
  assert.equal(progress.percent, 100);
  assert.equal(progress.scope, "artifact");
  await assert.rejects(
    downloadFile(
      "https://example.test/model",
      path.join(root, "corrupt.part"),
      null,
      { sha256: digest("other"), fetchFile: async () => new Response("abc") },
    ),
    /SHA-256/,
  );
  await assert.rejects(
    downloadFile(
      "https://example.test/model",
      path.join(root, "bad.part"),
      null,
      {
        fetchFile: async () =>
          new Response("", {
            status: 302,
            headers: { location: "http://example.test/plain" },
          }),
      },
    ),
    /HTTPS/,
  );
});

test("Linux managed runtime selects its local bin path and checksum failures remain retryable", async (t) => {
  let corrupt = true;
  const { manager, downloads } = await fixture(t, {
    platform: "linux",
    arch: "x64",
    download: async (_url, file) => {
      await writeFile(file, corrupt ? "corrupt" : "archive");
    },
  });
  await manager.setup("ollama");
  let status = await finish(manager, "ollama");
  assert.equal(status.installed, false);
  assert.equal(status.task.status, "failed");
  assert.match(status.task.message, /SHA-256/);
  corrupt = false;
  await manager.setup("ollama");
  status = await finish(manager, "ollama");
  assert.equal(status.installed, true);
  assert.equal(status.task.status, "completed");
  assert.match(manager.binary("ollama"), /runtime\/bin\/ollama$/);
  assert.equal(downloads.length, 2);
});

test("runtime probes stop reading oversized JSON and setup persistence failures release task ownership", async (t) => {
  const { manager } = await fixture(t);
  let cancelled = false;
  manager.fetch = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  const state = await manager.status("ollama");
  assert.equal(state.running, false);
  assert.match(state.probeMessage, /size limit/);
  assert.equal(cancelled, true);
  manager.atomic = async () => {
    throw new Error("disk full fixture");
  };
  await assert.rejects(manager.setup("ollama"), /disk full/);
  await manager.active.get("ollama")?.promise;
  assert.equal(manager.activeCount, 0);
  assert.equal(manager.tasks.get("ollama").status, "failed");
  assert.match(manager.tasks.get("ollama").message, /disk full/);
  await assert.rejects(
    manager.pull("ollama", { model: "a".repeat(121) }),
    /local Ollama/,
  );
});

test("cold Comfy startup exposes actual library progress and retry reuses its verified install", async (t) => {
  let didSpawn;
  const spawned = new Promise((resolve) => {
    didSpawn = resolve;
  });
  const fixtureState = await fixture(t, {
    startOnline: false,
    onSpawn(child) {
      didSpawn();
      setImmediate(() =>
        child.stderr.write("Device: mps\nLoading model libraries\n"),
      );
    },
  });
  const { manager, commands } = fixtureState;
  await manager.setup("comfyui");
  await spawned;
  const activeStatus = await manager.status("comfyui");
  assert.equal(activeStatus.installed, true);
  assert.equal(activeStatus.task.stage, "loading-runtime");
  let state = await finish(manager, "comfyui");
  assert.equal(state.installed, true);
  assert.equal(state.running, false);
  assert.equal(state.task.status, "failed");
  assert.match(state.task.message, /Installed files were kept; retry Start/);
  const commandCount = commands.length;
  fixtureState.setStartOnline(true);
  await manager.setup("comfyui");
  state = await finish(manager, "comfyui");
  assert.equal(state.running, true);
  assert.equal(state.task.status, "completed");
  assert.equal(commands.length, commandCount);
});

test("MOSS preset cold setup downloads all pinned components, registers after completion, and reuses verified files", async (t) => {
  const { manager, downloads, children } = await fixture(t);
  const preset = localModelPreset("moss-image-sft");
  const hashes = [];
  // Fixture bytes exercise lifecycle; generic weight tests cover actual hash rejection.
  manager.verifyHash = async (file, sha) => {
    assert.equal(await readFile(file, "utf8"), "archive");
    assert.ok(preset.weights.some((weight) => weight.sha256 === sha));
    hashes.push(sha);
  };
  let profiles = 0;
  const register = async () => {
    assert.equal((await manager.inventory()).length, 3);
    profiles++;
  };
  await manager.installPreset(preset.id, register);
  const ready = await finish(manager, "comfyui");
  assert.equal(ready.installed, true);
  assert.equal(ready.managed, true);
  assert.equal(ready.task.presetId, preset.id);
  assert.equal(ready.task.fileIndex, 3);
  assert.equal(ready.task.status, "completed");
  assert.equal(ready.verifiedInference, false);
  assert.equal(profiles, 1);
  assert.deepEqual(
    downloads.map((entry) => entry.url),
    preset.weights.map((file) => file.url),
  );
  await manager.installPreset(preset.id, register);
  await finish(manager, "comfyui");
  assert.equal(downloads.length, 3);
  assert.equal(children.length, 1);
  assert.equal(hashes.length, 6);
});

test("MOSS setup reports insufficient disk and never registers an incomplete model", async (t) => {
  const { manager, downloads } = await fixture(t, {
    statfs: async () => ({ bavail: 0, bsize: 1 }),
  });
  let profiles = 0;
  await manager.installPreset("moss-image-sft-int8", async () => profiles++);
  const status = await finish(manager, "comfyui");
  assert.equal(status.task.status, "failed");
  assert.match(status.task.message, /Not enough free disk/);
  assert.equal(downloads.length, 0);
  assert.equal(profiles, 0);
});

for (const mode of ["resume", "restart", "invalid-range", "corrupt"]) {
  test(`weight transport recovery ${mode} validates offsets and the complete file hash`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-range-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const file = path.join(root, "weight.part");
    const calls = [];
    const result = downloadFile(
      "https://models.example/weight",
      file,
      undefined,
      {
        sha256: digest("abcdef"),
        fetchFile: async (url, options) => {
          calls.push(options);
          if (calls.length === 1)
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(Buffer.from("abc"));
                  setTimeout(
                    () => controller.error(new TypeError("terminated")),
                    15,
                  );
                },
              }),
              { headers: { "content-length": "6" } },
            );
          assert.equal(options.headers.Range, "bytes=3-");
          if (mode === "restart")
            return new Response("abcdef", {
              headers: { "content-length": "6" },
            });
          return new Response(mode === "corrupt" ? "xyz" : "def", {
            status: 206,
            headers: {
              "content-length": "3",
              "content-range":
                mode === "invalid-range" ? "bytes 2-4/6" : "bytes 3-5/6",
            },
          });
        },
      },
    );
    if (mode === "invalid-range")
      await assert.rejects(result, /invalid resume range/);
    else if (mode === "corrupt")
      await assert.rejects(result, /SHA-256 does not match/);
    else {
      assert.equal((await result).sha256, digest("abcdef"));
      assert.equal(await readFile(file, "utf8"), "abcdef");
    }
    assert.equal(calls.length, 2);
  });
}

test("weight download retries are bounded and cancellation does not reconnect", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "flow-range-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  await assert.rejects(
    downloadFile(
      "https://models.example/weight",
      path.join(root, "weight"),
      undefined,
      {
        fetchFile: async () => {
          calls++;
          throw new TypeError("connection failed");
        },
      },
    ),
    /connection failed/,
  );
  assert.equal(calls, 4);
  const controller = new AbortController();
  controller.abort(new Error("Cancelled"));
  await assert.rejects(
    downloadFile(
      "https://models.example/weight",
      path.join(root, "cancelled"),
      undefined,
      {
        signal: controller.signal,
        fetchFile: async () => {
          calls++;
        },
      },
    ),
    /Cancelled/,
  );
  assert.equal(calls, 4);
});

test("repeated MOSS setup joins only the same preset and rejects a competing setup", async (t) => {
  const { manager } = await fixture(t, {
    download: async (url, file, progress, { signal }) => {
      signal.throwIfAborted();
      await new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  });
  const first = await manager.installPreset("moss-image-sft", async () => {});
  assert.equal(first.task.presetId, "moss-image-sft");
  const duplicate = await manager.installPreset("moss-image-sft", async () =>
    assert.fail("No duplicate profile action"),
  );
  assert.equal(duplicate.task.id, first.task.id);
  await assert.rejects(
    manager.installPreset("moss-image-sft-int8", async () => {}),
    (error) => error.status === 409,
  );
  await manager.cancel("comfyui");
  assert.equal((await manager.status("comfyui")).task.status, "cancelled");
});
