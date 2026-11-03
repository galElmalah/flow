# Overview

Flow already has the needed provider, graph, project, persistence and inference boundaries. The requested assistant belongs in the application shell as a persistent dock. It should receive explicit page context, invoke existing text harnesses, and let the platform validate/apply changes. Path navigation should reuse existing viewer ownership validation while replacing scattered query-string writers with one route codec.

# Key concepts

- **Live canvas:** `App` owns the current graph, selection, page, run and modal/editor identity. The rendered graph can be ahead of its persisted copy.
- **Workflow draft:** `WorkflowSaver` stages graph changes and serializes writes per workflow after 650 ms. It protects one browser's writes, not concurrent agents.
- **Recorded run:** an immutable graph/project/job snapshot. Editing it requires a fork.
- **Provider:** the registry selects the actual Codex, Claude, Gemini, Pi or compatible API integration and checks capabilities/readiness. Authentication stays server-side.
- **Edit versus generate:** changing scene records/prompts is a graph edit. Image generation separately plans/preflights/submits through the existing queue.

# How it works

```text
Current page + live graph + selection
                  │
             App / AgentDock
                  │ immutable turn context
       Persisted scoped conversation service
                  │
       ProviderRegistry → isolated text harness
                  │ bounded structured answer
        Validate edits + check unchanged base
                  │
        Save graph → reconcile UI draft / Undo
                  │ explicit generation request
        startWorkflowRun → Queue → image provider
```

Current native text adapters deliberately disable tools and return one final answer. Their common brief also hardcodes "image prompt writer," so app-agent requests need an explicit task purpose. A constrained JSON response containing assistant text and graph edits fits this architecture: the model proposes; the host validates and performs application actions. It does not require shell authority or four native tool-loop implementations.

Persist conversations per workflow/project in the local store, capturing target context with each turn. Store user turns before invocation, use stable request IDs, allow one active turn per conversation, support cancellation, and mark unfinished turns interrupted after restart. Reply with changed graph/node identities and an observable summary.

Context should include page, project/workflow/run IDs, read-only state, selected nodes, inspected image, and editor/region identity. Resolve ownership again on the server. App can still retain an old workflow while displaying Projects, so the workflow ref alone is not page context.

Keep one dock mounted at shell level across canvas, Projects, Gallery and Styles. The current toolbar exists only in the canvas branch. Extract its controls into a slot beside a persistent composer; expand width and grow the transcript upward from that same bottom anchor. A fullscreen image editor traps focus, so its agent entry needs a slot inside that dialog rather than an unreachable external overlay.

Use one shared route codec for browser and CLI/MCP viewer links. Suggested resource paths: `/projects`, `/projects/:project/workflows/:workflow`, optional `/gallery`, `/styles`, `/runs/:run`, plus `/workflows/:workflow` for unassigned workflows. Preserve legacy query input and normalize to paths. Push actual page transitions, replace transient selection, and handle `popstate`.

# Where things live

| Responsibility | Existing files |
| --- | --- |
| Shell, live context, switching, toolbar | `src/App.jsx`, `src/style.css` |
| Draft reconciliation and graph snapshots | `src/canvas/workflow-saver.mjs`, `graph-state.mjs` |
| Viewer validation and generated links | `src/canvas/viewer-target.mjs`, `client/viewer.mjs` |
| Project and persistent documents | `server/projects.mjs`, `server/store.mjs` |
| Graph schema and HTTP writes | `shared/graph.mjs`, `server/routes/workflows.mjs` |
| Providers and bounded processes | `harness-integrations/registry.mjs`, `harnesses.mjs`, `shared/text.mjs` |
| Inference lifecycle | `server/run-service.mjs`, `server/queue.mjs` |
| Public agent access | `client/index.mjs`, `cli/flow.mjs`, `mcp/server.mjs` |

# Gotchas

- Full workflow PUT currently has no revision/CAS. Flush the current draft before sending and compare its exact base at apply time; reject stale changes rather than overwrite human edits. Reconcile the saver cache after server changes.
- Navigation during inference must not apply a reply to the newly active workflow. Capture target identity and verify it when rendering/applying.
- SSE broadcasts queue events, not external graph edits. A successful agent response must explicitly refresh the current graph.
- Native text output is buffered, so show truthful stages rather than fake token streaming.
- Production Express lacks SPA fallback; direct nested-path refresh needs guarded HTML fallback after API/files routes.
- URL writes also exist in ProjectsPage and ImageEditor; migrate them with App and client links.
- Preserve graph limits, local asset validation, rules/styles/record IDs and socket types. Keep keys out of chat, graph and logs.
