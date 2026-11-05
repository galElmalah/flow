# Flow

Generate still images and animated GIFs in the same image node. Codex GIFs use generated sprite sheets with local assembly; explicit GPT Image 2.6 API connections also support native GIF, static SVG and complexity controls. See [image output formats](docs/image-outputs.md) for agent commands and provider requirements.

A local canvas for image and video generation. Connect seed images, shared prompts and scene collections, then run parallel batches across CLI harnesses, hosted APIs or local models. Every output keeps its resolved prompt, settings, source references and generation lineage.

Flow is pre-release. This repository remains private while it is prepared for an open source release. See the [release checklist](docs/open-source-readiness.md).

## Run locally

Requires Node.js 22.13 or newer and npm. Python and GPUs are optional unless you enable a local model. Existing installations should follow [the migration guide](docs/flow-files.md#upgrade-an-existing-weft-installation) first. Start without provider credentials:

```sh
git clone https://github.com/galElmalah/flow.git
cd flow
npm ci
npm run setup
npm run serve
```

Setup builds the app and installs its agent skills for your user account. It does not sign in, download model weights or start inference. If you only want the UI, use `npm run build` instead of setup.

Open **http://localhost:4310**. The server runs in the background and stores local state in `.flow/`. Stop it with `node cli/flow.mjs stop`. Use `npm run dev` to run the development server in the foreground.

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

Read [AGENTS.md](AGENTS.md) first. The CLI, JavaScript client and MCP server use the same platform services as the UI. All commands below run from this checkout. From a consuming project, use the installed `flow-workflows` skill helper by its absolute path.

Register an existing local project once. This writes its local `flow.project.json` pointer without generating images:

```sh
node cli/flow.mjs project init --project my-app --name "My app" \
  --root /absolute/path/to/my-app --json
```

Use this sequence for each task:

```sh
node cli/flow.mjs guide --json
node cli/flow.mjs schema --json
node cli/flow.mjs providers --json
node cli/flow.mjs workflows --project my-app --json
node cli/flow.mjs workflow create --project my-app --name "Seed study" \
  --seed-image ./public/assets/paper-seed.png --prompt "Explore violet and warm peach" \
  --provider local-color --model color-study --count 4 --json
node cli/flow.mjs plan --project my-app --workflow WORKFLOW_ID --json
node cli/flow.mjs run --project my-app --workflow WORKFLOW_ID --concurrency 4 --json
node cli/flow.mjs wait RUN_ID --project my-app --timeout 600 --json
node cli/flow.mjs open WORKFLOW_ID --project my-app
```

Creation returns `id`: use it as `WORKFLOW_ID`. Planning returns `total`, `imageJobs`, `textJobs` and `videoJobs`; inspect those before running. Submission returns `runId`: use it as `RUN_ID`. Waiting returns the completed run and its jobs. `open` launches the viewer; add `--print-url` to return its URL without opening a browser.

Read or fork existing workflows before changing them. Save through the client/API with the current `revision`; a stale save returns HTTP 409. For results, use `inspect RUN_ID`, `gallery --project my-app`, and `asset lineage ASSET_ID`. Never place keys in graph nodes, prompts or project pointers.

`--count` means copies per prompt variation and generation mode. Use `plan` to check the total before inference. A timeout does not cancel server work. Keep the returned run ID and inspect or retry it rather than submitting the same batch again.

To install Flow's workflow, image-editing and style-library skills for your user account:

```sh
npm run setup
node cli/flow.mjs skills status --json
```

Setup builds the app and installs managed skills into `~/.agents/skills` and `~/.claude/skills`. It preserves unrelated or locally modified skills. Plain `npm ci` does not install global skills or sign into providers.

Use [AGENTS.md](AGENTS.md) for source navigation, [the agent guide](docs/agents.md) for project registration and batches, and [MCP setup](docs/mcp.md) for agent-host configuration. The canonical command is `flow`, installed with optional `npm link`, or `node cli/flow.mjs`. Configuration uses `FLOW_*` variables.

## Save and exchange workflows

The file format is **Flow**, with the extension **`.flow.json`**. Both the canvas and CLI export a versioned JSON file with `format: "flow"`, `version: 1` and a `workflow` graph.

```sh
node cli/flow.mjs export WORKFLOW_ID --project my-app --output campaign.flow.json
node cli/flow.mjs import --from campaign.flow.json --project my-app --json
```

Files preserve prompts, references, settings and graph structure. They do not bundle image bytes or provider keys. Earlier plain graph JSON is still importable. See [Flow files and migrations](docs/flow-files.md) for the schema and transfer rules.

## Data and security

The server binds to `127.0.0.1`. It is intended for a trusted local account and has no multi-user authentication. Do not expose it publicly. Cloud providers receive submitted prompts and reference images; local runtime adapters do not automatically fall back to cloud inference.

`.flow/` holds the database, uploads, generated assets, provider connections and logs. It is excluded from Git. Use the public client or API for changes, rather than editing the database or JSON mirrors. Back up the complete data directory while the server is stopped.

Set `FLOW_DATA_DIR` to move storage, `PORT` to change the server port, and `FLOW_URL` to point clients at a different local address. Custom data directories need the same credential protection and Git exclusions. Read [SECURITY.md](SECURITY.md) before changing the server's exposure or execution model.

## Develop

```sh
npm ci
npm run check
npm run check:release
```

`check` validates architecture, builds browser assets, then runs behavior tests. CI also scans the complete Git history with a pinned, checksum-verified Gitleaks binary. Tests use local fixtures and fake provider transports; they do not prove live account access. See [CONTRIBUTING.md](CONTRIBUTING.md) and [the architecture map](docs/ARCHITECTURE.md).

## License

Flow source is MIT licensed. Fonts, provider marks, dependencies and downloaded models retain their own terms. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). The npm package remains private.
