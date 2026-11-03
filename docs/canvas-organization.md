# Organize the canvas

**Organize** in the bottom canvas toolbar arranges sources, processing nodes and outputs
from left to right, using the current card sizes. Existing section frames resize around
their members. It changes layout only; prompts, connections and generation settings stay
intact. One Undo restores the prior arrangement. Recorded runs remain read only.

The icon-only toolbar button shows **Organize nodes** on hover or keyboard focus.
Connections use individual curves between their sockets.

## Use from an agent

Read the latest workflow first. Then use the current revision:

```js
const workflow = await client.workflow(id);
const { workflow: organized, diagnostics } = await client.organizeWorkflow(id, {
  revision: workflow.revision,
  preview: true,
});
```

`preview: true` returns the proposed layout without saving. Omit it to save one new
revision. Concurrent edits return409; read again before retrying. No image or video
inference starts. Scoped clients enforce project ownership.

```sh
node cli/flow.mjs workflow organize WORKFLOW_ID --project PROJECT_ID --plan --json
node cli/flow.mjs workflow organize WORKFLOW_ID --project PROJECT_ID --json
```

MCP `organize_workflow` and `POST /api/workflows/:id/organize` accept the same fields,
plus optional `geometry`. It maps node IDs to graph-space `{width,height,ports?}`. Each
port has `{id,kind:"source"|"target",x,y}`, relative to its card. The browser supplies
measured dimensions; headless callers can supply `--geometry geometry.json`. Without
measurements, the shared layout uses conservative estimates and reports their IDs in
`diagnostics.estimatedNodeIds`. Check the viewer after changing dynamic card content.

DOM measurements are transient and never enter workflow exports or inference inputs.
