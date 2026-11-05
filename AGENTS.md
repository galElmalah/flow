# Flow: agent entrypoint

Flow is a local canvas and execution platform for image and video workflows. Read [README.md](README.md) for setup and the complete agent command sequence. Keep website work local; never deploy or publish to ChatGPT Sites.

## First clone

Use Node.js 22.13+ and npm on macOS/Linux. From the checkout:

```sh
npm ci
npm run setup
npm run verify:setup
node tools/demo.mjs --json
```

Setup installs managed user skills; it never configures accounts or downloads weights. Verification is an isolated integration check: temporary database/port/skills, no inherited credentials, no external fetches, four local outputs, lineage and MCP. It cleans up afterward. The demo is persistent local-only processing and returns real `projectId`, `workflowId`, `runId`, `url` and output asset IDs. Reopening it does not duplicate jobs or overwrite edits. Use those IDs to inspect/fork a working example instead of guessing a graph schema or relying on the author's projects.

A fresh clone contains no personal gallery, credentials, SAM weights or provider login. Missing AI providers are setup requirements, not a reason to invent outputs or fall back to another account. Configure the selected provider through the platform before requesting AI inference.

## Start a task

Run commands from this checkout, or use the installed `flow-workflows` skill helper by absolute path from a consuming project. Do not assume a shell alias exists.

```sh
node cli/flow.mjs serve --json
node cli/flow.mjs guide --json
node cli/flow.mjs schema --json
node cli/flow.mjs providers --json
node cli/flow.mjs projects --search NAME --json
node cli/flow.mjs workflows --project PROJECT_ID --json
```

A consuming project's `flow.project.json` identifies its local server, project and optional default workflow. Initialize it with `project init --project PROJECT_ID --root /absolute/project --json`. Explicit flags override discovered values. The platform's registered default is authoritative.

Read a workflow before editing. Fork shared work or a recorded run, then save the complete graph through the supported client/API using its current `revision`. Stale writes return HTTP 409. Graph edits and planning do not start inference.

```sh
node cli/flow.mjs workflow WORKFLOW_ID --project PROJECT_ID --json
node cli/flow.mjs fork WORKFLOW_ID --project PROJECT_ID --name "My study" --json
node cli/flow.mjs plan --workflow FORK_ID --project PROJECT_ID --json
node cli/flow.mjs run --workflow FORK_ID --project PROJECT_ID --concurrency 4 --json
node cli/flow.mjs wait RUN_ID --project PROJECT_ID --timeout 600 --json
node cli/flow.mjs open FORK_ID --project PROJECT_ID
```

Creation and forks return `id`. CLI `run --json` without `--wait` returns `runId`; HTTP/client/MCP run submission and completed run documents use `id`. Keep that ID: a client timeout does not cancel server work. Inspect, resume or retry that run rather than resubmitting. `--count` means copies per record/scene and generation mode, not the total. Check planned job counts first.

Workflow files use `*.flow.json` with `{format:"flow",version:1,workflow:{...}}`. Canvas and CLI exports use the same schema. Legacy plain graph JSON remains readable. See [Flow files](docs/flow-files.md), `GET /api/schema/flow`, and the JavaScript client's `toFlowFile`/`fromFlowFile` helpers.

## Navigate the source

| Change                               | Start here                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| First-run demo / clone verification | `cli/demo.mjs`, `tools/demo.mjs`, `tools/verify-setup.mjs` |
| Agent API, CLI and MCP               | `client/index.mjs`, `cli/flow.mjs`, `mcp/server.mjs`, [agent guide](docs/agents.md), [MCP setup](docs/mcp.md)                 |
| Project ownership and discovery      | `client/project-context.mjs`, `shared/projects.mjs`, `server/projects.mjs`, `src/projects/`                                   |
| Graph schema, planning and queue     | `shared/graph.mjs`, `server/graph.mjs`, `server/queue.mjs`                                                                    |
| Workflow files and upgrades          | `shared/flow-file.mjs`, `cli/migration.mjs`, `server/store.mjs`, [file format](docs/flow-files.md)                            |
| Persistence and HTTP routes          | `server/store.mjs`, `server/routes/`; `server/index.mjs` composes services                                                    |
| Canvas nodes and interaction         | `src/nodes/`, `src/canvas/`; register nodes in `index.mjs` and `catalog.mjs`                                                  |
| Prompt collections                   | `shared/prompt-sets.mjs`, `src/nodes/PromptSetNode.jsx`, `src/panels/PromptSetEditor.jsx`, [Prompt Sets](docs/prompt-sets.md) |
| Inline agent and streaming           | `shared/agent.mjs`, `server/agent/`, `src/agent/`, [agent guide](docs/inline-agent.md)                                        |
| Providers and credentials            | `harness-integrations/registry.mjs`, each provider's directory, [provider setup](docs/PROVIDERS.md)                           |
| Local models and SAM                 | `harness-integrations/local-runtime/`, `image-tools/segmentation/`, `src/settings/`, [local models](docs/local-models.md)     |
| Image regions, comments and versions | `server/image-editor/`, `shared/image-editor.mjs`, `src/image-editor/`, [versions](docs/image-versions.md)                    |
| Asset lineage and search             | `server/assets.mjs`, `shared/assets.mjs`, `server/search/`, `src/media/useAssetLineage.mjs`                                   |
| Styles and reusable rules            | `shared/styles/`, `server/styles.mjs`, `src/styles/`, `shared/rule-templates.mjs`                                             |
| Skills installed for agents          | `skills/`, `cli/skills.mjs`, [skill setup](docs/agent-skills.md)                                                              |
| Tracing and latency                  | `observability/`, `src/agent/AgentTiming.jsx`, [OpenTelemetry](docs/observability.md)                                         |

Use [the architecture map](docs/ARCHITECTURE.md) for subsystem boundaries. UI choices use `src/components/Autocomplete.jsx`. Background tabs release SSE streams and refresh durable state when visible again; see `src/studio/workspace-events.mjs`.

## Preserve these contracts

- Durable workspace changes go through the client, CLI, MCP or HTTP API. SQLite and JSON mirrors are not editing interfaces.
- Never put credentials in prompts, graphs, exports, source, tests or `flow.project.json`. Private state is in ignored `.flow/`. The server binds to loopback and is for a trusted local account, without multi-user authentication.
- Jobs retain exact resolved prompts, reference URLs, model/settings, record IDs and ancestry. Do not rewrite historical run snapshots to rename a label or migrate an identifier.
- Use the selected provider explicitly. CLI subscriptions do not authorize separately billed APIs. Failed generation never silently switches providers or creates placeholders.
- Codex numeric seeds are variation labels; they are not reproducible model RNG seeds. Inspect actual output dimensions instead of assuming the requested size.
- GIFs use `generate` → `output`, with `data.image:{outputFormat:"gif",frameCount:9,frameDurationMs:200}`; one job is one animation. Codex/native uses a generated sprite sheet plus local assembly. GPT Image 2.6 API models also offer native GIF/SVG (text-only) and complexity, with separate API credentials. Read [image formats](docs/image-outputs.md) and live provider `modelDetails`; never claim a pinned native image model or silently flatten animations.
- AI image edits default to whole-image regeneration, using region comments as guidance without hard-mask compositing. Local recoloring preserves pixels outside the selected mask and carries regions forward. Explicit advanced region edits can leave seams. Whole-image versions need fresh segmentation when geometry changes.
- Test providers with fake transports and synthetic data. Keep live account access and inference verification separate from unit-test claims.
- Normal installation does not download model weights. Model setup and downloads use managed runtime services and retain progress/error state. Local inference does not automatically fall back to cloud.
- Skills install through `npm run setup` or `node cli/flow.mjs skills install --json`. Preserve unrelated or locally modified user skills.

## Verify and contribute

```sh
npm run check
npm run check:release
```

`check` validates module boundaries, builds the UI and runs behavior tests. Verify changed UI behavior in the real browser. CI also scans full Git history for credentials. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). The repository remains private; public-release gaps are tracked in [the release checklist](docs/open-source-readiness.md).
