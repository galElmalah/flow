# Flow: start here

Flow is the local platform for creating, planning and running image and video workflows. Keep it
local. Never deploy or publish to ChatGPT Sites. Use the supported client, CLI or HTTP
API for live data; SQLite and JSON mirrors are not editing interfaces.

## Find the code

| Task                                           | Start here                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Bundled agent skills / user-wide setup | `skills/`, `cli/skills.mjs`, `docs/agent-skills.md`; `npm run setup` or `node cli/flow.mjs skills install --json` |
| Agent model picker / thinking controls | `docs/provider-model-picker.md`, `shared/reasoning.mjs`, `src/agent/HarnessModelPicker.jsx`; native Ollama HTTP, separate CLI harnesses; no implicit Pi routing |
| Persistent in-app agent and path navigation | `docs/inline-agent.md`, `shared/agent.mjs`, `server/agent/`, `src/agent/`, `shared/viewer-routes.mjs` |
| Streaming latency / local OpenTelemetry | `docs/observability.md`, `observability/tracing.mjs`, `src/agent/AgentTiming.jsx`; `flow agent trace SESSION TURN --project ID --json`; MCP `read_agent_trace` |
| Use Flow from an agent                         | `docs/agents.md`, `client/index.mjs`                                                                                    |
| Human/agent operation coverage                 | `docs/qa/agent-capability-matrix.md`; `docs/qa/platform-audit.md`                                                       |
| MCP tools over stdio                           | `docs/mcp.md`, `mcp/server.mjs`; `node cli/flow.mjs mcp --project ID`                                                   |
| Open a workflow/node/run in the viewer         | `node cli/flow.mjs open --project ID --node NODE_ID`; `client/viewer.mjs`                                               |
| Find the base prompt and follow each flow      | `shared/prompt-guide.mjs`, `src/panels/PromptGuide.jsx`                                                                 |
| Image region editor / SAM masks / comments     | `image-tools/segmentation/`, `server/image-editor/`, `shared/image-editor.mjs`, `src/image-editor/`; `flow editor status` |
| Image versions / local recolor / masked edits | `docs/image-versions.md`, `image-tools/region-edit.mjs`, `test/image-versions.test.mjs`; `flow editor prepare --mode region\|recolor\|whole` |
| Visual style library and local references      | `docs/styles.md`, `shared/styles/catalog.mjs`, `server/styles.mjs`, `src/styles/StyleGallery.jsx`; `flow styles --json` |
| Reusable image rules and presets               | `shared/rule-templates.mjs`, `src/panels/RuleTemplates.jsx`; `flow rules --json`                                        |
| Create a workflow consistently                 | `client/workflows.mjs` (`createImageWorkflow`, `createVideoWorkflow`), `shared/graph.mjs`                                                      |
| Discover a consuming local project             | `client/project-context.mjs`, `.weft-project.json` in that repository                                                   |
| Project registration and ownership             | `shared/projects.mjs`, `server/projects.mjs`, `server/routes/projects.mjs`                                              |
| Codex, Claude Code, Gemini or Pi               | `harness-integrations/README.md`, then that engine's folder                                                             |
| Harness subscription usage / Gemini video research | `docs/harness-usage.md`, `harness-integrations/usage.mjs`, each engine's `usage.mjs`, `src/harnesses/`; `flow providers usage --json` |
| Grok image/video, comparison modes and asset lineage | `docs/grok-and-lineage.md`, `shared/generation-modes.mjs`, `harness-integrations/grok/`, `server/assets.mjs`, `shared/assets.mjs`; CLI `flow assets`, `flow asset lineage ID`, `flow dataset export` |
| fal / Seedance / Seedream media | `docs/fal-and-seedance.md`, `shared/fal.mjs`, `harness-integrations/fal/`; `flow providers fal`, MCP `configure_fal`; `node tools/verify-fal-catalog.mjs` |
| Native video nodes / MP4 / Google API auth | `docs/video-workflows.md`, `harness-integrations/gemini-video/`, `shared/media.mjs`, `src/nodes/VideoGenerateNode.jsx`; MCP `create_video_workflow` |
| MOSS-Image local setup | `shared/local-model-presets.mjs`, `src/settings/LocalModelPreset.jsx`; `flow local install moss-image-sft --wait`; BF16/INT8, text-to-image only, Mac inference experimental |
| Local prompt/image/video models and setup | `docs/local-models.md`, `shared/local-models.mjs`, `harness-integrations/local-runtime/`, `ollama/`, `comfyui/`; `flow local status`, `/settings/local-models` |
| Codex authentication sources | `shared/codex-connection.mjs`, `harness-integrations/codex/connection.mjs`, `src/settings/CodexSettings.jsx`; `flow providers codex`; local harness / isolated OAuth / API key |
| Bring your own key and endpoint                | `harness-integrations/openai-compatible/`                                                                               |
| Provider catalog, dispatch and preflight       | `harness-integrations/registry.mjs`                                                                                     |
| Workflow persistence and migration             | `server/store.mjs`                                                                                                      |
| Planning and job scheduling                    | `server/graph.mjs`, `server/queue.mjs`                                                                                  |
| HTTP routes                                    | `server/routes/`; `server/index.mjs` only composes the app                                                              |
| Canvas nodes                                   | `src/nodes/`; register a node in `index.mjs` and `catalog.mjs`                                                          |
| Prompt collections / shared scenes | `docs/prompt-sets.md`, `shared/prompt-sets.mjs`, `src/nodes/PromptSetNode.jsx`, `src/panels/PromptSetEditor.jsx`; CLI `--prompts FILE`, `--prompt-set ID --items IDs`; MCP `preview_prompt_item` |
| Canvas organization | `docs/canvas-organization.md`, `shared/graph-layout.mjs`, `src/canvas/layout-geometry.mjs`; `flow workflow organize ID --plan`; MCP `organize_workflow` |
| Canvas interaction and autosave                | `src/canvas/`; orchestration lives in `src/App.jsx`                                                                     |
| Multiple browser tabs / stalled images or saves | `src/studio/workspace-events.mjs`, `test/workspace-events.test.mjs`; hidden tabs release SSE connections and reconnect with a durable-state refresh |
| Canvas tool rail glass and accessibility | `src/canvas/tool-rail.css`; glass stays on a separate layer, with opaque contrast/transparency fallbacks and unclipped popovers |
| Collapsible top workspace menu | `src/components/WorkspaceNotch.jsx`, `workspace-notch.css`; proximity opens, click/touch and keyboard are supported, history/properties/status live inside |
| Properties, gallery input tray, provider setup | `src/panels/`                                                                                                           |
| Click-through image provenance | `shared/asset-inspection.mjs`, `src/media/useAssetLineage.mjs`, `src/panels/AssetDetails.jsx`; Lineage opens first, source images are inspectable, editor uses `AssetLineagePanel.jsx` |
| Projects home and recoverable archive          | `src/projects/ProjectsPage.jsx`, `shared/archive.mjs`; `flow open --projects`, `flow projects --search TEXT` |
| Settings page and SAM setup status | `src/settings/`, `/settings/workspace`, `/settings/providers`, `/settings/image-tools`; SAM status/setup use `/api/image-editors/status` and `/api/image-editors/setup` |
| SAM cold start / setup errors / editor continuation | `docs/settings.md`, `src/components/SamSetup.jsx`, `src/image-editor/model-state.mjs`, `test/sam-setup.test.mjs`; `docs/qa/sam-clean-install/` |
| Project selector                               | `src/projects/WorkflowMenu.jsx`                                                                                         |
| Dropdown autocomplete                          | `src/components/Autocomplete.jsx` (use this for every choice control)                                                   |
| Semantic image search                          | `server/search/`, `server/routes/search.mjs`, `client.searchImages()`                                                   |
| Quoture's two flows                            | `examples/quoture/`; its consuming project is the local `ios-app` repository                                            |

## Agent workflow

```sh
node cli/flow.mjs serve --json
node cli/flow.mjs guide --json
node cli/flow.mjs open --projects
node cli/flow.mjs projects --search quoture --json
node cli/flow.mjs workflows --project quoture --json
node cli/flow.mjs open --project quoture --node shared-style
node cli/flow.mjs fork quoture-10-studies --project quoture --json
node cli/flow.mjs plan --workflow FORK_ID --project quoture --node collection --json
node cli/flow.mjs run --workflow FORK_ID --project quoture --node collection --wait --json
```

Run these commands from this folder, or invoke the CLI by absolute path. From a consuming
repository, its nearest `.weft-project.json` supplies the server, project and default workflow.
Explicit flags override discovery. `docs/agents.md` covers registration, creation, uploads,
records, BYOK, run control and the JavaScript client. `GET /api` discovers routes;
`GET /api/guide/agents` serves the task guide; `GET /api/schema/workflow` returns JSON Schema.

The main Quoture canvas starts at `shared-style` (Shared · engraving & scenery). Its quote
and cover scene templates combine the shared direction with individual source records;
Claude writes scene briefs, role-specific artwork templates add rules, and Codex generates
images. Use the UI's Start here map to
find the real text source. Viewer run links open a read-only recorded graph; fork to edit.

Rules are full snapshots in `node.data.rules` on prompt, template, prompt-generate or
generate nodes. Enabled rules follow downstream branches and are included in both
text and image job prompts. Discover built-ins and presets with `flow rules --json`
or MCP `list_rule_templates`. Custom library rules live in the platform's SQLite
metadata and are shared across projects. Editing the library never edits applied
workflow rules or historical runs. Rules guide models; they do not verify distinct
faces or scenery across outputs. Use explicit scene/cast fields for batch variety.

Custom gallery entries use `flow style create --from style.json --seed-image ./reference.png`
and `flow style update ID --from changes.json`; MCP `create_style` / `update_style`
and client `createStyle` / `updateStyle` expose the same operations. Store style/scene
prompts, tags, categories and optional per-reference scene, prompt and attribution.
Upload images first or reuse a completed output with its real run/job IDs. Updates
replace `references` only when supplied; existing workflow snapshots stay unchanged.
See `docs/styles.md` for inputs. Never edit the built-in catalog to save user content.

Plan before inference. Copies multiply at each generation stage; scope `--node` or set
copies on the intended node. Save the returned run ID: another `run` creates another run.
Fork shared workflows before edits. Ownership is explicit, and a run keeps its original
project and workflow snapshots. Historical unassigned runs stay unassigned.

## Boundaries and verification

- Harnesses execute in isolated job directories, never in the owning project's root.
- Keep authentication and keys in their integration's private configuration. Never put
  them in workflow graphs, project manifests, exports, screenshots or logs.
- BYOK uses direct OpenAI-compatible HTTP calls. Pi is a separate selectable harness.
- Preserve provider IDs and truthful capabilities. Installed does not mean authenticated;
  fixture protocol tests do not prove account access. No silent provider fallback.
- Use the current local platform for Quoture generation; selected iOS assets have their
  own review and registration rules in that project's `AGENTS.md`.
- `npm run check` checks import boundaries, runs behavior tests, then builds the UI.
  Verify UI changes through the real local browser. Use local-color for processing checks
  without inference usage; prompt-generation nodes still invoke their selected text harness.
- Recorded-run viewers allow inspection and downloads. Fork the run snapshot to
  edit or run it; CLI `fork WORKFLOW_ID --run RUN_ID` and MCP `fork_workflow`
  with `runId` preserve the historical graph. Reopen a workflow from the menu to
  fetch current agent edits; unsaved local drafts remain local drafts.

Read `docs/ARCHITECTURE.md` for the layout decision and `docs/VERIFICATION.md` for evidence.

Image editing starts in an image's inspector with **Edit image regions**. Local SAM 2.1
proposes masks; a separate vision harness auto-names them (default Codex). `docs/image-region-names.md` covers naming, provider choice, local-only opt-out and manual-name protection. Hover highlights and Shift-click selects several. Pick missing region
uses a point prompt. Mask layers support names, visibility, locks and order; comments
attach to stable region IDs and optional normalized image coordinates. Clicking a region opens its inline composer; Shift-click adds targets. Numbered pins reopen comments. AI region edits save the active draft and include open comments. Image versions shows durable family progress/results; selecting a version opens it for continued editing. Region edits and local recolors inherit masks, names and comments; whole-image regeneration starts fresh segmentation. See `docs/image-versions.md`.
SQLite persists editor documents separately from immutable
runs. `docs/agents.md` covers the editor API, CLI and MCP. Read the current revision
before PATCH/prepare. Preparing an edit creates a new workflow with the original,
annotation map and union mask, plus a transparent cutout export; it never starts
inference. `flow editor send EDITOR_ID REQUEST_ID` and MCP `send_image_edit` dispatch the immutable prepared snapshot through provider preflight and the local queue.
Repeated sends of one request reuse the same run, including after restarts. `flow editor variations ID` / MCP `list_image_variations` / client `imageVariations(id)` read the same results with original-image lineage. Read `segmentation.progress` for actual model stages and completed prompt batches.
AI edits default to `whole`: regenerate the full image, with region annotations and comments as guidance. Inline Send to agent uses this mode to avoid visible hard-mask seams. Keep the sports pink-jersey example as the local `recolor` demonstration. Codex uses advisory image references, not native strict inpainting. Explicit advanced `region` edits
are composited locally through the frozen mask before completion; `recolor` edits
also preserve decoded RGBA pixels outside that mask exactly. Historical requests
without an edit mode do not have that guarantee. AI content and inherited mask
boundaries still need review when geometry changes. Whole-image regeneration may
change every pixel.

The bottom-toolbar agent uses existing text harnesses and persists project conversations in SQLite.
Codex chat defaults to medium reasoning; per-ask `reasoningEffort` (CLI `--reasoning`) overrides only that chat turn. Live UI updates share the scoped `/api/events` connection and reject stale `streamRevision` values. Streamdown renders smooth incoming Markdown; see `docs/qa/smooth-chat/`. Pending turns include a safe `preview.text` from real provider output. Only the final
validated `answer` enables edits. CLI/MCP conversation reads expose the same preview;
see `docs/inline-agent.md` for adapters and cancellation behavior.
`flow agent ask --project ID --workflow ID --prompt "..."` produces a typed proposal;
`agent apply SESSION TURN` commits it, and `agent undo SESSION TURN` conditionally restores it.
MCP exposes the same conversation operations. See `docs/inline-agent.md`. Model output
never executes shell commands. Chat edits do not start image generation. All workflow
PUT requests retain the current graph `revision`; stale writes fail409. Viewer links
use `/project/PROJECT_ID/workflow/WORKFLOW_ID` and resource paths, with legacy query
links accepted only as input.

Native video generation uses `video-generate` → `video-output` with a prompt and optional image references. Use the same create/plan/run/inspect/open operations as images. Google API key or public ADC OAuth credentials belong in the private Gemini video connection; coding CLI login and Flow subscription credits do not authorize API billing. Queued video jobs preserve accepted interaction IDs for resume; never erase an uncertain submission receipt to retry a paid POST. MP4 outputs remain video artifacts and cannot enter SAM, image sockets, or style-image references. See `docs/video-workflows.md`.

Generate comparisons with node.data.modes or recipe `modes`: `{id,label,providerId,model?,count?,ratio?,quality?,image?,video?}`. Shared inputs fan out once per mode/copy through the same queue. Use `--modes FILE` on workflow creation/import and review plan.modes totals. New generated assets have stable IDs, SHA256 fingerprints, frozen input snapshots and parent links; the image inspector’s `Lineage` and `Labels` tabs and the asset API expose the same provenance. Historical observations are marked partial. Annotations are revisioned separately; dataset JSONL and run ZIP assets.jsonl join that latest annotation revision without changing generation history. Grok uses native xAI credentials; its subscription login is not a local API credential. See `docs/grok-and-lineage.md`.

Local setup belongs to `RuntimeManager`; local inference belongs to the native Ollama/ComfyUI adapters. Use the same public client/CLI/MCP as the UI. Never mutate model receipts or private runtime config directly. No local-model request falls back to cloud. Comfy profiles are model IDs, with explicit API graph input/output bindings; preflight validates installed node/model dependencies. Preserve accepted operation snapshots even if a profile is renamed or removed. All local providers share one queue lane to protect GPU memory while hosted modes keep their normal concurrency. See `docs/local-models.md` and `docs/qa/local-models/`.
