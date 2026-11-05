# Source layout and project ownership

Flow is one local platform serving multiple local projects. Workflows, run snapshots and
project records share its SQLite database. A consuming repository points to the platform;
it does not duplicate the workflow graph or credentials.

Three agents independently inspected the current runtime, the harness layer and the agent
workflow before implementation. We compared a domain/feature layout, an adapter-oriented
layout, and separate platform instances per consuming project. The chosen structure combines
small server domains with named harness adapters. Separate instances would duplicate provider
configuration and process lifecycle while splitting the gallery. A monorepo/package hierarchy
would add indirection without a second deployable service or a separate release lifecycle.

## Caller path

```text
consuming-repository/flow.project.json
  → CLI or client/index.mjs
  → server/routes/{projects,workflows,runs}.mjs
  → shared schema + project ownership validation
  → server/graph.mjs plan
  → server/queue.mjs durable jobs
  → harness-integrations/registry.mjs
  → the selected CLI or direct HTTP adapter
  → local run files + SQLite snapshots + SSE canvas updates
```

A manifest supplies `{version, projectId, serverUrl, defaultWorkflowId?}`. Context discovery
walks up from the caller's directory. Explicit options take precedence. The server rejects
a plan or run whose explicit project differs from its workflow's ownership, before invoking
a provider. A project root is metadata; subprocess working directories remain isolated.

## Ownership

- A registered project has a stable ID and canonical existing directory. Registering the
  same identity/root is idempotent. Conflicting identities or duplicate roots are rejected.
- A workflow may be unassigned or have `projectId`. Assignments must reference a registered
  project. New workflow POST is create-only; PUT replaces a graph explicitly.
- A fork gets a fresh ID and provenance, inherits the saved source's project, and starts
  with separate run history. An explicit destination project supports cross-project forks.
- A run derives ownership from its validated graph, then saves the project and graph
  snapshots. Renaming a project or moving a workflow does not rewrite run history.
- SQLite schema v2 adds projects and indexed ownership while preserving v1 documents and
  all original assets. Credentials remain in private provider configuration, outside graphs.

## Modules

| Directory                        | Responsibility                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `client/`                        | Supported agent HTTP client, workflow recipe builder and manifest discovery     |
| `cli/`                           | Argument handling and lifecycle; calls the same client                          |
| `shared/`                        | Serializable graph/project contracts, records and inspection helpers            |
| `server/routes/`                 | HTTP parsing, responses and service calls grouped by domain                     |
| `server/projects.mjs`            | Canonical roots, registration, defaults and ownership constraints               |
| `server/{store,graph,queue}.mjs` | Durable storage, pure graph expansion and execution scheduling                  |
| `harness-integrations/`          | Actual per-engine invocation, response parsing, auth status and BYOK clients    |
| `src/nodes/`                     | One renderer per node; shared chrome and a single renderer/catalog registration |
| `src/canvas/`                    | Edges, graph copying, saved graph projection and ordered autosaves              |
| `src/panels/`                    | Input inspection, provider setup and agent access                               |
| `src/projects/`                  | Project-aware workflow navigation and assignment                                |
| `src/components/`, `src/studio/` | Small UI primitives, context and browser helpers                                |
| `examples/quoture/`              | Reusable record-branch builder; synthetic examples live in test fixtures             |
| `test/`                          | Observable planner, queue, storage, adapter and CLI/API behavior                |
| `tools/check-architecture.mjs`   | Repeatable relative-import, cycle and dependency-boundary checks                |

The server entrypoint composes services and lifecycle. `src/App.jsx` owns editor state and
interaction orchestration, while node renderers and panels live in their named modules.
Stable CLI/server entrypoints and persisted provider IDs remain intact. Obsolete provider
paths were removed after migrating their callers; there is one active implementation per adapter.

## Harnesses and BYOK

Codex has separate image, prompt and status modules. Claude Code, Gemini and Pi own their
invocation and parsing logic. Shared code handles bounded subprocesses, cancellation and
image validation. The registry performs capability/model preflight and dispatch; it does
not guess an engine from an unknown ID. Built-in provider IDs are reserved.

OpenAI-compatible BYOK uses direct HTTP clients for text and images, plus a private
connection store. Routing it through Pi would add a second process and authentication
layer without improving the supported API contract. Pi remains an independent prompt
harness. Configuration, executable availability, authentication checks, protocol fixtures
and live inference are reported as different evidence.

## Extending safely

For a new harness, start with `harness-integrations/README.md`; keep the existing adapter
context and add protocol/cancellation coverage. For a new node, update the graph schema,
planner behavior, node interface descriptions and renderer registration together. For a
new project, use the CLI registration flow instead of editing the database.

Run `npm run check` after changes. Its architecture check prevents missing imports, cycles
and dependencies from shared contracts or adapters back into the app. Tests verify real
CLI/API use and SQLite upgrade/restart, with local HTTP/process fixtures for external
provider protocols. Browser checks verify project identity and preserve the full-window,
monochrome canvas and running-state border.

### Image region editing

`image-tools/segmentation/` owns the pinned, optional local SAM 2.1 Python runtime (Hiera Large by default; `FLOW_SAM_MODEL=tiny` is available).
The Node adapter is isolated from server/UI dependencies. `shared/image-editor.mjs`
owns API contracts and selection/brief semantics. `server/image-editor/service.mjs`
coordinates revision-checked SQLite metadata, serialized segmentation, mask exports
and new workflow preparation; `server/routes/image-editors.mjs` exposes those actions.
`server/run-service.mjs` shares provider preflight, asset checks, and queue submission between normal runs and editor sends.
Prepared requests retain their workflow snapshot. Run snapshots carry the request ID, so send retries recover the existing run after a crash.
The Python worker emits measured stage events on stderr and the final result on stdout. SQLite stores the latest progress independently of comments.
`src/image-editor/` renders cached contours and layer/comment controls. The image tray
opens that editor; CLI, client and MCP use the same HTTP service. Generation remains
in the existing workflow queue and chosen image harness. SAM masks are not generative
edits. The first generation path deliberately reports advisory, not strict, masking.

SAM 2.1's automatic masks and point predictor fit the requested hover/Shift/comment
interaction and its code/weights are Apache 2.0. SAM 3 adds text/concept segmentation,
but its official checkpoint access is gated; it is not a mandatory dependency.
The official Transformers integration supports CPU inference and concept prompts. SAM 3 is not wired into Flow yet, and MPS inference has not been verified here.
Sources: https://github.com/facebookresearch/sam2 and
https://github.com/facebookresearch/sam3 (reviewed October 30, 2026).
SAM 3 model access and Transformers examples: https://huggingface.co/facebook/sam3 and https://huggingface.co/docs/transformers/model_doc/sam3.

### Page-aware agent and viewer paths

`shared/agent.mjs` defines context and constrained graph operations. `server/agent/service.mjs` owns persistent project conversations and isolated text-provider execution. Apply and Undo commit the graph and turn receipt in one SQLite transaction. Workflow PUT and agent commits use graph revisions to reject stale content writes; the browser saver carries returned revisions into newer staged drafts.

`src/agent/AgentDock.jsx` owns the persistent chat and morphs the bottom toolbar upward. App supplies explicit page identity and reconciles successful graph changes with its undo/saver state. The editor hosts the same dock inside its modal focus boundary. Context includes selected nodes, styles, recorded runs, images, and segmentation comments. Recorded contexts remain read-only. Text adapters distinguish app-assistant requests from image-prompt writing without enabling shell tools.

`shared/viewer-routes.mjs` owns canonical path encoding and legacy query decoding. Browser history writes go through `src/studio/navigation.mjs`; UI, client, CLI, and MCP use the same codec and existing ownership resolver. The production server serves the SPA for resource paths without masking missing API or asset routes. The design comparison is in `docs/design/inline-agent/design.md`.

## Asset registry (schema v3)

The asset service adds indexed occurrence records and separately revisioned annotations alongside immutable run documents. Queue captures final image/video/text hashes and ordered input snapshots. Asset parents preserve cross-run references, original provider outputs and editor masks; historic observations remain partial. Named generation modes stay on existing nodes and expand through the same planner/queue. See [Grok, comparisons and lineage](grok-and-lineage.md) and [the design](design/grok-comparison-lineage.md).

## Canvas organization

`shared/graph-layout.mjs` owns a lazy-loaded, pinned ELK layered layout and its public geometry/options contract. Browser, HTTP, CLI and MCP invoke the same operation. It preserves workflow execution data, arranges measured rectangles, and handles flat section frames through an internal macro graph. API callers without measurements receive explicit estimate diagnostics. Organizing clears the old viewport so headless edits reopen fitted to the new arrangement. UI organization creates one local undo checkpoint and saves its animated camera fit.

`src/canvas/layout-geometry.mjs` collects live ReactFlow card and socket bounds for organization. `FlowEdge.jsx` draws individual Bezier connections. The icon-only toolbar action has a tooltip and busy indicator.

ELK was chosen for variable dimensions, fixed ports and crossing reduction. See [canvas organization](canvas-organization.md).

## Provider settings and Codex authentication

`/settings/providers` combines harnesses and API connections. Old settings links decode to the canonical Providers route. `ProvidersSettings.jsx` groups execution providers by family and opens one setup at a time; the compatible connection form is shown only when adding/editing. Credentials stay outside workflow graphs.

`CodexConnection` owns the selected auth source and isolated managed Codex homes. Harness mode keeps the existing CLI environment. OAuth and API-key modes supply private homes/forced login methods to Codex; the CLI owns tokens and refresh. Keys travel on stdin, and status is allowlisted. Text/image execution, model-cache reads, health and usage share that selection. API mode reports API billing instead of subscription percentages. Quota invalidation fences in-flight reads so switching accounts cannot restore an earlier account's cached usage. HTTP, client, CLI and MCP expose the same configuration/login operations.

## fal media providers

`shared/fal.mjs` owns the curated fal endpoint catalog and model constraints.
`harness-integrations/fal/` owns private credentials and the native queue protocol;
`ProviderRegistry` exposes `fal-image` / `fal-video` through the existing queue and
asset lineage path. Accepted receipts retain request identity and validated app-level
poll/result URLs. Uncertain submissions never automatically create another paid request.
Settings, client, CLI and MCP share the same setup routes. `tools/verify-fal-catalog.mjs`
checks the public schemas without authentication or generation.
