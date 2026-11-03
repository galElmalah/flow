# Run models on your computer

Open **Settings → Local models** at `/settings/local-models`. Set up **Ollama** for prompts and chat, or **ComfyUI** for images and video recipes. You do not need an API key.

## Set up prompt generation

1. Click **Install runtime** on the Ollama card. Setup downloads and verifies the pinned official executable, then starts it on a loopback endpoint.
2. Choose a starter model and click **Download model**. The small Qwen 3 model is useful for setup checks. Choose a larger model for more demanding instructions.
3. Select **Ollama** and the downloaded model on a prompt-generation node or in the assistant.

The CLI uses the same operations:

```sh
node cli/flow.mjs local setup ollama --wait --json
node cli/flow.mjs local pull ollama --model qwen3:0.6b --wait --json
node cli/flow.mjs local status ollama --json
```

A completed download is not an inference test. The settings card links to the latest completed Flow generation for that model endpoint.

## Set up image generation

1. Click **Install runtime** on the ComfyUI card. Setup creates an isolated Python environment, installs dependencies, and starts the pinned official server. Initial imports can take several minutes.
2. Download weights with the model URL, filename, folder, and published SHA-256. Flow checks the hash before installing the file.
3. Choose an installed checkpoint under **Create an image profile**. Enter a profile name, then click **Save image profile**.
4. Click **Validate** on that profile. Correct any missing models or node dependencies.
5. Select **ComfyUI Image** and the profile in your workflow. Set copies or add generation modes, then run it.

For a basic Stable Diffusion 1.5 image workflow, the example weights file uses the [Comfy Org checkpoint](https://huggingface.co/Comfy-Org/stable-diffusion-1.5). It downloads approximately 2.13 GB. Review the model license on that page.

```sh
node cli/flow.mjs local setup comfyui --wait --json
node cli/flow.mjs local pull comfyui --from examples/local-models/sd15-weights.json --wait --json
node cli/flow.mjs local checkpoint --from examples/local-models/sd15-recipe.json --json
node cli/flow.mjs local profile validate local-sd15 --json
node cli/flow.mjs workflow create --name "Local images" --prompt "A cyclist in black and white" --provider comfyui-image --model local-sd15 --count 4 --json
```

Use the returned workflow ID with the existing `plan`, `run`, and `open` commands. Set copies on the image node to generate several images from one generated prompt. Local GPU jobs run one at a time while hosted jobs retain their parallel slots.

## Set up MOSS-Image

Open the **MOSS-Image** card at the top of **Settings → Local models**. Choose SFT BF16 or SFT INT8, then click **Download & setup**. Flow installs ComfyUI when needed, verifies three pinned weight files, starts its managed runtime, and adds the generation profile. The card shows file and byte progress. Cancel stops setup; retry reuses complete files after checking their hashes.

BF16 downloads 29.7 GB. INT8 downloads 15.4 GB. Download size does not establish inference memory requirements. Apple Silicon support is experimental. OpenMOSS validated its separate MPS pipeline on a 32 GB Mac; Flow's recorded check on a 24 GB Apple Silicon Mac completed at 512×512 with 10 steps using the INT8 preset. That check does not verify larger resolutions or full-precision weights.

Select **ComfyUI Image → MOSS-Image SFT** on a generator. Set copies or use a Prompt Set to queue multiple scenes. This preset uses native MOSS loaders and a 1024-pixel long edge, aligned to multiples of 16. Sampling uses 25 steps, CFG 2.5, and er_sde/simple from Comfy-Org's template. It sends the resolved Flow prompt unchanged. Prompt expansion stays explicit in upstream prompt-writing nodes.

The preset supports text-to-image. Connected image references fail preflight instead of being ignored. To describe a seed, connect it to an upstream vision prompt writer. Image editing or reference-conditioned generation needs a different model recipe.

For an existing ComfyUI installation, expand **Model files & existing installations**. Install the listed files in that server, then click **Use existing weights** and **Validate model**. Managed downloads do not change an external server's model paths.

Agents use the same setup operation:

```sh
node cli/flow.mjs local install moss-image-sft --wait --json
node cli/flow.mjs local install moss-image-sft-int8 --wait --json
node cli/flow.mjs local profile validate moss-image-sft --json
```

Run one install command for the chosen precision. `client.installLocalModel(presetId)` and MCP `install_local_model` start the same asynchronous task. Poll `read_local_models` or `flow local status comfyui` for progress. The HTTP route is `POST /api/local-models/comfyui/presets/:id/install`. `GET /api/local-models` lists presets, file sizes, and pinned hashes. Setup does not generate an image or claim inference success. After a completed run with matching observed weight hashes, the model card shows **Verified locally** and links to that run. The proof includes the tested dimensions and survives unrelated model runs.

The [OpenMOSS integration guide](https://github.com/OpenMOSS/MOSS-Image/blob/main/comfyui/README.md), [Apple Silicon validation notes](https://github.com/OpenMOSS/MOSS-Image/blob/main/docs/macos.md), and [Comfy-Org weight files](https://huggingface.co/Comfy-Org/MOSS-Image) document the upstream requirements. Flow pins the weights in `shared/local-model-presets.mjs`. Examples in `examples/local-models/moss-image-sft.json` and `moss-image-sft-int8.json` can register profiles without downloading.

## Add a video or advanced image recipe

Export an **API-format** graph from ComfyUI. Wrap it in a profile with prompt, seed, optional source-image bindings, and a final output selector. Import that JSON under **Import an image or video profile**.

Use `kind: "video"` and select a final MP4 output with `output.field: "videos"`, `"gifs"`, or `"images"`, as emitted by your save node. Flow checks the returned file's MP4 structure. A GIF or image renamed as video fails.

The exact profile contract lives in [`shared/local-models.mjs`](../shared/local-models.mjs). The native adapter's [reference](../harness-integrations/comfyui/README.md) covers bindings, validation, and recovery. The checkpoint builder is for compatible single-file image architectures. Other architectures, including video models, need their own graph and weights.

Import does not install custom-node code. Known cloud/API partner nodes are rejected. Review custom nodes before using them: an external extension's behavior cannot be established from its class name alone. Video wiring is covered by protocol tests; local video inference still needs a compatible model and a successful real run.

## Connect an existing runtime

Expand **Runtime location & endpoint**, then save its loopback origin. External runtimes remain under your control. Flow stops only processes it starts.

```sh
node cli/flow.mjs local configure ollama --from local-endpoint.json --json
node cli/flow.mjs providers reload --json
```

`local-endpoint.json` contains `{"baseUrl":"http://127.0.0.1:11434"}`. Ollama cloud models are excluded. For other compatible local servers, use **Settings → API connections** with the endpoint's actual supported capabilities.

## Recover setup or a run

Read the runtime task after a refresh with **Refresh** or `flow local status`. Download counters describe an artifact or an Ollama layer, not whole-model progress. Weight transfers retry a dropped connection up to three times using validated HTTP ranges. The complete file must pass its SHA-256 check before installation. A server that ignores a resume request causes that temporary file to restart. Complete installed files survive manual retries; unfinished files do not survive a stopped setup task. Dependency installation has stages and live messages without a percentage.

If setup fails, correct its reported cause and retry **Install runtime**. If the verified install exists, use **Start runtime** to retry startup without reinstalling dependencies. Cancel stops the local task. Model files persist across server restarts. Managed runtime processes stop with Flow; start them again before resuming interrupted runs.

An accepted ComfyUI job retains its prompt ID and frozen graph. Resume checks that same operation. An uncertain submission is blocked rather than duplicated. Local cancellation stops waiting and does not globally interrupt a shared ComfyUI server.

## Use the agent tools

MCP exposes `read_local_models`, `configure_local_runtime`, `local_runtime_action`, `pull_local_model`, `install_local_model`, `save_local_profile`, `create_local_checkpoint_profile`, `validate_local_profile`, and `remove_local_profile`. Read status until an asynchronous setup task completes, then reload providers. Workflow creation, modes, runs, asset annotations, and dataset exports use the existing tools.

New local image assets record the rendered ComfyUI graph, graph hash, seed, runtime/device facts, and observed weight hashes when Flow owns and verifies the weights. Ollama prompt assets include the observed model digest. These facts join normal asset lineage and JSONL exports. A seed is a recorded parameter, not a promise of identical GPU results across versions or machines.
