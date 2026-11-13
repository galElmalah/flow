# Flow: agent entrypoint

Flow is a local canvas and execution platform for image and video workflows. Start with [SETUP.md](SETUP.md) for installation and the complete tested agent command sequence. Read [README.md](README.md) for product capabilities. Never deploy or publish to ChatGPT Sites; the public website is maintained only as described in [Public website and docs](#public-website-and-docs).

## Where Flow lives

| What                         | Location                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Source (public, MIT)         | https://github.com/galElmalah/flow                                                                    |
| Landing page                 | https://gal.overto.work/flow-landing/flow/                                                            |
| Documentation                | https://gal.overto.work/flow-landing/docs/                                                            |
| The Flow app, CLI, SDK, MCP  | Your computer. There is no hosted Flow app; the server listens on `http://localhost:4310` by default. |

The landing page and docs are static sites built from this repository. They never connect to a Flow server or account. To use Flow, clone it and follow [SETUP.md](SETUP.md). Discover the interfaces from the checkout: `node cli/flow.mjs help --json` and `node cli/flow.mjs help COMMAND --json` work offline; `guide`, `schema` and `providers` describe the running local server. The SDK is `import { FlowClient } from "flow"` ([installation](docs/installation.md)); MCP host setup is in [docs/mcp.md](docs/mcp.md).

## First clone

Use Node.js 22.13+ and npm on macOS/Linux. From the checkout:

```sh
npm ci
npm run setup
npm run verify:setup
node tools/demo.mjs --json
```

Setup installs the `flow` launcher in `~/.local/bin` and managed user skills; it never configures accounts or downloads weights. It reports when PATH needs updating and preserves foreign commands. Verification is an isolated integration check: temporary home/database/port/skills, no inherited credentials, no external fetches, four local outputs, lineage and MCP. It cleans up afterward. The demo is persistent local-only processing and returns real `projectId`, `workflowId`, `runId`, `url` and output asset IDs. Reopening it does not duplicate jobs or overwrite edits. Use those IDs to inspect/fork a working example instead of guessing a graph schema or relying on the author's projects.

After setup, `flow --version` works offline from any directory; use the printed absolute launcher path when its directory is not on PATH. `npm run cli:install` installs only that launcher. Set `FLOW_BIN_DIR` for another location. Run it again after moving the checkout; foreign/stale launchers are never overwritten. For a consuming Node.js project, `npm install /absolute/path/to/flow` enables `import { FlowClient } from "flow"`; the style catalog is exported as `flow/styles`. Read [CLI/SDK installation](docs/installation.md).

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
node cli/flow.mjs run --workflow FORK_ID --project PROJECT_ID --concurrency 4 --request-id BATCH_ID --json
node cli/flow.mjs wait RUN_ID --project PROJECT_ID --timeout 600 --json
node cli/flow.mjs open FORK_ID --project PROJECT_ID
```

Creation, forks and run submission return full documents with `id` (MCP wraps the document in `structuredContent.data`). Keep that ID: a client timeout does not cancel server work. Inspect, resume or retry that run. The optional `--request-id` makes submission retries safe: the same key and request return the existing run, including after restart; changed options return409 `REQUEST_ID_REUSED` with `runId`. New intended batches need a new key. `--count` means copies per record/scene and generation mode, not the total. Check planned job counts first. Concurrency is a per-run ceiling and never changes another run's limit.

`flow help run --json` and `flow run --help --json` work offline and return accepted flags, value constraints, effects and examples. Invalid or irrelevant flags fail before uploads, project discovery or network calls. CLI `--json` failures write `{error:{message,code,status?,runId?,blockers?}}` to stderr and exit nonzero; stdout is reserved for successful results. Planning accepts a saved workflow only and never uploads references. Use explicit workflow creation/import first.

Workflow files use `*.flow.json` with `{format:"flow",version:1,workflow:{...}}`. Canvas and CLI exports use the same schema. Legacy plain graph JSON remains readable. See [Flow files](docs/flow-files.md), `GET /api/schema/flow`, and the JavaScript client's `toFlowFile`/`fromFlowFile` helpers.

## Navigate the source

| Change                                | Start here                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| First-run demo / clone verification   | `cli/demo.mjs`, `tools/demo.mjs`, `tools/verify-setup.mjs`                                                                    |
| Agent API, CLI and MCP                | `client/index.mjs`, `cli/flow.mjs`, `mcp/server.mjs`, [agent guide](docs/agents.md), [MCP setup](docs/mcp.md)                 |
| User CLI installation and SDK exports | `cli/install.mjs`, `tools/setup.mjs`, `package.json`, [installation](docs/installation.md)                                    |
| Project ownership and discovery       | `client/project-context.mjs`, `shared/projects.mjs`, `server/projects.mjs`, `src/projects/`                                   |
| Graph schema, planning and queue      | `shared/graph.mjs`, `server/graph.mjs`, `server/queue.mjs`                                                                    |
| Workflow files and upgrades           | `shared/flow-file.mjs`, `cli/migration.mjs`, `server/store.mjs`, [file format](docs/flow-files.md)                            |
| Persistence and HTTP routes           | `server/store.mjs`, `server/routes/`; `server/index.mjs` composes services                                                    |
| Canvas nodes and interaction          | `src/nodes/`, `src/canvas/`; register nodes in `index.mjs` and `catalog.mjs`                                                  |
| Prompt collections                    | `shared/prompt-sets.mjs`, `src/nodes/PromptSetNode.jsx`, `src/panels/PromptSetEditor.jsx`, [Prompt Sets](docs/prompt-sets.md) |
| Inline agent and streaming            | `shared/agent.mjs`, `server/agent/`, `src/agent/`, [agent guide](docs/inline-agent.md)                                        |
| Providers and credentials             | `harness-integrations/registry.mjs`, each provider's directory, [provider setup](docs/PROVIDERS.md)                           |
| Local models and SAM                  | `harness-integrations/local-runtime/`, `image-tools/segmentation/`, `src/settings/`, [local models](docs/local-models.md)     |
| Image regions, comments and versions  | `server/image-editor/`, `shared/image-editor.mjs`, `src/image-editor/`, [versions](docs/image-versions.md)                    |
| Asset lineage and search              | `server/assets.mjs`, `shared/assets.mjs`, `server/search/`, `src/media/useAssetLineage.mjs`                                   |
| Styles and reusable rules             | `shared/styles/`, `server/styles.mjs`, `src/styles/`, `shared/rule-templates.mjs`                                             |
| Skills installed for agents           | `skills/`, `cli/skills.mjs`, [skill setup](docs/agent-skills.md)                                                              |
| Tracing and latency                   | `observability/`, `src/agent/AgentTiming.jsx`, [OpenTelemetry](docs/observability.md)                                         |
| Public landing page and docs site     | `website/landing/`, `website/docs/`, `tools/build-docs.mjs`, [website guide](website/README.md)                                |

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

`check` validates module boundaries and unused code, builds the UI and runs behavior tests. `check:unused` follows package exports, scripts, browser entries, tests and the explicit dynamic entrypoints in `knip.jsonc`. Before deleting a reported item, check external SDK consumers, provider subprocesses, worker paths, installed skills and documented standalone tools. Add an exact dynamic entrypoint only when it has a real caller; avoid broad ignores. Verify changed UI behavior in the real browser. CI also scans full Git history for credentials. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). The repository is public; remaining release items are tracked in [the release checklist](docs/open-source-readiness.md).

## Public website and docs

Both sites are static bundles built from this checkout. Markdown is the docs source; `website/landing/site/` is the landing source. Build and check locally:

```sh
npm run docs:build       # → website/build/docs/ (ignored) + website/build/docs.manifest.json
npm run landing:examples # only after changing the landing example code
npm run landing:verify   # landing examples against this checkout; no inference
```

Edit Markdown, not generated HTML. Public docs pages are declared in `website/docs/inventory.mjs`; only non-ignored repository files can be added. The docs design (shell, CSS, browser script) lives in `website/docs/`. Links between bundled pages stay in the same frame; every other destination, including GitHub and the other Overto artifact, needs `target="_blank" rel="noopener"` because Overto shows sites in an iframe and GitHub refuses framing ([incident](docs/overto-navigation.md)).

Redeploy only when the user asks, and only through the authorized Overto connection for workspace **Gal** (`https://gal.overto.work`):

1. Target project `flow-landing`. Artifact slug `flow` is the landing page (bundle `website/landing/site/`); slug `docs` is the documentation (bundle `website/build/docs/`). Do not create a different slug, project or workspace for an existing site.
2. Upload the complete bundle: every file in the directory, or every entry of `website/build/docs.manifest.json` for the docs. Entry `index.html`, no SPA fallback. A partial manifest removes pages. The docs manifest is an inventory, not the publish request; build the request as described in [website/README.md](website/README.md#publishing-request), after reading the current Overto MCP tool schema.
3. Read the artifact's current version immediately before publishing and pass it as the version fence. If the publish is rejected because the version changed, reread that newer version, review what changed, reconcile your bundle with it and retry with the new version as the fence; never drop the fence. A routine conflict does not need new confirmation, because the user's publishing authorization still applies. Ask only if the competing edit cannot be safely reconciled within the authorized task. Only the first `docs` publication has no previous version.
4. Both sites are public. Read and preserve the current audience; never change it as a side effect. The first `docs` publication inherits the project's audience, and passing a visibility field to `overto_publish` does not create a public audience. After that first publish, read the artifact's metadata and explicitly set `docs` to public using the observed permission revision and current version; the owner has authorized a public audience for `docs`. Later updates keep that public audience. Never publish private artifacts, private review reports, workspace data, credentials or `.flow/` content to make a link work.
5. Afterwards open the actual hosted URLs, not a local preview. Click header Docs (opens a new tab), nested docs pages and back links, images, downloads, copy buttons and external links. Report only what you observed.

Commands and the file inventory are in [website/README.md](website/README.md).
