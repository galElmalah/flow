# Change a workflow through the in-app agent

Open a workflow and use the **Agent** composer in the bottom toolbar. The toolbar widens and opens the conversation above it. The conversation stays available on Projects, the canvas, Gallery, Styles, and the image editor. **New agent conversation** starts another conversation while retaining earlier history. Each conversation holds up to 100 messages; the model receives recent history.

1. Check the context line above the conversation. It names the current project and workflow, selected node, style, or image regions.
2. Choose a signed-in text harness. Codex uses the existing CLI subscription sign-in. Claude Code, Gemini CLI, Pi, and configured OpenAI-compatible text models use their existing provider setup.
3. Describe the change. For the sports workflow, try “Change the sports to tennis, swimming, and cycling. Keep the monochrome motion-blur style and image settings.”
4. Read the reply and saved-change receipt. Reversible workflow edits apply automatically while that live workflow remains current. If you navigate away, the proposal stays in the conversation for you to apply later.
5. Use **Undo change** to restore the previous graph. A newer content edit causes a conflict rather than overwriting your work.

The agent changes scene records, prompts, node settings, labels, and graph connections through validated operations. Chat never starts image generation. Use **Run workflow** when the inputs are ready. Recorded runs and image-editor conversations support inspection; original recorded graphs remain immutable. Region edits use the editor's existing prepare/send controls.

If the workflow changes while a reply is prepared, send a new message against the current graph. Pan and zoom changes are preserved and do not block a proposal. Conversations persist in local SQLite. Each message records the page context it used. Text inference sends that context, conversation history, and any inspected image to the selected provider.

Refreshing the browser reconnects to the same conversation and pending turn without
submitting another request. Per-tab session storage remembers each project's chat
visibility, harness, model and unsent draft; an active reply reopens the chat. Only
that tab's original pending auto-apply intent can resume, subject to the same current
page, workflow and revision checks. The server remains authoritative for execution.
Pending replies show their actual provider stage, elapsed time from the saved start
timestamp and an indeterminate activity line; no model completion percentage is
estimated. Restarting the server interrupts work and is distinct from refreshing a tab.

The workflow canvas restores a running or paused run ahead of newer finished history.
Run status shows completed, active and queued jobs, plus a progress bar for all finished
jobs (including failures, cancellations and interruptions). Provider progress messages
update the visible stage. Event-stream reconnection refetches the server snapshot;
explicit recorded-run URLs retain their historical graph and images.

## Use the same agent from CLI or MCP

```sh
flow agent schema --json
flow agent session --project sports-agent-visuals --json
flow agent ask --project sports-agent-visuals --workflow sports-motion-monochrome-v1 \
  --prompt "What sports are configured here? Do not edit anything." --provider codex-text --json
flow agent read SESSION_ID --project sports-agent-visuals --json
flow agent apply SESSION_ID TURN_ID --project sports-agent-visuals --json
flow agent undo SESSION_ID TURN_ID --project sports-agent-visuals --json
```

A request uses text inference to return a reply and a typed proposal. CLI and MCP callers explicitly apply ready proposals. Reuse the same request UUID to retry without invoking the model again. `cancel` stops a pending message. An interrupted server restart marks the turn interrupted and never resubmits it automatically.

MCP tools are `agent_context_schema`, `open_agent_conversation`, `read_agent_conversation`, `ask_page_agent`, `apply_agent_changes`, `cancel_page_agent`, and `undo_agent_changes`. The JavaScript client exposes `agentSession`, `agentConversation`, `askAgent`, `applyAgentTurn`, `cancelAgentTurn`, and `undoAgentTurn`. `GET /api/schema/agent` returns the message and context contracts.

## Streaming replies and engine choices

Pending turns expose `preview: {text, updatedAt}` through the existing conversation
reader, CLI and MCP. The UI refreshes active conversations every 250ms and shows the
growing reply with a writing indicator. These are real provider output snapshots;
the UI does not animate an already completed answer. Scrolling upward pauses following
the growing response. Cancelled, failed and interrupted replies keep their clearly
marked partial text. Only a complete validated `answer` can produce an apply action.

Adapters expose their visible answer text through an optional `onText` callback.
Codex uses ephemeral app-server `item/agentMessage/delta`; Claude uses text-block
stream events; Gemini and Pi use JSON assistant text events; compatible APIs use
content SSE. Reasoning, tool and wire-event data never become chat text. The agent
service projects only the root JSON `message`, then Registry scrubs credentials after
decoding escapes and holds possible split credential prefixes. Preview persistence
is throttled to 150ms. No new inference or retry is submitted to refresh a preview.

Whole-answer validation, read-only contexts, revision guards and explicit image-run
boundaries retain their existing behavior. The browser uses a 250ms active poll over
durable snapshots, not a separate SSE endpoint. Older incompatible CLI stream formats
fail visibly; an API's explicit nonstream JSON response remains final-only without a
second billed attempt.

Harness and model menus show vendored monochrome integration/model-family marks in
both selected controls and searchable option rows. Built-in harnesses currently
advertise their configured default; the interface does not invent a live model catalog.
BYOK exposes its configured models. Local assets and their license are in
`public/harnesses/`. Preview projection lives in `server/agent/message-preview.mjs`;
credential projection policy lives in `harness-integrations/shared/preview.mjs`.

The chat has one **Harness & model** dropdown. Harness rows open model submenus;
search matches both names and model IDs, including queries such as `codex default`.
Use Up/Down to move, Right/Enter to enter a model submenu, Left/Escape to return,
and Enter to select. On narrow screens the submenu replaces the harness list and
includes a Back button. The selected harness/model pair survives refresh.

Each new turn stores `activity` alongside its status and streamed reply in SQLite.
Expandable cards expose the platform's actual page-context read, harness request,
proposal validation, apply, cancellation and undo operations, with inputs, results,
timestamps and running/completed/failed/cancelled/interrupted states. Proposed
workflow operations remain labelled **proposed** until an atomic apply receipt exists;
undo changes that label to **undone**. Failed transactions never claim applied edits.
These are host platform operations, not arbitrary model shell calls. The text harness
still has shell/MCP tools disabled. Older conversations retain their existing replies
and receipts; the UI does not fabricate historical activity. CLI/MCP conversation
reads return the same saved activity records as the UI.

## Open resource paths

The local viewer uses paths such as `/project/sports-agent-visuals/workflow/sports-motion-monochrome-v1`, followed by `/gallery`, `/styles`, `/run/RUN_ID`, or `/node/NODE_ID`. Standalone pages use `/projects`, `/project/PROJECT_ID`, `/gallery`, `/styles`, or `/editor/EDITOR_ID`. Existing query links are accepted and normalized to paths. CLI and MCP viewer links use the same path builder. Browser Back and Forward restore the corresponding page.

Workflow documents include a `revision`. Read the current graph before updating it and retain that revision in PUT requests. A stale save returns409 and leaves the local draft intact. A successful save returns the next revision. Forks start their own revision history at zero.

The picker now advances from providers to models within one animated surface, with
model-aware thinking controls at the top. Ollama is a native HTTP integration;
Codex/Claude/Gemini/Pi use their own CLI adapters. Pi does not route the other
providers. See [provider/model routing and thinking](provider-model-picker.md).
