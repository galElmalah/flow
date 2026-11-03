---
name: flow-workflows
description: Create, fork, plan and run image or video workflows through the local Flow platform. Use when a project needs seed-based generation, parallel batches, provider comparisons, or output lineage.
---

# Flow workflows

Use the installed helper by its absolute path: `node <this-skill-folder>/scripts/flow.mjs ...`. It reaches the Flow installation without depending on shell aliases; keep your working directory in the consuming project so `.weft-project.json` discovery works. Run `--help` for the current command contract.

## Find the project and direction

- `serve --json` starts or reuses the installation server. `projects --search NAME --json` and `workflows --project ID --json` discover saved work.
- A consuming project's `.weft-project.json` points to its local server and project. `project init --project ID --name NAME --root /absolute/project --json` registers it. Use an explicit project for cross-directory work.
- Read `workflow ID --json` before changing a graph. Fork shared or recorded work with `fork ID --project ID --name NAME --json`; use `--run RUN_ID` to fork the historical graph.
- `guide --json` and `schema --json` describe supported operations. Use HTTP, MCP or the JavaScript client for graph edits; do not edit SQLite or JSON mirrors.

## Build and generate

`workflow create --project ID --name NAME --prompt "Base direction" --seed-image /absolute/reference.png --provider PROVIDER --model MODEL --count 1 --json` saves a source → prompt → generator → collection flow without generating. Add `--records /absolute/records.json`, `--template /absolute/template.txt` and `--prompt-provider PROVIDER` for per-record scenery. Give records stable IDs and explicit scene/cast fields when variation matters.

Use `providers --json` to check readiness, real models and auth requirements. Each node selects its own provider; a CLI subscription does not automatically authorize a provider's paid API.

For a collection of scenes sharing one template, use `workflow create --prompts /absolute/scenes.json` rather than duplicating record/template/generator branches. Each scene has stable `id`, `label`, `scene`, optional `concept`, `enabled`, `count`, `seed`, `ratio` and image references. Discover the current schema. `prompt-set preview WORKFLOW_ID --node SET_ID --items SCENE_ID --json` inspects planned prompts without inference. Plan/run with `--prompt-set SET_ID --items ID,ID` to scope a subset; omit `--items` for every enabled scene. Selection preserves other scenes' results and never mutates the saved graph. `docs/prompt-sets.md` explains defaults and recorded lineage.

For provider comparisons, inspect the live schema and pass `--modes /absolute/modes.json`. Each mode has `id`, `label`, `providerId` and optional model/count/settings. The platform records the inputs and output lineage per job. Never put keys into prompts, workflow JSON or project manifests.

1. `plan --project ID --workflow ID --json` previews actual job counts. `--count` is copies per record, not a total. Scope one branch with `--node OUTPUT_ID`.
2. When generation is requested, `run --project ID --workflow ID --concurrency 4 --json` returns a run ID. Concurrency is a queue ceiling, subject to provider and GPU limits; 4/8/16 are useful batch settings.
3. Keep that ID: `wait RUN_ID --timeout 600 --json` and `inspect RUN_ID --json` recover progress. Retry/resume that run rather than submitting it again after a timeout.
4. `assets --project ID --json` and `asset lineage ASSET_ID --json` expose provenance. Follow the consuming project's review rules before copying outputs into it.

`open ID --project ID --json` opens the viewer. Add `--node ID`, `--run ID`, `--gallery`, or `--print-url` to link the exact context. Opening never starts inference. For text-only prompt inspection, prefer read operations over a new run.
