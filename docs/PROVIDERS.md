# Providers and local harnesses

## Connect prompt and image engines in the app

Open **Provider connection settings** to see installed CLI accounts and add compatible API connections. **AI prompt** nodes can use `codex-text`, `pi`, `gemini-cli`, `claude-code`, or a compatible text model. **Image generation** nodes use `codex`, `local-color`, custom image commands, or compatible image models.

For a compatible connection, enter the API base URL and one model ID per line in the text or image field. Flow sends text requests to `/chat/completions`, image generation to `/images/generations`, and reference edits to `/images/edits` with multipart `image[]` fields. Endpoint support varies. Flow does not translate vendor-specific protocols. The base URL includes any required prefix such as `/v1`.

The key field is write-only. Saved keys use owner-only `.flow/connections.json`; this file is outside the served output routes. Keep the field blank to preserve the key, enter a replacement to rotate it, or select **Remove saved key**. Changing the base URL requires a replacement or removal. **Test** sends a bounded `GET /models` request and reports reachability, not verified generation support.

CLI accounts use their own sign-in. Install and sign in to each CLI before reloading providers. The model value `default` uses that CLI's configured default; enter a model ID to override it. `FLOW_PI_BIN`, `FLOW_GEMINI_BIN`, `FLOW_CLAUDE_BIN`, and `FLOW_CODEX_BIN` select executable paths. Gemini CLI prompt nodes currently accept text only. Pi, Codex, and Claude prompt adapters support reference images, subject to the selected model's vision support. Claude references are limited to 5 MB per image.

Generated prompts are durable queue jobs. A text result can feed several image jobs or another text generator. Retrying failed descendants reuses completed prompts. Model-generated lines remain one prompt; use **Prompt variations** for explicit fan-out.

The native protocols follow [Codex noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Claude Code headless mode](https://code.claude.com/docs/en/headless), [Gemini CLI headless mode](https://geminicli.com/docs/cli/headless/), and [Pi's CLI source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/args.ts). Compatible text requests follow the [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Each image-generation node selects its own provider and model. One workflow can fan a seed image and prompt into several engines, combine their outputs in a collection, or feed one engine's result into another engine.

## Available by default

| Provider        | What it does                                                                    | Authentication                      | Seed behavior                                               |
| --------------- | ------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| Codex Image     | Native image generation and reference-image editing through `codex exec`        | Your existing Codex ChatGPT sign-in | Variation labels; no deterministic image seed               |
| Local color lab | Processes the first reference image with hue, duotone, or monochrome operations | None                                | Deterministic for the same input, model, seed, and settings |

Local color lab is an image processor, not an AI model. It is also a working example of an independent command harness. Its executable adapter lives in `examples/harnesses/local-color.mjs`.

Choose providers from the generator's engine button, the left library, or the Tab search. The gallery can filter by provider and records each result's provider, model, actual dimensions, and seed behavior. Existing workflows without provider fields continue to use Codex.

## Add a command harness

Create `.flow/providers.json` with a `providers` array. Use an absolute executable path, or an executable on the server's PATH:

```json
{
  "providers": [
    {
      "id": "my-harness",
      "name": "My image harness",
      "kind": "command",
      "description": "My local generator",
      "command": [
        "/absolute/path/to/my-wrapper",
        "--input",
        "{input}",
        "--output",
        "{output}"
      ],
      "models": ["default", "another-model"],
      "requiresImage": false,
      "seeded": false,
      "timeoutMs": 1200000
    }
  ]
}
```

Select **Reload providers** in connection settings or run:

```sh
node cli/flow.mjs providers reload
node cli/flow.mjs providers
```

Commands run as argument arrays, without a shell. The `{input}`, `{output}`, and `{directory}` placeholders expand in individual arguments. Prompt text is passed as JSON, never interpolated into a shell command.

Every invocation receives the same request through stdin and through `request.json`:

```json
{
  "version": 1,
  "prompt": "The complete creative brief",
  "seed": 4200,
  "model": "default",
  "ratio": "1:1",
  "quality": "high",
  "images": ["/absolute/path/to/reference.png"],
  "output": "/absolute/job/folder/output.png",
  "directory": "/absolute/job/folder"
}
```

The same paths are available as `FLOW_JOB_INPUT` and `FLOW_JOB_OUTPUT` environment variables. Each job has a separate working directory. The harness must save a real raster image to the requested output path and exit with code zero. Flow decodes and normalizes it to PNG before marking the job complete. A successful process exit without a fresh image is a failure. Stdout/stderr are recorded in `command.log`.

A wrapper can invoke another agent CLI, a local diffusion engine, or a service SDK. That wrapper handles the tool's own authentication and output protocol. Its `models` list defines the choices exposed in the editor. Set `seeded: true` only when the wrapper's engine actually uses the supplied seed reproducibly.

## Add an image API

GPT Image 2.6 Sunburst/Flare connections expose GIF, SVG, complexity, transparency
and native markup-layer controls on the existing image node. Codex uses sprite
sheet generation and local assembly for GIFs. See [image formats](image-outputs.md)
for agent examples, native/API differences and validation rules.

The `image-api` adapter implements the [OpenAI-compatible Images API protocol](https://developers.openai.com/api/docs/guides/image-generation): JSON requests for text-to-image, multipart requests for reference-image edits, and base64 or image-URL responses.

```json
{
  "providers": [
    {
      "id": "image-api",
      "name": "My Images API",
      "kind": "image-api",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY",
      "models": ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"],
      "sizes": {
        "1:1": "1024x1024",
        "3:2": "1536x1024",
        "2:3": "1024x1536"
      }
    }
  ]
}
```

Set the named API-key environment variable when starting the server. For this file-based configuration, keys come from the server environment. Keys are absent from workflows and the provider catalog. The in-app connection form above supports private local key storage. API usage has the provider's own billing and account limits; it is separate from the Codex subscription path.

For a compatible local endpoint, use its local base URL and omit `apiKeyEnv` when it does not require authentication. Additional fixed request fields can be supplied in `parameters`. A `seedParameter`, such as `"seed"`, opts into passing the numeric seed to an endpoint that explicitly supports it. Codex's native route does not receive this parameter.

The default API ratios are `1:1`, `3:2`, and `2:3`. Only add other size mappings when the selected models support them. An unsupported ratio is rejected before queuing jobs. Models and API keys are considered configured until an actual inference request verifies access; the UI states this distinction.

Services with a different request protocol need a command wrapper or another provider adapter. An arbitrary service URL is not assumed to be OpenAI compatible.

## CLI routing

```sh
# Override the provider for every generation node in a run.
node cli/flow.mjs run --workflow paper-studies --provider local-color --model duotone --count 1 --wait

# Start a local processing batch from a seed file.
node cli/flow.mjs run --seed-image ./public/assets/paper-seed.png \
  --prompt "Color study" --provider local-color --model color-study \
  --count 8 --seed 400 --concurrency 4 --wait
```

Without a `--provider` override, a workflow keeps each node's configured provider. `--model` overrides model selection for the run; it must belong to the chosen provider's configured model list. Completed outputs and their provenance stay with the run snapshot, even if you later change the canvas.

`examples/mixed-providers.flow.json` is the two-branch Codex/local workflow exercised in the editor. `examples/local-color-batch.flow.json` runs 100 local color studies from the bundled reference without AI inference. Use `--count 1` to reduce either example before running it.

`examples/layered-color-studies.flow.json` demonstrates a two-stage pipeline: three local color studies flow through a prompt into three duotone finishing jobs. Each finishing job receives its own parent image. Run it with `node cli/flow.mjs run --from examples/layered-color-studies.flow.json --concurrency 3 --wait`.
