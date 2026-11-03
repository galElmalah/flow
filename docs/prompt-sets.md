# Prompt Sets

A `prompt-set` node replaces repeated record → template branches with named scenes.
Connect shared direction and optional image references to the set, then connect its
text output to an image generator, video generator or AI prompt writer. References
can also connect directly to the generator. The set owns its scene template and
defaults; the generator owns providers and models.

```json
{
  "id": "scenes",
  "type": "prompt-set",
  "position": { "x": 450, "y": 0 },
  "data": {
    "label": "Article scenes",
    "text": "SCENE\n{{scene}}\n\nCONCEPT\n{{concept}}",
    "count": 1,
    "ratio": "2:1",
    "prompts": [
      { "id": "bottleneck", "label": "The bottleneck", "scene": "Parts accumulate before one slow machine.", "concept": "The slowest step sets the pace.", "seed": 0 },
      { "id": "throughput", "label": "Throughput", "scene": "Finished goods cross the loading dock.", "count": 3 }
    ]
  }
}
```

IDs are stable and unique within the set. Up to 500 scenes are supported, within the
existing 5,000-job run limit. `enabled:false` excludes a scene from generation without
deleting it. Item-specific image URLs add to inherited references. Use uploaded local
asset URLs, not filesystem paths. `{{title}}` is the scene label; `{{input}}` inserts
upstream text. Without `{{input}}`, upstream instructions are prepended once.

Run count/seed overrides take precedence over scene overrides, then set defaults,
generation modes, and generator defaults. Clear a UI override to inherit it. Explicit
scene seeds are used exactly for the first copy, including zero; later copies increment.
Inherited seeds use the item's original position and a copy stride, keeping them stable
when a run selects only some scenes. Provider seed semantics still apply: Codex seeds
are variation labels, not a promise of deterministic pixels.

## Human controls

Add **Prompt Set** from the node library. The compact canvas list and editor list scroll
independently. Click a scene to edit its name, scene, concept and optional settings.
**Shared** edits the single template/defaults; **Final prompt** inspects each planned
input/mode with references and first-copy settings without inference. Upstream AI writer
text is marked as pending rather than presented as resolved text.

**Run this scene** scopes its downstream generation branches. **Run enabled** runs the
enabled items. **Rerun failed scenes** creates a new scoped run; normal run-history retry
continues the existing run. Excluded scenes can still be previewed. **Results** opens
generated assets in the existing inspector, with recorded inputs and lineage. A selected
rerun replaces only that scene's visible results; other scenes remain visible after refresh.
Existing output metadata never changes when a scene is edited.

## Agents, CLI and MCP

Create scenes through `createImageWorkflow({prompts, promptSetDefaults, template, ...})`,
CLI `workflow create --prompts /absolute/scenes.json --template /absolute/template.txt`,
or MCP `create_image_workflow`. Scene JSON is an array of the objects above. Full graph
creation/update uses the standard revision-checked workflow API. Agent `update-node`
proposals use the same canonical schema. Preserve item IDs when revising text.

```sh
node cli/flow.mjs prompt-set preview WORKFLOW_ID --project PROJECT_ID --node scenes --items bottleneck --json
node cli/flow.mjs plan --workflow WORKFLOW_ID --project PROJECT_ID --prompt-set scenes --items bottleneck,throughput --json
node cli/flow.mjs run --workflow WORKFLOW_ID --project PROJECT_ID --prompt-set scenes --items bottleneck --concurrency 4 --json
```

Omit `--items` to select every enabled item of `--prompt-set`. An explicitly empty,
unknown or disabled selection is rejected. Selection never modifies the saved graph
and does not run unrelated branches that share an output collection.

HTTP plan/run accept `options.promptSet:{nodeId,itemIds?}`. The JavaScript client and
MCP `plan_workflow` / `run_workflow` pass the same options. Preview uses
`POST /api/prompt-sets/preview {workflowId|workflow,nodeId,itemId,projectId?}`,
`client.previewPromptItem(workflow,nodeId,itemId)`, or MCP `preview_prompt_item`.
Each distinct expanded input/mode is reported separately, with copy totals.

Every generated job and asset provenance stores `promptSet` with the set/item IDs,
label, scene, concept, template, defaults and overrides. Existing `records` also retain
the scene ID and fields. Run snapshots and dataset exports keep those original inputs.

Implementation: `shared/prompt-sets.mjs`, `server/graph.mjs`,
`src/nodes/PromptSetNode.jsx`, `src/panels/PromptSetEditor.jsx`.
`shared/job-results.mjs` defines per-scene result replacement for the server and UI.
Verification: `test/prompt-sets.test.mjs`.
