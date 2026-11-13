# Agent workflows

For a fresh checkout, begin with [SETUP.md](../SETUP.md). Offline
`flow help COMMAND --json` describes accepted options, constraints and effects.
The live equivalent is `GET /api/help?command=run`; accepted run overrides and
submission controls are described by `GET /api/schema/run`.

GIF animations use the existing image-generation and output nodes, not video. See [image formats](image-outputs.md) for Codex sprite-sheet GIFs, GPT Image 2.6 API formats/complexity, CLI flags, MCP settings and lineage. Inspect live `modelDetails.outputFormats` before choosing a provider.

Run `npm run setup` from the Flow installation to install its bundled user-wide skills. See [agent skill setup](agent-skills.md) for discovery paths, maintenance commands and launchers that work from consuming repositories.

Use the local Flow server for planning, prompt generation, image generation, run control and output provenance. Keep project source, review rules and selected artwork in the consuming repository. A workflow run never selects or installs artwork into that repository.

## Discover a project

A consuming repository has a `flow.project.json` pointer:

```json
{
  "version": 1,
  "projectId": "quoture",
  "serverUrl": "http://localhost:4310",
  "defaultWorkflowId": "quoture-10-studies"
}
```

There are no keys, prompts, image bytes or duplicate workflow graphs in this file. SQLite owns project metadata, saved workflows and run history. The project root is the manifest's directory; the platform canonicalizes and registers it. A project ID cannot silently change roots. If a repository moves, register a new project explicitly or use `--project ID` to work across directories with the existing registered project.

The CLI finds the nearest manifest while walking upward from its current directory, or from `--root PATH`. It uses that project's server and fetches the registered project's current default workflow. The manifest's default is a bootstrap hint for registration; it never overrides a newer server default. `--project`, `--url`, `FLOW_URL` and explicit `--workflow` can override context. Selecting another project does not reuse the original project's default workflow. Manifest discovery also verifies that its containing repository matches the registered canonical project root. A copied or misplaced manifest fails; an explicit `--project` intentionally allows work across directories. Server-side ownership checks reject cross-project runs and run controls. Project roots do not become harness working directories; harnesses run in isolated job folders.

`serve`, `stop` and `restart` always manage the Flow installation's server/data directory, regardless of the consuming current directory. Start the existing server rather than creating another database inside the consuming project.

## Register and create

Run the CLI by its absolute path when outside the installation, or use its installed `flow` executable:

```sh
node /absolute/path/to/flow/cli/flow.mjs serve --json
node /absolute/path/to/flow/cli/flow.mjs project init \
  --project my-app --name "My app" --root /absolute/path/to/my-app --json

# Reconnect a checked-in manifest to an existing local server:
node /absolute/path/to/flow/cli/flow.mjs project register \
  --from /absolute/path/to/my-app/flow.project.json --json
```

`project init --workflow EXISTING_ID` explicitly attaches an unowned saved workflow and makes it the project's default. A workflow owned by another project must be forked explicitly first. Registration is idempotent for the same project ID and canonical root. Project initialization writes only its manifest and platform metadata.

Create a reusable workflow without hand-writing graph JSON:

```sh
flow workflow create --root /absolute/path/to/my-app \
  --name "Editorial studies" --prompt "Quiet engraved scenery" \
  --seed-image ./reference.png --records ./quotes.json \
  --template ./scene-template.txt --prompt-provider claude-code \
  --provider codex --model native --ratio 2:1 --count 1 --json
```

File arguments resolve from the current directory. The creation response is the saved graph and its ID; creation never starts inference. `--id ID` chooses an explicit ID and fails if it already exists. `--from graph.json` creates an existing exported shape; use `import --from graph.json` only when replacement under that graph's ID is intended. Use `fork ID --name "New studies"` before editing shared workflows. Forks inherit ownership unless `--project OTHER_ID` explicitly changes it.

## Plan, run and inspect

To add reusable generation rules, open a prompt, template, scene writer or image
generator in **Properties → Rules & templates**. Choose individual rules or a
preset, then expand each rule to edit its exact instructions. The checkbox enables
that rule on this node. **Create a custom rule** adds your own instructions;
**Save to library** makes them reusable across local projects.

Agents can list the same catalog and save custom templates:

```sh
flow rules --json
flow rules save --from ./rule.json --json
```

The custom file contains `{ "id": "clear-horizon", "title": "Clear horizon",
"text": "Keep the horizon clear." }`. JavaScript clients expose
`client.ruleTemplates()` and `client.saveRuleTemplate(template)`. MCP exposes
`list_rule_templates` and `save_rule_template`.

Copy the full selected rule objects into a supported node's `data.rules` array,
with `enabled: true`. Each rule has `id`, `title`, `group`, and `text`; applied
rules also have `enabled`. Workflow saves, forks, exports, and run snapshots keep
the exact text. Changing a library template does not change existing workflows.
Built-in IDs cannot be overwritten in the library.

Enabled rules flow through templates and scene writers into downstream image
prompts. The inspector shows inherited rules and their source nodes. Disable an
inherited rule at its source. Disabling a local copy does not disable an upstream
copy. Image input trays show the exact rules used by the saved run.

Copies use the same scene brief with different seeds. Prompt rules cannot verify
different faces or scenery across outputs. For explicit batch variation, give
each record distinct scene, viewpoint, and cast descriptions. Check for conflicts
between people rules and existing art direction, such as ivory-only subjects.

```sh
flow projects --json
flow project inspect --root /absolute/path/to/my-app --json
flow workflows --project my-app --json
flow workflow WORKFLOW_ID --json
flow providers --json
flow plan --root /absolute/path/to/my-app --workflow WORKFLOW_ID --json
flow run --root /absolute/path/to/my-app --workflow WORKFLOW_ID --concurrency 4 --request-id BATCH_ID --json
flow wait RUN_ID --timeout 600 --json
flow inspect RUN_ID --json
flow download RUN_ID --output ./studies.zip
```

When the manifest has a default workflow, `plan` and `run` can omit `--workflow`. An explicit positional workflow ID also selects that workflow; conflicting positional and flag selectors fail. Use `--node COLLECTION_ID` for one independent flow and its ancestors. `--count` is copies per record/variation and generation mode, not the total number of images: ten records and count 10 produce 100 image jobs for one mode. AI prompt jobs are separate and retain their own provider. Always review the plan before starting inference. Planning never uploads or saves: create/import a workflow first.

`run --json` returns the full run document with `id`, matching HTTP and SDK.
MCP exposes that document at `structuredContent.data`. Persist the ID and use
`wait`, `retry` or `resume` for recovery. An optional `--request-id BATCH_ID`
identifies one intended submission: the same project context, saved selector,
overrides and concurrency replay its durable receipt, including after restart.
Saved graph edits after acceptance do not cause a duplicate run. Reusing the key
with changed inputs returns409 `REQUEST_ID_REUSED` and the original `runId`.
Use a new key for a different batch. Without a key, every submission is new.
Concurrency is saved per run; submitting another run never reduces its ceiling.

With `--json`, CLI failures exit nonzero and write a JSON `error` object to stderr;
stdout is for successful results. Errors include `message`, `code`, and applicable
`status`, `runId`, `issues` or provider `blockers`. Invalid flags, numbers and
irrelevant options fail before project discovery, uploads or network calls.
For a terminal unsuccessful JSON wait, stderr also retains the complete run at
`error.run`; inspect its jobs before choosing retry or resume. Monitoring errors
after an accepted `run --wait` retain its `runId`.

For an inference-free orchestration check, use a seed-image workflow with `--provider local-color --model color-study`. This performs real local image processing. It does not replace upstream AI prompt nodes, so choose an image-only workflow for this check. Executable detection and protocol tests do not prove that a CLI harness is authenticated; inspect provider readiness and run the specifically intended harness when inference is required. Compatible API connections use their selected base URL/model and explicit key; there is no automatic switch from a signed-in harness to a paid API.

A run blocked by provider setup returns HTTP `412`, `code: "PROVIDER_NOT_READY"`, and `blockers` containing `providerId`, `name`, `message`, `nodeIds` and `setupPath`. All missing providers in the planned scope are reported before any jobs are created. The JavaScript client error and MCP error expose the same fields; CLI errors include the provider messages. Configure the named providers, then explicitly submit the intended run. Planning checks graph structure and counts; it does not prove provider entitlement. A configured API key still requires actual account access and billing when the provider executes.

## Open the viewer

Open a saved workflow, its base prompt, or a completed run directly from an agent:

```sh
flow open --root /absolute/path/to/my-app --json
flow open WORKFLOW_ID --project my-app --node PROMPT_NODE_ID --json
flow open --project my-app --run RUN_ID --gallery --json
flow open WORKFLOW_ID --project my-app --print-url --json
```

`open` starts or reuses the Flow installation's local server and launches the system browser. It never creates another database inside the consuming repository. With no workflow ID it uses the discovered or explicit project's current server default; without a project or target it opens the root viewer. `--node ID` selects that node's properties, `--run ID` restores the run snapshot, and `--gallery` opens the image gallery. An explicit run determines its workflow; a conflicting workflow, missing target or foreign project fails before opening the browser. Node validation uses the run's original graph when a run is selected.

`--print-url` validates the same targets and returns a receipt with `url` and `opened: false`, without launching a browser. Receipts also include selected IDs and server reuse status. URLs are local HTTP origins only, with encoded query values. Use the receipt to link a human to the exact canvas context; opening the viewer never starts inference.

```js
const target = await flow.viewer({
  workflowId: "my-studies",
  nodeId: "brief",
  // runId: "saved-run-id", gallery: true,
});
console.log(target.url); // Validated URL only; no browser launch.
```

## Use the JavaScript client

```js
import {
  FlowClient,
  createImageWorkflow,
} from "/absolute/path/to/flow/client/index.mjs";

const flow = new FlowClient({
  url: "http://localhost:4310",
  projectId: "my-app",
});
const graph = await flow.createWorkflow(
  createImageWorkflow({
    name: "Scene studies",
    prompt: "A restrained engraving of a quiet academy",
    providerId: "codex",
    model: "native",
  }),
);
const plan = await flow.plan(graph.id, { count: 10 });
// Review plan.total, plan.textJobs and plan.imageJobs before running.
const run = await flow.run(
  graph.id,
  { count: 10 },
  {
    concurrency: 4,
    requestId: "scene-studies-batch-001",
  },
);
const finished = await flow.wait(run.id, { timeout: 600 });
if (finished.status !== "completed")
  throw new Error(`Run ${finished.id}: ${finished.status}`);
```

`createImageWorkflow` also accepts uploaded `images`, canonical `records`, a record `template`, `promptProviderId`/`promptModel`/`promptInstructions`, seed, count and aspect ratio. Template substitution belongs in a template node; a plain prompt string is not a template. `upload([{name, data, type?}])` returns asset URLs for image references. `project`, `projects`, `createProject`, `updateProject`, `workflows`, `workflow`, `createWorkflow`, `saveWorkflow`, `fork`, `plan`, `run`, `wait`, `inspect`, `runs`, `control`, `providers` and `download` share the same HTTP/error handling as the CLI. `FlowError.status` distinguishes HTTP failures; `wait` returns the final run, including unsuccessful status, and throws only for transport/timeout/abort errors.

Run overrides and submission controls reject unknown fields, invalid numbers and
unsupported shapes before a request is sent. A project-bound client cannot create,
save or move workflows into another project or change another project's metadata.
The SDK's `run(workflow, options, {concurrency,requestId})` returns a full run.
Project-bound uploads inherit that project so their returned asset IDs remain
readable by the same client. Inline graph inputs inherit the bound project when
no owner is specified. Graph inputs can use plain graph objects or versioned
Flow file envelopes.
`wait` applies its deadline to network calls and polling. A deadline throws
`FlowError` with `code: "RUN_WAIT_TIMEOUT"`, `status:408`, `runId`,
`timeoutSeconds` and optional `lastRun`; server work continues. An explicit caller
abort preserves its supplied reason.

`viewer({runId})` resolves the frozen run graph even when no saved workflow exists.
To retain an inline run as an editable workflow, call
`fork(run.workflowId, {runId:run.id,name:"My saved study"})` or CLI
`fork WORKFLOW_ID --run RUN_ID`. The server reads its authoritative snapshot and
records both `forkedFrom.workflowId` and `forkedFrom.runId`. A different source
workflow ID or project is rejected. A run ID and arbitrary workflow snapshot
cannot be supplied together.

Read `GET /api` or `flow guide --json` for route discovery and `flow schema --json` for the complete graph schema. All live state mutations use the API/CLI/client; never edit SQLite or JSON mirrors directly.

## Find generated images by meaning

Search the prompts, scenes, quotes, and record metadata associated with generated images:

```sh
flow search "quiet companionship through hardship" --project quoture --count 20 --json
flow search "classical thinker beside ruined columns" \
  --project quoture --workflow quoture-10-studies --provider codex --json
```

Search uses the discovered project's whole image history. The manifest's default workflow does not narrow search. Pass `--workflow ID`, `--run ID`, or `--provider ID` to narrow results. `--count` limits search results to 1–200, with a default of 100. Search does not start generation.

```js
const result = await flow.searchImages(
  {
    query: "friendship on a difficult journey",
    workflowId: "quoture-10-studies",
    providerId: "codex",
    limit: 20,
  },
  { signal: controller.signal },
);
for (const image of result.items)
  console.log(image.output, image.similarity, image.searchExcerpt);
const status = await flow.searchStatus();
if (status.state === "error") await flow.searchRetry();
```

A project-bound client always searches `project:ID`. Use `workflowId` to narrow that project. Explicit `all`, `unassigned`, foreign project, or `workflow:ID` scopes fail instead of replacing the project restriction. An unbound client accepts `scope: "all"`, `"unassigned"`, `"project:ID"`, or `"workflow:ID"`. Project, workflow, run, and provider restrictions apply before ranking and the result limit.

The response contains `items`, `total`, and `index`. Each result preserves the gallery image's inputs and source provenance, with `similarity` and `searchExcerpt` added. The index state is `loading`, `indexing`, `ready`, or `error`; inspect `indexed`, `total`, and any `error` before treating an empty result as a completed search. Results can be partial while indexing continues.

Embeddings run locally with a MiniLM model. The model files download on first use and remain cached in `.flow/models`. Derived vectors persist in `.flow/search.sqlite` and rebuild from the authoritative run history when needed. Search requires no provider API key and sends no prompts to a hosted embedding service. It searches image-associated text, rather than analyzing image pixels.

The HTTP interface is `POST /api/gallery/search` with `{query, scope, workflowId?, runId?, providerId?, limit?}`. Inspect index readiness with `GET /api/search/status`; explicitly download/setup a missing search model or retry a failed setup with `POST /api/search/retry`. Normal startup uses the cache offline and never enables downloads implicitly.

## Quoture

The local Quoture repository is `/absolute/path/to/your-project`. Its `flow.project.json` points to project `quoture` and workflow `quoture-10-studies`. Keep its mandatory artwork-role and source-review policies. The shared canvas has independently runnable quote (`collection`) and category/journey (`cover-collection`) flows, with distinct templates and image ratios. Generate studies through local Flow; preserve returned originals, exact record IDs, prompts and run manifests. Selection, registration, native exports and Simulator checks remain explicit Quoture steps after review.

## Complete canvas and provider operations

The supported editing contract is **read → fork if shared → change the full graph → save**.
Nodes, edges, prompts, datasets, applied rule snapshots, reference images, generator
settings, names and viewport are all in the canonical workflow schema. Agents do
not need a separate HTTP route for each canvas button. Fetch `flow schema --json`
(or MCP `discover`) for valid node types, handles and field constraints; preserve
unknown existing fields and use unique node/edge IDs. `save_workflow` does not run.

```sh
flow fork WORKFLOW_ID --project my-app --json
# Fork a historical graph exactly as the viewer's "Fork to edit":
flow fork WORKFLOW_ID --project my-app --run RUN_ID --json
flow export FORK_ID --project my-app --output /tmp/fork.json
# Edit the returned graph, including data.text, data.records, data.rules,
# data.images, positions, generator settings or edges.
flow import --from /tmp/fork.json --project my-app --json
flow plan --workflow FORK_ID --project my-app --json
flow open FORK_ID --project my-app --node PROMPT_ID
```

For image references, upload existing local files first, then put the returned
`url` in a source's `data.images` or record's `images` array. Reusing a gallery
output as a seed uses that output's local URL through the same graph save.

```sh
flow upload ./reference.png ./other-reference.jpg --project my-app --json
flow project update --project my-app --name "My app studies" --workflow FORK_ID
flow project update --project my-app --clear-default
flow gallery --project my-app --json
flow results FORK_ID --project my-app --json
flow manifest RUN_ID --project my-app --output ./run.json
flow search-status --json
flow search-retry --json
```

`gallery` includes the same exact input prompts, records, rules and reference URLs
as the image tray; `results` groups recent jobs by workflow node. `manifest` is
the full recorded run, also available as `client.manifest(id)`/MCP `inspect_run`.
`client.downloadTarget(id)`/MCP `run_download_url` returns a validated ZIP URL;
`client.download(id)` and CLI `download` retrieve the actual archive. A bound
project guards result and run exports before bytes are returned. Direct HTTP
reads support `?projectId=ID` too; omitting it intentionally reads the workspace.

Provider connections are global workspace configuration, shared by all projects.
Agents can perform the same BYOK setup as the UI without editing private files:

```sh
flow providers example --json
flow providers create --from ./private-connection.json --json
flow providers save CONNECTION_ID --from ./private-connection.json --json
flow providers test CONNECTION_ID --json
flow providers remove CONNECTION_ID --json
flow providers reload --json
```

The private input file has `name`, `baseUrl`, `models` and an explicit write-only
key action. Do not commit it or put actual keys into graph files or command-line
arguments. Example with a placeholder:

```json
{
  "name": "My compatible endpoint",
  "baseUrl": "http://localhost:8080/v1",
  "models": [
    { "id": "my-model", "capabilities": ["text"], "acceptsImages": true }
  ],
  "apiKey": { "action": "replace", "value": "YOUR_KEY" }
}
```

Use `{"action":"keep"}` to preserve a stored key or `{"action":"clear"}` to
remove it. Changing the base URL while keeping an existing key is rejected.
Responses return public provider readiness/model metadata, never stored keys.
`test` checks `/models` on the configured endpoint; it does not prove inference
compatibility. Removing a connection can break references in existing workflows.

JavaScript equivalents are `gallery()`, `workflowResults(id)`, `manifest(id)`,
`providerExample()`, `reloadProviders()`, `saveProviderConnection(input,id?)`,
`testProviderConnection(id)` and `removeProviderConnection(id)`. MCP exposes the
same operations with schema validation; see [MCP tools](mcp.md). UI-only view
state (panel open/closed, selected image, zoom animation, clipboard and OS file
pickers) is represented by graph/viewer URLs or the agent host's own interface;
it is not duplicated as durable platform data.

## Projects page and cleanup

`flow open --projects` opens the searchable local project home. Add `--project ID`
to open that project's workflow list. Search names, roots and workflow titles with
`flow projects --search TEXT --json` or `client.projects({search: TEXT})`. Project
cards include a recent generated image, active workflow/image counts and local root.
Fresh installations start with an empty workspace; examples are opt-in imports.

Archive prototypes through `flow workflow archive ID`; use `flow workflow restore ID`
to bring them back. `flow workflows --archived` lists recoverable workflows.
`flow project archive ID` / `restore ID` applies to the whole project, preserving its
default workflow and child ownership. `flow projects --archived` lists archived projects.
The UI's Archived view also groups archived workflows under their active project.
Active runs and individual project defaults are protected from workflow archival.
Choose another default first. Stop active or paused runs before archiving.

HTTP: `POST /api/workflows/archive {ids:[ID],archived:true,projectId?,reason?}` and
`POST /api/projects/:id/archive {archived:true,reason?}`. Listing projects, workflows
and runs accepts `?archived=active|archived|all` (active by default). Workflows also
accept `?summary=1` for lightweight metadata. JavaScript: `archiveWorkflows(ids, bool,
reason?)`, `archiveProject(id, bool, reason?)`. MCP: `set_workflows_archived` and
`set_project_archived`; bound clients guard ownership. MCP `viewer_url {projects:true}`
returns the projects page URL. MCP `list_projects` accepts `search` and `archived`;
`list_workflows` accepts `archived`.

Archives are durable SQLite metadata. They remove prototypes from normal navigation,
gallery, history and semantic image search, while retaining documents, image files,
recorded run inspection/downloads and style reference provenance. Restoring a project
keeps independently archived workflows archived. `kind: "library"` on a project
marks internal style reference generation; it remains available to agents and Styles
but does not clutter ordinary project cards or the workflow quick switcher.

## Image region editor

Open any image inspector, then **Edit image regions**. SAM 2.1 runs locally; cached SVG contours handle hover and Shift-selection without more inference.
Automatic masks may miss blurred or small objects: **Pick missing region** adds a
point-guided mask. The default checkpoint is Hiera Large; set `FLOW_SAM_MODEL=tiny` before starting the
server for a smaller model. SAM proposes pixel regions, not semantic object names. Rename the
mask layers to make comments useful to an agent. Layers contain visible pixels only;
they do not reconstruct occluded content or a layered source document.

```sh
flow editor status --json
flow editor setup --json                 # one-time uv/Python + official model install
flow editor open --seed-image ./photo.png --project PROJECT_ID --json
flow editor open --image /files/runs/RUN_ID/JOB_ID/output.png --json
flow editor segment EDITOR_ID --json     # async; inspect until ready/failed
flow editor inspect EDITOR_ID --json
flow open --editor EDITOR_ID
flow editor patch EDITOR_ID --from change.json --json
flow editor prepare EDITOR_ID --from edit.json --json
flow editor send EDITOR_ID REQUEST_ID --json  # starts generation; repeat returns the same run
```

`change.json` uses the latest `revision` and exactly one of:

- `layer:{id,label?,visible?,locked?}`
- `order:[every region ID exactly once]` (back to front)
- `comment:{regionIds:[ID],text,anchor?:{x,y}}` with normalized image coordinates from 0 to 1
- `resolve:{id:COMMENT_ID,resolved:true|false}`

`edit.json` uses `{revision,mode?,regionIds?,instructions?,providerId?,model?,count?}`.
The default `mode:"whole"` renders the complete image using the original and optional region annotations as guidance, without hard-mask compositing. Explicit advanced `mode:"region"` requires selected regions and either instructions or an
applicable unresolved comment. Flow composites the AI candidate through the binary
mask, preserving normalized sRGB RGBA pixels outside it exactly. Locked or hidden
regions cannot be edit targets. BYOK providers use the same compositor.

`mode:"recolor"` requires regions and a `color:"#RRGGBB"`, with optional `strength`
from 0 to 1. It uses reserved provider `local-recolor` through the normal queue,
requires `count:1`, and performs no external inference. `mode:"whole"` regenerates
the entire current image with the chosen provider. It can omit regions and instructions.
CLI flags `--mode`, `--color`, `--strength`, `--regions`, and `--prompt` expose the same
options. See [Edit image regions and keep version history](image-versions.md).

Client methods: `editorStatus()`, `setupEditorModel()`, `imageEditors()`,
`openImageEditor({source,runId?,jobId?,projectId?})`, `imageEditor(id)`,
`segmentImage(id,{point?:{x,y}})`, `patchImageEditor(id,change)`,
`prepareImageEdit(id,input)`, `sendImageEdit(id,requestId)`, `imageVariations(id)`, `viewer({editorId})`. Point coordinates are normalized
0..1. Bound clients add project scope. HTTP endpoints are discoverable under the
`imageEditor` field of `GET /api`; list/read/PATCH/segment/prepare/send accept `?projectId`.

Prepare returns the new workflow and an immutable request manifest: original source
hash/provenance, selected mask IDs/contours, comment snapshots, edit brief, annotation
map, union mask and transparent cutout. Region and recolor requests also freeze **all**
region masks, labels, visibility, locks, order, comments, and the selected IDs for
continued editing. White in the union mask means editable; black means preserve.
Sending an AI edit shares its references and brief with the selected image provider.
Use **Prepare workflow only** to inspect the graph before generation, or **Send to agent** to prepare and start an edit.
`sendImageEdit` runs the immutable prepared snapshot through the normal provider preflight and queue.
The response contains the run ID; use `inspect`, `wait`, or `inspect_run` to follow results.
Repeating a send with the same request ID returns the existing run, including after a restart.
A prepared workflow is not a completed edit. Current Codex and compatible harnesses
use reference guidance, with `strictInpainting:false` for native provider behavior.
New region and recolor requests separately report `preserveOutsideMask:true` because
Flow enforces preservation after generation. Historical requests without an explicit
mode retain advisory mask behavior. Whole-image regeneration bypasses the compositor.

Editor documents use revision checks: on HTTP 409, reread and reapply the intended
change. Do not blindly resend a prepare request after losing its response; inspect
`requests` first. Region detection serializes local GPU work, persists queue state,
and marks an interrupted detection failed after restart. Comments, layers, masks and
prepared edit workflows survive restarts. Assets live under `.flow/editors/`; never
edit its documents or SQLite directly.

Click a region to open its comment composer directly on the image. Shift-click adds or removes
regions from that comment. **Save comment** leaves a numbered pin; **Send to agent** saves
the current draft and starts generation with all open comments, plus any overall direction.
API callers still supply explicit region IDs when preparing an edit. Comments keep their
image coordinates and region IDs across reloads. Resolved comments are excluded.

The editor's **Image versions** strip shows prepared requests, live jobs, and completed
images across the version family, including edits made from child versions. Click a
completed version to continue editing it. The separate inspection action shows its
recorded inputs and download link. Originals remain unchanged.

Opening an aligned region or recolor output reuses its saved regions and names without
another SAM pass. Region edits mark inherited boundaries for review. Applied comments
become resolved on the child; local recolor leaves natural-language comments unresolved.
Whole-image outputs start without inherited masks and use fresh SAM detection.
`familyId`, `parentEditorId`, `original`, and `inheritedSelection` describe editor
lineage. All edit workflows and runs inherit the editor's project. Gallery `edit`
metadata includes family, parent editor, request, mode, source, and selected regions.
Legacy edit runs recover their original lineage from the immutable graph snapshot.

Poll `GET /api/image-editors/EDITOR_ID/variations?projectId=PROJECT_ID`, client
`imageVariations(editorId)`, CLI `flow editor variations EDITOR_ID --project PROJECT_ID --json`,
or MCP `list_image_variations` to read the same progress and outputs. Prepared-only requests
are explicitly labelled; a failed/cancelled/interrupted run is never presented as a completed variation.

`segmentation.progress` reports the worker's real stage, message, and completed/total counts when available.
The stages cover runtime startup, model loading, image encoding, prompt batches, and mask export.
The UI shows a stage progress bar and elapsed time. Batch percentages do not estimate total job time.

A checkpoint change adds new model proposals while preserving existing mask IDs and comments. Cached automatic proposals are reused for the same checkpoint.

Editor `projectId` owns the annotations and the new edit workflow. `source.projectId`
records original image ownership. A project can create an editor for an older unassigned
run while keeping that run and its source provenance unassigned. Images already owned
by a different project still reject a mismatched explicit scope. Existing editor
records inherit their owner from `source.projectId` when no top-level owner is stored.

## Use the page-aware conversation agent

See [Change a workflow through the in-app agent](inline-agent.md) for the browser, CLI, client, and MCP workflow. Conversations use actual page context and existing text providers. Ready proposals apply through revision checks. Chat does not start image generation. `GET /api/schema/agent` discovers the contract.

Workflow PUT now requires the revision from your current graph. A successful write returns the next revision; a stale write returns409 and preserves the newer graph. Forks begin at revision0. Viewer links generated by CLI/MCP use resource paths, including `/project/ID/workflow/ID`, `/run/ID`, `/node/ID`, and `/editor/ID`.

Region names: `flow editor name ID --provider codex-text` / MCP `name_image_regions` / client `nameImageRegions(id,input?)` upgrade generic SAM names with vision text inference. Poll `editor.naming`; `cancel_image_naming` / `cancelImageNaming(id)` stop the task. Manual names are protected. Segmentation accepts `names:false` for local-only masks, or `names:{providerId,model?}`. See [image-region-names.md](image-region-names.md).

## Codex authentication

Settings → Providers and the following commands share the same private connection:

```sh
flow providers codex --json
flow providers configure-codex --from ./private-codex.json --json
flow providers login-codex --json
flow providers cancel-codex-login --json
```

The configuration is `{"mode":"harness"}`, `{"mode":"oauth"}` or
`{"mode":"api-key","apiKey":"YOUR_KEY"}`. Omit `apiKey` to keep its saved value.
Never commit that private input file. Select OAuth before starting device login; poll
`providers codex` while the user completes the official sign-in. Configuration changes
are rejected while generation jobs are active. No inference starts.

Client: `codexConnection`, `configureCodex`, `startCodexLogin`, `cancelCodexLogin`.
MCP: `read_codex_connection`, `configure_codex`, `start_codex_login`, `cancel_codex_login`.
HTTP: `GET|PUT /api/providers/codex`, `POST /api/providers/codex/login` and
`POST /api/providers/codex/login/cancel`. API credentials are isolated from OAuth
and the existing local harness; changing modes never signs out the user's global CLI.

For fal-hosted Seedance/Seedream, use the native `fal-video` / `fal-image` providers.
Read `flow providers fal`, configure via `flow providers configure-fal --from PRIVATE_FILE`
or MCP `configure_fal`, then use the ordinary workflows, comparison modes and lineage
commands. [The fal guide](fal-and-seedance.md) includes model/recipe defaults and limits.
