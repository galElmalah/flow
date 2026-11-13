# Flow files and upgrades

Workflow exports use `*.flow.json`. They are UTF-8 JSON with a format marker and version:

```json
{
  "format": "flow",
  "version": 1,
  "workflow": {
    "id": "example",
    "name": "Example",
    "nodes": [],
    "edges": []
  }
}
```

The `workflow` value follows the graph schema at `GET /api/schema/workflow`. The full file schema is at `GET /api/schema/flow`. Unknown format names and versions are rejected. Plain graph JSON from earlier versions remains readable; new exports always use the Flow format. Renaming a JSON file does not convert its content.

```sh
node cli/flow.mjs export WORKFLOW_ID --output campaign.flow.json
node cli/flow.mjs import --from campaign.flow.json --json
node cli/flow.mjs plan --workflow WORKFLOW_ID --json
```

Use the imported graph's returned `id` for `WORKFLOW_ID`. CLI planning accepts saved workflows and never imports graphs or uploads references as a side effect. The SDK can also plan an explicit graph snapshot through `client.plan(graph)` without saving it.

The canvas imports and exports the same format. The JavaScript client exports `toFlowFile`, `fromFlowFile` and `flowFileName`. Files contain graph settings and local reference URLs, not image bytes or provider credentials. Upload or copy referenced assets when transferring a workflow to another installation.

## Project pointers

Each consuming project uses `flow.project.json` at its root. It identifies a local server, project ID and optional default workflow. The nearest pointer is discovered from child directories. The pointer is local configuration and is ignored by the platform repository's release checks.

```json
{
  "version": 1,
  "projectId": "my-app",
  "serverUrl": "http://localhost:4310",
  "defaultWorkflowId": "campaign"
}
```

Use `project init` to create this file. Do not put keys or passwords in it.

## Upgrade an existing Weft installation

Build the updated source, inspect the plan, then migrate:

```sh
npm ci
npm run build
node cli/flow.mjs migrate --plan --json
node cli/flow.mjs migrate --json
node cli/flow.mjs skills install --json
```

Migration refuses to stop active jobs or touch a server from another workspace. It moves the default data directory from `.weft/` to `.flow/`, renames the SQLite database to `flow.sqlite`, and backs up the old database under `.flow/migration-backup/`. Conflicting data directories or project pointers produce an error instead of being merged.

Registered consuming projects receive `flow.project.json`. Their agent instructions and ignore rules are updated, with originals backed up locally. Workflow IDs, run IDs, asset URLs and immutable lineage stay unchanged. Historical IDs and receipt text may still contain the old name.

A private `.weft` symlink points to `.flow` when existing data is moved. Installed Python environments contain absolute paths; the alias keeps them usable without another model download. New files and paths use `.flow`. Do not remove the alias until those environments have been rebuilt at their new paths. The alias and private data are excluded from Git.

Custom `FLOW_DATA_DIR` locations require a separate explicit storage migration. After migration, restart any local engines you were using. Legacy `WEFT_*` environment variables and the `weft` CLI entrypoint are replaced by `FLOW_*` and `flow`.
