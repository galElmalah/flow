# Trace streaming latency locally

Open a new agent reply's **Timing** disclosure to inspect server milestones, browser
render timing, the configured Codex model/reasoning level, and an OpenTelemetry
waterfall. Existing replies have no invented historical timings. Refresh preserves
saved milestones and first-render observations in the conversation's SQLite record.

The local server initializes the OpenTelemetry Node tracing SDK at startup. Manual
spans cover HTTP routes, page-context resolution, agent SQLite saves, provider
preflight, the provider request, Codex process/RPC setup, request-to-first-answer-delta
wait and answer streaming. These spans overlap; their durations are not additive.

```sh
node cli/flow.mjs agent trace SESSION_ID TURN_ID --project PROJECT_ID --json
```

The client method is `agentTrace(sessionId, turnId)`; MCP provides `read_agent_trace`.
`GET /api/agent/sessions/SESSION_ID/turns/TURN_ID/trace` returns the same scoped timing
and spans. `/api/server` reports whether tracing is enabled. Normal conversation reads
also contain `turn.timing` with trace/span IDs and elapsed server milestones.

## Storage and export

The default exporter writes private JSONL spans beneath `.flow/telemetry/`. It rotates
at 10 MiB and keeps the current file plus two previous files. File permissions are
0600 and the directory starts at 0700. Detailed spans expire with rotation; conversation
milestones remain in SQLite. No collector or cloud account is required.

Prompts, replies, images, request bodies, headers, complete URLs, configuration
objects, credentials, reasoning text and raw process output are excluded. Recorded
attributes are allowlisted IDs, counts, phases, numeric durations, route templates,
status codes and configured model/reasoning labels. Errors record a failure status,
not exception messages/stacks. Export writes are asynchronous and outside model waits.

Set `FLOW_OTEL_ENABLED=0` before restarting an idle server to disable SDK export.
For an optional local OTLP collector, set
`FLOW_OTEL_OTLP_ENDPOINT=http://localhost:4318/v1/traces` before startup. Only loopback
collector URLs without URL credentials are accepted. The service name is `flow`.
The exporter is tested against an actual local HTTP collector fixture. External
telemetry export is not enabled.

## Reproduce the diagnosis

```sh
node tools/sample-agent-latency.mjs --project PROJECT_ID --workflow WORKFLOW_ID \
  --samples 5 --out /tmp/flow-latency.json
```

This command uses real Codex text inference for short read-only questions. It never
applies proposals or starts image jobs. It opens a fresh scoped conversation for each
sample, verifies a valid reply with no edits, counts failures and writes timing/span
records without response content. Use an isolated QA project, then archive it through
the normal platform API. Keep timing receipts local and compare the saved phases
across repeated runs.

Server milestones use one monotonic clock from acceptance. Browser timing uses
`performance.now()` from the submit action, with two animation frames after the reply
commits while the open chat follows the response. It is a render observation, not a
compositor paint guarantee. Browser observations are numeric, validated, scoped and
stored once per turn. Refreshing midway cannot recreate the original browser clock,
so it never fabricates click timing. Browser-to-server comparisons include request
transport and polling; do not subtract clocks as if they were synchronized.

The upstream request-to-first-delta span includes network, provider scheduling and
model processing. It cannot distinguish these without upstream telemetry. A high
reasoning setting is a diagnostic clue, not proof of a quantified speedup at another
setting. Compare repeated, alternating runs before claiming a performance improvement.

Implementation: `observability/tracing.mjs`, `server/agent/service.mjs`,
`harness-integrations/codex/text-stream.mjs`, `src/agent/AgentTiming.jsx`.
The SDK setup follows [OpenTelemetry manual instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/)
and the [exporter configuration](https://opentelemetry.io/docs/languages/js/exporters/).

## Faster interactive chat

Codex chat now defaults to medium reasoning, independently of the global Codex config.
Use the chat's thinking setting to choose Fast, Balanced, Thorough, Extra thorough, or
Harness default. API/MCP asks accept `reasoningEffort`; CLI accepts `--reasoning`.
The effective model and effort remain visible in Timing. Other providers are unchanged.
To compare reasoning settings, alternate them across the same questions and report
failed samples alongside timing results. Provider conditions can vary between runs.

Chat uses the same `/api/events` connection as workflow events, scoped with `sessionId`
and optional `projectId`. `type:agent` carries a compact durable session snapshot with
`streamRevision`. The UI rejects older snapshots, reconnects from saved state and polls
only as a connection-failure fallback. Preview persistence still uses a 150 ms checkpoint.
Streamdown handles incoming Markdown and a bounded, reduced-motion-aware word reveal;
its renderer is loaded separately from the initial canvas bundle.
