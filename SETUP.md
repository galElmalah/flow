# Set up Flow and run a local workflow

Agents: start here, then read [AGENTS.md](AGENTS.md) for repository contracts.
This guide installs Flow, verifies an isolated workspace, and creates real local
image outputs. It requires Node.js 22.13 or newer and npm on macOS or Linux.
No provider account, API key, GPU, or model download is needed.

## Install from a fresh clone

Run these commands in order:

```sh
git clone https://github.com/galElmalah/flow.git
cd flow
npm ci
npm run setup
npm run verify:setup
node tools/demo.mjs --json
```

`npm run setup` builds the UI, installs the `flow` launcher in `~/.local/bin`,
and installs the bundled workflow, image-editing, and style-library skills.
It preserves foreign launchers and locally modified skills. Keep the checkout
in place because the launcher uses its source and dependencies.

If `flow` is absent from PATH, use the absolute launcher path printed by setup
or run `node cli/flow.mjs` from this checkout. Help and version work offline:

```sh
node cli/flow.mjs --version --json
node cli/flow.mjs help run --json
node cli/flow.mjs run --help --json
```

`npm run verify:setup` uses a temporary home, database, port, launcher, and skills.
It blocks external fetches, creates four local images, checks lineage and MCP,
and removes its temporary workspace. Success prints `"ok": true`.

The demo starts or reuses the checkout's local server. It saves a **Flow demo**
project and a four-image workflow through Local color lab. Its JSON returns
`projectId`, `workflowId`, `runId`, `url`, and `outputs` with asset IDs. Keep those
values. Repeating the demo reopens its existing run and preserves workflow edits.
The JSON command does not open a browser.

If port 4310 belongs to another application, choose a free local port:

```sh
node tools/demo.mjs --url http://localhost:4311 --json
```

Use the same `--url` on later commands, or set `FLOW_URL` for that shell session.
For installation locations, PATH changes, removal, and SDK installation, read
[CLI and SDK installation](docs/installation.md). For an existing installation,
follow [the migration guide](docs/flow-files.md#upgrade-an-existing-weft-installation)
before setup.

## Discover the workspace

After the demo, use the running local platform:

```sh
node cli/flow.mjs guide --json
node cli/flow.mjs schema --json
node cli/flow.mjs providers --json
node cli/flow.mjs projects --json
node cli/flow.mjs workflows --project PROJECT_ID --json
node cli/flow.mjs workflow WORKFLOW_ID --project PROJECT_ID --json
```

Replace `PROJECT_ID` and `WORKFLOW_ID` with the demo's returned values. Read the
saved graph before editing. `guide` returns live routes and options, `schema`
returns the graph schema, and `providers` reports current provider readiness.
Use offline command help when the server is unavailable.

To use another local folder, register it explicitly:

```sh
node cli/flow.mjs project init --project my-app --name "My app" \
  --root /absolute/path/to/my-app --json
```

This writes the folder's `flow.project.json` pointer and registers its canonical
root. Later commands discover the nearest pointer from their current directory.
Explicit `--project`, `--workflow`, and `--url` select a target for this task.
The platform's registered default workflow is authoritative. A copied manifest
cannot silently move a registered project to another root.

## Create and plan a saved workflow

Run this example from the Flow checkout. Replace `PROJECT_ID` with your registered
project ID. The bundled reference needs no download:

```sh
node cli/flow.mjs workflow create --project PROJECT_ID --name "Local seed study" \
  --prompt "Explore violet and warm peach" \
  --seed-image ./public/assets/paper-seed.png \
  --provider local-color --model color-study --count 2 --json
```

Creation saves a graph and returns its `id`. It does not start a run. Use that
value as `WORKFLOW_ID`:

```sh
node cli/flow.mjs workflow WORKFLOW_ID --project PROJECT_ID --json
node cli/flow.mjs plan --workflow WORKFLOW_ID --project PROJECT_ID --json
```

For this example, check `total: 2`, `imageJobs: 2`, `textJobs: 0`, and `videoJobs: 0`.
Check the selected provider and model in `modes` too. `--count` means copies per
record or scene and generation mode. Ten scenes with count 10 produce 100 image
jobs. Review the plan before submitting any run.

For shared work, fork the saved graph before editing:

```sh
node cli/flow.mjs fork WORKFLOW_ID --project PROJECT_ID --name "My local study" --json
```

The fork returns its own `id`. Save complete graph edits through the supported
client or API with the current `revision`. A stale save returns HTTP 409. Read the
latest graph before resolving that conflict. See [graph editing](docs/agents.md#complete-canvas-and-provider-operations).

## Submit once and follow the run

Use the workflow ID that you just planned:

```sh
node cli/flow.mjs run --workflow WORKFLOW_ID --project PROJECT_ID \
  --concurrency 2 --request-id REQUEST_ID --json
```

Choose `REQUEST_ID` once for this intended submission and keep it with the response.
The optional key makes a retry of the same submission return the existing run.
Use the same key and request when recovering a lost response. Choose a new key
for a different batch. Omitting the key submits a new run each time.

The command returns the full run document. Its durable run ID is `id`. Use that
value as `RUN_ID`, then follow the existing run:

```sh
node cli/flow.mjs wait RUN_ID --project PROJECT_ID --timeout 600 --json
node cli/flow.mjs inspect RUN_ID --project PROJECT_ID --json
node cli/flow.mjs open --run RUN_ID --project PROJECT_ID --print-url --json
```

`wait` returns the run and its jobs. Check `status` and each job's status before
reporting success. `--print-url` validates the viewer target and returns its local
URL without opening a browser. Add `--wait` to `run` if you want submission and
waiting in one command.

A client timeout does not cancel server work. Keep the run ID and inspect or wait
again. Use `resume RUN_ID` for a paused run or `retry RUN_ID` for failed jobs.
These controls act on the recorded run. Do not submit a fresh batch to recover an
existing run. Concurrency is a ceiling for this run; starting another run does
not change it. Aggregate capacity is the maximum of the default and active run
ceilings. Provider limits and local hardware still apply.

If storage fails after a submission is recorded, the error can return
`RUN_PERSISTENCE_INCOMPLETE` with `runId`. The recorded run stays paused. Resolve
the storage error, inspect that ID and resume it; a keyed retry returns the same
paused receipt.

## Inspect the actual outputs

For a completed image job, take `assetId` from the run's `jobs` array:

```sh
node cli/flow.mjs asset lineage ASSET_ID --project PROJECT_ID --json
node cli/flow.mjs gallery --project PROJECT_ID --json
node cli/flow.mjs manifest RUN_ID --project PROJECT_ID --output /tmp/flow-run.json
```

Lineage contains exact prompts, requested settings, reference ancestry, and output
fingerprints. Inspect measured output dimensions instead of assuming the requested
size. Report the viewer URL, workflow ID, run ID, output asset IDs, and any failed
jobs to the user. Keep durable changes in the supported API. SQLite and JSON
mirrors are not editing interfaces.

## Use the SDK or MCP

To use the SDK from another Node.js project, install the local checkout there:

```sh
npm install --save /absolute/path/to/flow
```

```js
import { FlowClient } from "flow";

const client = new FlowClient({
  url: "http://localhost:4310",
  projectId: "PROJECT_ID",
});
const graph = await client.workflow("WORKFLOW_ID");
const plan = await client.plan(graph.id);
// Review plan and provider readiness before submitting.
const run = await client.run(
  graph.id,
  {},
  {
    requestId: "REQUEST_ID",
    concurrency: 2,
  },
);
const finished = await client.wait(run.id, { timeout: 600 });
console.log(finished.status, finished.jobs);
```

The SDK calls the running local server. Imports never start inference. The SDK
returns run documents with `id` and accepts the optional request key in the third
argument to `run`.

With `--json`, successful CLI results go to stdout. Failures exit nonzero and
write `{error:{message,code,status?,runId?,blockers?}}` as JSON to stderr.
Unknown flags, invalid numbers and irrelevant options are rejected before any
upload or network request. A wait timeout preserves the run; use the error's
`runId` to resume monitoring. See `flow help COMMAND --json` for accepted options,
constraints and command effects.

For an MCP host, launch the project-bound stdio server:

```sh
node /absolute/path/to/flow/cli/flow.mjs mcp --project PROJECT_ID
```

Discover the current tool schemas with `tools/list`, then call `discover` and
`read_workflow`. Use `plan_workflow`, `run_workflow`, and `wait_run` for the same
sequence. `run_workflow` accepts optional top-level `requestId` and returns the run
under `structuredContent.data`, with its ID at `structuredContent.data.id`.
`wait_run` takes `timeoutSeconds` up to 55 and returns `{run, timedOut}`. Repeat
that wait for longer jobs. Read [MCP configuration](docs/mcp.md) for host examples
and [agent workflows](docs/agents.md) for the complete API.

## Configure an AI provider when needed

The local example uses real image processing without AI inference. For AI work,
inspect `providers --json` and configure the user's selected provider in
**Settings → Providers**. A fresh clone has no inherited gallery, provider login,
API key, or model weights. Missing setup is a reason to configure that provider
before running. Never switch accounts or providers to bypass setup.

CLI subscriptions and separately billed APIs have different authorization.
Keep keys out of prompts, graphs, exports, source files, and project pointers.
Model downloads, SAM setup, and semantic-search downloads are explicit optional
actions. Read [provider setup](docs/PROVIDERS.md), [local models](docs/local-models.md),
and [agent skills](docs/agent-skills.md) for those tasks.
