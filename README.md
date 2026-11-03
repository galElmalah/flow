# Flow

A local canvas for image and video generation. Connect seed images, shared prompts and scene collections, then run parallel batches across CLI harnesses, hosted APIs or local models. Every output keeps its resolved prompt, settings, source references and generation lineage.

Flow is pre-release. This repository remains private while it is prepared for an open source release. See the [release checklist](docs/open-source-readiness.md).

## Run locally

Requires Node.js 22.13 or newer and npm. Start without provider credentials:

```sh
npm ci
npm run build
npm run serve
```

Open **http://localhost:4310**. The server runs in the background and stores local state in `.weft/`. Stop it with `node cli/flow.mjs stop`. Use `npm run dev` to run the development server in the foreground.

For an image-processing trial without cloud inference:

```sh
node cli/flow.mjs run \
  --seed-image ./public/assets/paper-seed.png \
  --prompt "Explore violet and warm peach" \
  --provider local-color --model color-study \
  --count 4 --concurrency 4 --wait
```

Local color lab applies seeded color operations to the input. It is not a generative model. For AI generation, configure a provider in **Settings → Providers**. Local models and SAM are optional downloads in Settings; a normal installation does not download weights.

## Work on the canvas

- Add reference images and write the shared direction once.
- Use a Prompt Set for named scenes with per-scene copy, seed and aspect-ratio overrides.
- Select a provider and model on each generation branch, or compare several modes using the same inputs.
- Plan a batch before running it. Concurrency limits the queue; provider rate limits and hardware still apply.
- Open any image to inspect its complete saved inputs and lineage.
- Select image regions with SAM, attach inline comments, and send the request to an agent. AI edits regenerate the whole image using annotations as guidance. Local recoloring uses the selected mask and retains regions across versions.

The page-aware agent can propose workflow edits. Applying a proposal does not start image generation. Projects associate workflows and assets with a consuming local folder. Workflow edits, jobs, conversations and asset annotations persist across refreshes.

## Providers

Flow has separate adapters for Codex, Claude Code, Gemini CLI, Pi, OpenAI-compatible APIs, Google video APIs, Grok, fal, Ollama and ComfyUI. Available media, models and thinking controls depend on the adapter and account. The app checks prerequisites before submitting a run.

CLI harnesses use installed commands and their supported authentication. Compatible APIs use your configured base URL, model and API key. Flow does not route every provider through Pi. A consumer subscription does not automatically authorize a separately billed image or video API. See [provider setup](docs/PROVIDERS.md), [local models](docs/local-models.md) and [fal and Seedance](docs/fal-and-seedance.md).

Codex image access depends on the installed CLI and account. Its numeric seeds are variation labels, not deterministic model RNG seeds. Requested sizes can differ from returned dimensions. Failed jobs stay visible and never fall back to another provider without your choice.

The style catalog includes reusable style and scene prompts. Generated thumbnails, custom references and favorites belong to each local workspace; a fresh clone does not include the development machine's image library. See [styles](docs/styles.md).

## Use Flow from an agent

The CLI, HTTP client and MCP server use the same platform services as the UI.

```sh
node cli/flow.mjs guide --json
node cli/flow.mjs schema --json
node cli/flow.mjs workflows --json
node cli/flow.mjs plan --workflow WORKFLOW_ID --json
node cli/flow.mjs run --workflow WORKFLOW_ID --concurrency 4 --json
node cli/flow.mjs wait RUN_ID --timeout 600 --json
node cli/flow.mjs open WORKFLOW_ID
```

`--count` means copies per prompt variation and generation mode. Use `plan` to check the total before inference. A timeout does not cancel server work. Keep the returned run ID and inspect or retry it rather than submitting the same batch again.

To install Flow's workflow, image-editing and style-library skills for your user account:

```sh
npm run setup
node cli/flow.mjs skills status --json
```

Setup builds the app and installs managed skills into `~/.agents/skills` and `~/.claude/skills`. It preserves unrelated or locally modified skills. Plain `npm ci` does not install global skills or sign into providers.

Use [AGENTS.md](AGENTS.md) for source navigation, [the agent guide](docs/agents.md) for project registration and batches, and [MCP setup](docs/mcp.md) for agent-host configuration. Existing `weft` CLI aliases, `WEFT_*` variables and `.weft-project.json` pointers remain supported.

## Data and security

The server binds to `127.0.0.1`. It is intended for a trusted local account and has no multi-user authentication. Do not expose it publicly. Cloud providers receive submitted prompts and reference images; local runtime adapters do not automatically fall back to cloud inference.

`.weft/` holds the database, uploads, generated assets, provider connections and logs. It is excluded from Git. Use the public client or API for changes, rather than editing the database or JSON mirrors. Back up the complete data directory while the server is stopped.

Set `WEFT_DATA_DIR` to move storage, `PORT` to change the server port, and `WEFT_URL` to point clients at a different local address. Custom data directories need the same credential protection and Git exclusions. Read [SECURITY.md](SECURITY.md) before changing the server's exposure or execution model.

## Develop

```sh
npm ci
npm run check
npm run check:release
```

`check` runs architecture checks, behavior tests and the production build. Tests use local fixtures and fake provider transports; they do not prove live account access. See [CONTRIBUTING.md](CONTRIBUTING.md) and [the architecture map](docs/ARCHITECTURE.md).

## License

Flow source is MIT licensed. Fonts, provider marks, dependencies and downloaded models retain their own terms. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). The npm package remains private.
