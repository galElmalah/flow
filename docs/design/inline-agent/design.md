# Inline agent design

## Problem

The assistant needs the visible page as context and must edit saved workflows without overwriting concurrent browser drafts. Existing text providers already isolate each invocation and share authentication. Existing workflow PUT lacks conflict detection.

## Usage

```js
const session = await client.agentSession({ projectId });
const turn = await client.askAgent(session.id, {
  id: crypto.randomUUID(), message: 'Change the sports to tennis, swimming and cycling',
  providerId: 'codex-text',
  context: { page: 'canvas', workflowId, revision, selectedNodeIds: [] },
});
// Poll session. A completed turn contains an answer and validated edit proposal.
const receipt = await client.applyAgentTurn(session.id, turn.id);
// Server returns the saved graph or a conflict; App checkpoints and reseeds its clean saver.
```

Browser and CLI viewer links use `viewerPath({project,workflow})`, yielding `/project/PROJECT/workflow/WORKFLOW`. Legacy query links remain accepted on input.

## Shape

- `shared/agent.mjs`: page/send/answer schemas; typed graph operations and pure application.
- `server/agent/service.mjs`: persisted project conversations, provider invocation, cancellation, proposal application and undo receipts.
- `server/routes/agent.mjs`: supported HTTP boundary, shared by browser/client/CLI/MCP.
- `shared/graph.mjs`: workflow revision defaults to zero; every existing workflow PUT checks and increments it.
- `src/canvas/workflow-saver.mjs`: incorporates returned revisions into any newer staged draft.
- `shared/viewer-routes.mjs`: path encoding and legacy link decoding; `src/studio/navigation.mjs` owns history writes.
- `src/agent/AgentDock.jsx`: persistent conversation UI and canvas-controls slot, upward expansion, and editor-dialog portal.

Agent turns snapshot the current workflow revision and page. Model output can update node data, rename, add/remove nodes, or connect/disconnect valid edges. Project ownership and workflow IDs are never model-editable. Empty operations support questions. The server validates the entire resulting graph and local references before committing. Recorded runs are read-only. Image generation stays on the existing explicit Run workflow control.

## Synthesis decision

Base: candidate A's server-owned durable proposals and checked commits, with candidate B's client-owned undo checkpoint, context-drift guard, and dock accessibility. Scores (0–2 per rubric criterion): A 2/2/2/2/2/2, B 2/1/2/2/2/2. B exposes proposal commit/recovery to each CLI/MCP caller and leaves a second stale-write problem unless the same revision boundary is added. Keep one server commit operation and return its receipt. The UI auto-applies reversible edits only while the same saved revision remains current; otherwise the proposal remains available and reports conflict.

Default Claude/Grok model families are unavailable here. Two independent inherited-model candidates were compared end to end. Cross-family judging was unavailable and skipped. Both candidates agreed on constrained actions, truthful buffered progress, shared route codec, and explicit generation. Rejected unrestricted model shell/MCP authority and whole-graph replacement output.

## Tradeoffs

- Buffered provider replies give real thinking/ready status without fake token streaming.
- Whole-workflow revision conflicts preserve edits rather than guessing semantic merges.
- Project conversations retain earlier turns as context, while every new turn snapshots the current page.

## Verification

147 tests, architecture checks, and the production build pass. Real Codex text inference identified the three original sports, changed scene records and matching labels on an isolated fork, and Undo restored them. Native browser checks covered path refresh, Back/Forward, selected-node navigation, style/region context, toolbar expansion/collapse, modal Tab focus, and a 560px viewport. CLI/MCP expose the same operations; live MCP discovery returned 57 tools. The verification project was archived and the original sports graph was unchanged. Evidence: `docs/qa/inline-agent/verification.json`. No placeholder implementation bodies remain.
