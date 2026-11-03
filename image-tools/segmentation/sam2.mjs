import { spawn } from "node:child_process";
import { mkdir, rename, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { downloadCheckpoint } from "./download.mjs";
const revision = "2b90b9f5ceec907a1c18123530e92e794ad901a4";
const checkpointUrl = (variant) =>
  `https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_${variant}.pt`;
function execute(command, args, { signal, env, onProgress, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      signal,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      errors = "",
      pending = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 12_000_000) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      errors = (errors + chunk).slice(-3000);
      onProgress?.(errors.slice(-300));
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop().slice(-8000);
      for (const line of lines) {
        if (!line.startsWith("WEFT_SAM_PROGRESS ")) continue;
        let event;
        try {
          event = JSON.parse(line.slice("WEFT_SAM_PROGRESS ".length));
        } catch {
          continue;
        }
        onEvent?.(event);
      }
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `Local SAM worker exited ${code}. ${errors.slice(-1200)}`,
            ),
          ),
    );
  });
}
export class Sam2 {
  constructor(
    dataRoot,
    {
      variant = process.env.WEFT_SAM_MODEL || "large",
      executeCommand = execute,
      download = downloadCheckpoint,
    } = {},
  ) {
    this.variant = variant;
    if (!["tiny", "large"].includes(this.variant))
      throw new Error("WEFT_SAM_MODEL must be tiny or large.");
    this.directory = path.join(dataRoot, "models", "sam2");
    this.python = path.join(
      this.directory,
      "venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    this.checkpoint = path.join(
      this.directory,
      `sam2.1_hiera_${this.variant}.pt`,
    );
    this.installation = null;
    this.installState = null;
    this.execute = executeCommand;
    this.download = download;
  }
  async status() {
    const [runtime, checkpoint, receipt, partial] = await Promise.all([
      stat(this.python).catch(() => null),
      stat(this.checkpoint).catch(() => null),
      readFile(path.join(this.directory, "ready.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null),
      stat(this.checkpoint + ".part").catch(() => null),
    ]);
    const verified = Boolean(
      receipt?.revision === revision &&
      receipt.checkpointUrl === checkpointUrl(this.variant) &&
      receipt.checkpoint?.bytes === checkpoint?.size &&
      receipt.checkpoint?.modifiedMs === checkpoint?.mtimeMs &&
      receipt.runtimeModifiedMs === runtime?.mtimeMs &&
      receipt.modelLoaded === true,
    );
    const ready = Boolean(runtime && checkpoint?.size && verified);
    const incomplete = Boolean(runtime || checkpoint || partial || receipt);
    return {
      model: `sam2.1-hiera-${this.variant}`,
      local: true,
      ready,
      status: ready ? "ready" : incomplete ? "incomplete" : "not-installed",
      directory: this.directory,
      components: {
        runtime: { ready: Boolean(runtime), path: this.python },
        checkpoint: {
          ready: Boolean(checkpoint?.size),
          path: this.checkpoint,
          bytes: checkpoint?.size || 0,
        },
        verification: { ready: verified },
      },
      ...(incomplete &&
        !ready &&
        !this.installation && {
          message:
            "Setup is incomplete or needs verification. Run setup to continue.",
          ...(partial && {
            download: {
              downloadedBytes: partial.size,
              totalBytes: null,
              percent: null,
            },
          }),
        }),
      ...(this.installState?.status === "ready" && !ready
        ? {}
        : this.installState),
    };
  }
  setup() {
    if (this.installation) return this.installation;
    this.installState = {
      status: "installing",
      stage: "runtime",
      message: "Installing local SAM 2.1 runtime…",
    };
    const onProgress = (message) => {
      this.installState = {
        ...this.installState,
        status: "installing",
        message,
      };
    };
    this.installation = (async () => {
      if ((await this.status()).ready) {
        this.installState = { status: "ready", message: "Local model ready" };
        return;
      }
      await mkdir(this.directory, { recursive: true });
      let useUv = true;
      try {
        await this.execute("uv", ["--version"]);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        useUv = false;
      }
      try {
        await this.execute(
          useUv ? "uv" : "python3",
          useUv
            ? [
                "venv",
                "--allow-existing",
                "--python",
                "3.12",
                path.join(this.directory, "venv"),
              ]
            : ["-m", "venv", path.join(this.directory, "venv")],
          { onProgress },
        );
      } catch (error) {
        if (error.code === "ENOENT")
          throw new Error(
            "SAM setup needs uv or Python 3.10+ on this computer. Install uv from https://docs.astral.sh/uv/getting-started/installation/ and retry setup.",
          );
        throw error;
      }
      await this.execute(this.python, [
        "-c",
        "import sys; assert sys.version_info >= (3, 10), 'SAM requires Python 3.10+. Install uv and retry setup.'",
      ]);
      this.installState.stage = "dependencies";
      await this.execute(
        useUv ? "uv" : this.python,
        [
          ...(useUv
            ? ["pip", "install", "--python", this.python]
            : ["-m", "pip", "install"]),
          "torch==2.6.0",
          "torchvision==0.21.0",
          "opencv-python-headless>=4.10,<5",
          `SAM-2 @ git+https://github.com/facebookresearch/sam2.git@${revision}`,
        ],
        { env: { SAM2_BUILD_CUDA: "0" }, onProgress },
      );
      if (
        !(await stat(this.checkpoint).then(
          (file) => file.size > 0,
          () => false,
        ))
      ) {
        this.installState.message = `Downloading SAM 2.1 ${this.variant} weights…`;
        this.installState.stage = "download";
        await this.download(
          checkpointUrl(this.variant),
          this.checkpoint + ".part",
          (download) => {
            this.installState = { ...this.installState, download };
          },
        );
        await rename(this.checkpoint + ".part", this.checkpoint);
      }
      this.installState = {
        ...this.installState,
        stage: "verification",
        message: "Verifying Python, PyTorch and SAM imports…",
      };
      await this.execute(this.python, [
        "-c",
        "import torch, cv2; from sam2.build_sam import build_sam2; print(torch.__version__)",
      ]);
      this.installState.message = "Loading the checkpoint to verify the model…";
      try {
        await this.execute(this.python, [
          "-c",
          "import sys; from sam2.build_sam import build_sam2; build_sam2('configs/sam2.1/sam2.1_hiera_" +
            (this.variant === "large" ? "l" : "t") +
            ".yaml', sys.argv[1], device='cpu', apply_postprocessing=False)",
          this.checkpoint,
        ]);
      } catch (error) {
        await rename(this.checkpoint, this.checkpoint + ".invalid").catch(
          () => {},
        );
        throw new Error(
          `SAM checkpoint could not load. Retry setup to download fresh weights. ${error.message}`,
        );
      }
      const [checkpoint, runtime] = await Promise.all([
        stat(this.checkpoint),
        stat(this.python),
      ]);
      await writeFile(
        path.join(this.directory, "ready.json.part"),
        JSON.stringify({
          revision,
          checkpointUrl: checkpointUrl(this.variant),
          checkpoint: {
            bytes: checkpoint.size,
            modifiedMs: checkpoint.mtimeMs,
          },
          runtimeModifiedMs: runtime.mtimeMs,
          modelLoaded: true,
        }),
      );
      await rename(
        path.join(this.directory, "ready.json.part"),
        path.join(this.directory, "ready.json"),
      );
      this.installState = { status: "ready", message: "Local model ready" };
    })()
      .catch((error) => {
        this.installState = { status: "failed", error: error.message };
      })
      .finally(() => {
        this.installation = null;
      });
    return this.installation;
  }
  async run({ input, directory, point, signal, onProgress }) {
    if (!(await this.status()).ready)
      throw new Error("Install the local SAM model first.");
    const args = [
      path.join(import.meta.dirname, "worker.py"),
      "--checkpoint",
      this.checkpoint,
      "--variant",
      this.variant,
      "--input",
      input,
      "--output",
      directory,
    ];
    if (point) args.push("--point", JSON.stringify(point));
    const result = await execute(this.python, args, {
      signal,
      env: { PYTORCH_ENABLE_MPS_FALLBACK: "1" },
      onEvent: onProgress,
    });
    return JSON.parse(result.trim().split("\n").at(-1));
  }
}
