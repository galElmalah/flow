# Use Flow through MCP

Flow exposes a real stdio MCP server backed by the same supported `FlowClient`
as the CLI. It does not start a second database or call harnesses directly.
The CLI entrypoint starts or reuses the local platform before serving MCP:

`read_harness_usage` reads account quota windows and used percentages without inference.
Missing reports are unavailable, and stale percentages are marked. These are global
account limits rather than project token counts. See [harness usage](harness-usage.md)
for the per-provider support and Claude status-line setup.

```sh
node /absolute/path/to/flow/cli/flow.mjs mcp --project quoture
```

Configure your agent host to launch this server. A project-bound configuration
prevents reading, editing, running or controlling another project's data.
Discovery lists project metadata; `fork_workflow` can explicitly copy a foreign
source into the configured project. Each subagent can launch its own MCP process;
all processes use the single local platform and shared scheduler.

```json
{
  "mcpServers": {
    "weft": {
      "command": "node",
      "args": [
        "/absolute/path/to/flow/cli/flow.mjs",
        "mcp",
        "--project",
        "quoture"
      ],
      "env": {
        "WEFT_URL": "http://localhost:4310",
        "WEFT_PROJECT": "quoture"
      }
    }
  }
}
```

For a host that uses TOML configuration:

```toml
[mcp_servers.weft]
command = "node"
args = ["/absolute/path/to/flow/cli/flow.mjs", "mcp", "--project", "quoture"]

[mcp_servers.weft.env]
WEFT_URL = "http://localhost:4310"
WEFT_PROJECT = "quoture"
```

Direct `mcp/server.mjs` reads the two environment variables above and requires
an existing platform server. The CLI entrypoint also resolves project context
before starting stdio.
The transport writes protocol messages only to stdout and diagnostic errors to
stderr. This is a local stdio adapter, not an HTTP MCP endpoint. These examples
do not modify your host's configuration automatically.

## Start with the base prompt

Call `read_workflow` and find `type: "prompt"` nodes. Their `data.text` is the
base instruction. Follow their outgoing connections: a `template` adds each
record's fields; `prompt-generate` invokes the selected text harness to write an
image prompt; `generate` creates images from that prompt and connected image
sources; `output` collects the results. Multiple branches can share the same
base prompt and seed images.

For a new standard graph, `create_image_workflow` takes `prompt` as the base
instruction, optional `records` plus `template`, optional `promptProviderId`
for an AI writer, and `providerId`/`model` for images. It only saves a graph.
Seed references are existing local Flow asset URLs. To import a new image file,
use `flow workflow create --seed-image ./reference.png` or JavaScript
`FlowClient.upload()` before referencing the returned URL.

## Tools

| Tool                                               | What it does                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `discover`                                         | Live API routes, workflow schema, provider readiness and connection project |
| `list_projects`, `list_workflows`, `read_workflow` | Find project-owned graphs and inspect their inputs                          |
| `create_image_workflow`, `create_workflow`         | Save a standard or fully specified graph without running                    |
| `fork_workflow`, `save_workflow`                   | Create a provenance-preserving copy, then edit it                           |
| `plan_workflow`                                    | Preview exact text/image counts; `options.nodeId` selects one flow          |
| `run_workflow`                                     | Submit one new run; returns its durable ID                                  |
| `list_runs`, `inspect_run`, `wait_run`             | Follow existing runs, including exact inputs and outputs                    |
| `control_run`                                      | Pause, resume, cancel or retry an existing run                              |
| `search_images`                                    | Local semantic search across the connection's project image history         |
| `viewer_url`                                       | Validate a workflow/node/run/gallery link without launching an application  |
| `list_rule_templates`                              | List built-in rules, presets, and custom templates                          |
| `save_rule_template`                               | Save a reusable rule in the workspace-wide local library                    |

All tools publish JSON Schemas and read/write annotations. Invalid arguments
fail before an API call. Handler errors have `isError: true` and structured
`error.message`/optional `error.status`. Successful responses expose
`structuredContent.data` and the same JSON in their text content.

The style library also exposes `list_styles`, `read_style`, `create_style`,
`update_style`, `add_style_references`, `start_style_workflow`, `set_style_favorite`
and `import_style_reference_run`. To add a custom reference, use `upload_images`,
then `create_style` with a name, style/scene prompts and the returned local image
URL. `update_style` takes `styleId` and changed fields; `references` replaces the
saved list. These operations never start inference. See [custom styles](styles.md)
for the shared payload and source attribution fields.

Plan before inference. `run_workflow` always submits a new run and can consume
subscription/API usage; a timeout is not a reason to submit again. Keep its run
ID and use `inspect_run` or `wait_run`. Waiting lasts at most 55 seconds and
returns `{run, timedOut}`. Repeat the wait for long jobs. `concurrency`, when
specified, changes the shared platform queue limit for all agents.

Provider keys stay in private platform configuration. MCP has no tool to read
keys or export private provider configuration. BYOK and harness dispatch remain
in the platform, preserving selected providers and provenance.

Rules are full snapshots in `node.data.rules` on prompt, template, prompt-generate,
and generate nodes. Copy `id`, `title`, `group`, and `text` from the catalog and add
`enabled: true`. Enabled rules remain attached through scene writing and appear
in downstream image prompts. Custom library templates are shared across projects;
saving one does not change rules already applied to a workflow. Rule text guides
generation without verifying unique scenes or faces across parallel outputs.

## Open the viewer

The MCP tool `viewer_url` accepts `{workflowId?, nodeId?, runId?, gallery?}` and
returns the validated local URL. It checks project ownership, run/workflow
agreement and node existence in the run snapshot or saved graph. Hosts can show
that link to the user. To launch the viewer explicitly through the OS:

```sh
flow open --project quoture --workflow quoture-10-studies --node template --json
flow open --project quoture --run RUN_ID --gallery --json
flow open --project quoture --workflow quoture-10-studies --print-url --json
```

Choose a real node ID returned by `read_workflow`; the example `template` is
illustrative. `--print-url` validates and prints the receipt without launching.

## Verification

`node --test test/mcp.test.mjs` launches the actual SDK client and server over
stdio, lists tools, checks argument rejection and project boundaries, and calls
the HTTP adapter against an isolated fixture service. It requires no inference.

A separate agent exercised the same stdio interface against the real local
platform on 2026-10-29. It forked Quoture into **Agent QA · MCP usability · local
only**, saved an image-only `local-color`/`color-study` graph, planned exactly two
images with zero text jobs, ran it, waited, inspected outputs, searched its
images semantically and resolved a gallery URL. Both local processing jobs
completed. This proves platform orchestration; it makes no claim about paid
provider authentication. The existing source workflow and selected iOS artwork
were untouched. [Receipt](qa/mcp-agent-receipt.json).

The CLI entrypoint was also exercised over real stdio using
`node cli/flow.mjs mcp --project quoture`: the agent listed all 16 tools, read
`quoture-10-studies`, planned `collection` as 10 text jobs plus 10 images, and
resolved the viewer directly to `shared-style`. No run was submitted. The SDK
completed every call without stdout protocol pollution or stderr output.
[CLI MCP receipt](qa/mcp-cli-receipt.json).

This adapter uses pinned official MCP SDK server/client **2.4.0**. The server
follows the official [stdio server pattern](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server);
the test uses the official [stdio client pattern](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-client).

## Full UI operation coverage

The current server advertises **49 tools**. In addition to the original flow and
rule tools above:

| Tool                                   | UI action / behavior                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `create_project`, `update_project`     | Register a local project, rename it, set or clear its default workflow                            |
| `upload_images`                        | Upload verified reference images from explicit paths on the MCP host; returns platform asset URLs |
| `list_gallery`                         | Browse completed outputs and all exact image inputs in the bound project                          |
| `workflow_results`                     | Inspect the latest jobs/results grouped by workflow node                                          |
| `run_download_url`                     | Validate project ownership and return the run ZIP URL                                             |
| `search_status`, `retry_search_index`  | Inspect/recover the local semantic index                                                          |
| `provider_example`, `reload_providers` | Read the public example and refresh provider readiness                                            |
| `save_provider_connection`             | Create or edit a global compatible endpoint, models and write-only API key                        |
| `test_provider_connection`             | Check the configured endpoint's model listing without inference                                   |
| `remove_provider_connection`           | Remove a global compatible endpoint                                                               |

`save_workflow` is also the editing API for all canvas operations: change node
text/settings/rules/records, upload and attach images, add or remove nodes, edit
connections, duplicate nodes with new IDs, move nodes, rename, or save viewport.
Use the schema returned by `discover`, preserve the graph ID on replacement,
and plan before inference. Built-in graph mutation does not require one tool per
button. To use a generated output as a reference, copy its `output` URL from
`list_gallery` into the source node's `data.images` and save.

A project-bound connection still restricts workflow/run/result/download/search
operations. `create_project` and `update_project` can only target its own project;
an unbound connection can administer project registration. Provider configuration
and the rule library are deliberately workspace-wide, exactly as in the UI.
Provider keys are write-only `apiKey` actions `keep`, `clear`, or `replace` with a
`value`. Stored keys never appear in catalog, workflow, run, or tool responses.
Prefer private credential inputs from your agent host; do not put keys into
workflow graphs, prompts, screenshots or source files.

`upload_images` reads the requested local file paths, sends them to the local
platform, and returns only asset metadata. The platform verifies image bytes.
Paths refer to the machine running the MCP process; remote agent hosts should
use the JavaScript/HTTP multipart upload instead. `run_download_url` returns a
local URL, not base64 archive bytes. The agent host can download that URL or use
CLI `download`; JSON provenance is directly available through `inspect_run`.

The SDK protocol test now exercises these extra tools and validates project
rejections before foreign exports/config updates. `test/agent-parity.test.mjs`
launches the real CLI against isolated HTTP fixtures and checks graph save,
reference uploads, gallery input access, project defaults, provider write-only
key actions, index recovery, manifests, downloads and explicit error paths.
The capability matrix is [docs/qa/agent-capability-matrix.md](qa/agent-capability-matrix.md).

To fork a recorded run rather than today's saved graph, call
`fork_workflow {workflowId,runId,name?}`. The source workflow ID must match the
run, and a project-bound connection may only inspect its own recorded run.
The graph snapshot, including original prompts and rule text, is sent through
the same provenance-preserving fork endpoint as the viewer's **Fork to edit**.

Projects: `list_projects {search?,archived?:"active"|"archived"|"all"}` searches names,
local folders and workflow titles. `list_workflows {archived?}` uses the same states.
`viewer_url {projects:true}` returns the Projects home (or the bound project's list).
`set_workflows_archived {ids,archived,reason?}` atomically archives/restores workflows;
`set_project_archived {projectId,archived,reason?}` includes a project's child workflows.
Both honor project scope, preserve files and recorded inputs, and reject active runs.
Individual default workflows must be replaced as a project's default before archival.

Image region editing has the same operations as the UI: `image_editor_status`,
`setup_image_editor`, `list_image_editors`, `open_image_editor`, `read_image_editor`,
`segment_image`, `patch_image_editor`, `prepare_image_edit`, `send_image_edit`, and
`list_image_variations`. Use current revisions
for mutations. `viewer_url {editorId}` opens the region editor. Segmentation is a
local SAM operation; preparing exports masks/comments and creates a workflow, without
running image generation. `send_image_edit {editorId,requestId}` starts the prepared snapshot through the image agent and returns its run. Repeat sends return that run rather than starting another.
`patch_image_editor` accepts an optional normalized comment `anchor:{x,y}` for inline pins.
`read_image_editor` includes measured segmentation stages and prompt batch progress.
`prepare_image_edit` accepts `mode:"region"|"recolor"|"whole"`, defaulting to `region`.
Region mode requires selected masks and instructions or an unresolved comment. The
provider generates a candidate, then Flow preserves normalized sRGB RGBA pixels outside
the binary mask exactly. The provider itself still receives advisory references.
Legacy requests without a recorded mode keep their earlier advisory-mask behavior.

Recolor mode requires selected regions, a hex `color`, optional `strength:0..1`, and
`count:1`. It runs locally through the durable queue without subscription inference.
Whole mode can omit regions and instructions. It regenerates the complete current
image and bypasses region compositing.

Region and recolor preparation freezes all masks, labels, comments, and selection.
`open_image_editor` reuses that snapshot on the result, preserving stable region IDs.
Region edits mark inherited boundaries for review. Whole-image results need fresh SAM
segmentation. `list_image_variations` returns the complete project-scoped family,
including descendant edits and live jobs. Repeating `send_image_edit` reuses its run;
prepare a new request to generate another version. See [image version operations](image-versions.md).

## Ask the page-aware agent

`open_agent_conversation` returns the project's persistent conversation. Discover the context with `agent_context_schema`, then call `ask_page_agent` with a stable UUID, message, provider, and actual page context. Poll `read_agent_conversation`. A ready turn contains a reply and optional typed graph edits; `apply_agent_changes` saves them with revision checks. `undo_agent_changes` restores an applied graph while preserving newer viewport changes. `cancel_page_agent` stops pending text inference. None of these tools starts image generation. See [the inline agent guide](inline-agent.md).

## Canvas organization

`organize_workflow` accepts a workflow ID, current revision, optional measured geometry
and `preview`. It arranges cards without inference. A preview does not save;
a stale revision fails409.
See [canvas organization](canvas-organization.md) for CLI and client examples.

## fal / Seedance / Seedream

`read_fal_connection` reads private-key setup status without the key. `configure_fal`
accepts `{connection:{apiKey?}}`: omit to keep, string to replace, null to clear.
No inference is started. `fal-image` and `fal-video` use ordinary creation, planning,
running, lineage and dataset tools; endpoint constraints are in `list_providers`.
See [fal setup and workflow examples](fal-and-seedance.md).
