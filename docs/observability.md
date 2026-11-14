# Inspect traces and metrics

Flow records OpenTelemetry traces locally without a collector or cloud account.
Use them to distinguish queue waits, input preparation, provider time and response
streaming. The [reference](opentelemetry-reference.md) lists configuration, coverage,
metrics and retention limits.

## Inspect a workflow run

Create a local-only demo and keep its returned `runId` and `projectId`:

```sh
node tools/demo.mjs --json
node cli/flow.mjs trace RUN_ID --project PROJECT_ID --json
```

The SDK method is `client.runTrace(runId)`, MCP tool is
`read_run_trace({runId})`, and HTTP route is
`GET /api/runs/RUN_ID/trace?projectId=PROJECT_ID`. The result is
`{runId, traceId, spans}`. It includes the submission and its retained job attempts,
input capture and provider spans, scoped to that run's branch. Active spans appear
when they end. Historical, unsampled, disabled or rotated traces can return an
empty list; use `inspect` for durable job status.

An agent with an existing OpenTelemetry SDK can use `FlowClient` inside an active
span to carry W3C context into the server. HTTP errors expose `error.traceId` in the
SDK and CLI JSON error. Flow does not forward context to provider APIs or subprocesses.

## Inspect agent streaming

Open an agent reply's **Timing** disclosure for server milestones, browser render
observations, model/reasoning settings and a span waterfall. Refresh preserves saved
milestones. Existing replies do not receive invented historical timings.

```sh
node cli/flow.mjs agent trace SESSION_ID TURN_ID --project PROJECT_ID --json
```

The SDK method is `agentTrace(sessionId, turnId)`; MCP provides `read_agent_trace`.
`GET /api/agent/sessions/SESSION_ID/turns/TURN_ID/trace` returns the same scoped
information. Normal conversation reads also contain `turn.timing`.

## Export to a local collector

1. Install an OpenTelemetry Collector distribution with the OTLP receiver and debug
   exporter. Start it with the supplied configuration:

   ```sh
   otelcol --config observability/collector.yaml
   ```

2. Stop an idle Flow server, then start it with a collector endpoint:

   ```sh
   OTEL_SERVICE_NAME=flow \
   OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
   npm start
   ```

   Run `npm run build` first if browser assets have not been built. `flow serve`
   reuses an existing server, so it cannot apply new variables to that process.

3. Run the demo or a workflow. Inspect the collector's output for traces and
   `http.server.request.duration`, `flow.job.duration`, `flow.job.queue.duration`
   and `flow.job.attempts`. Metrics export every 60 seconds by default.

The default wire format is OTLP HTTP/protobuf. Set
`OTEL_EXPORTER_OTLP_PROTOCOL=http/json` for OTLP HTTP/JSON. The base endpoint gets
`/v1/traces` and `/v1/metrics` appended; signal-specific endpoints are complete URLs.
Only loopback collectors are accepted. The example collector prints telemetry;
configure its exporters separately to retain or visualize it.

`GET /api/server` reports `telemetry.enabled`, `serviceName` and configured
`otlp.traces`/`otlp.metrics` flags. These flags describe configuration, not collector
health. `/api/guide/observability` serves this guide to local agents.

## Troubleshoot missing data

- Check the server's startup environment. `OTEL_SDK_DISABLED=true` or
  `FLOW_OTEL_ENABLED=0` disables telemetry, including local traces.
- For empty run traces, check job status and the run's `telemetry` receipt.
  Spans appear after completion and can expire through rotation or sampling.
- For missing collector data, check the endpoint, protocol and receiver logs.
  Local traces still work when the collector is unavailable. Reading a local trace
  does not wait for a collector export.
- For missing metrics, configure their endpoint or the shared base endpoint,
  perform some work and wait one export interval. Traces-only configuration does
  not create metrics.
- Do not preload a second telemetry SDK into the Flow server. Flow registers its
  own async context manager and global providers.

Local JSONL files rotate at 10 MiB with two backups. Flow's spans exclude prompts,
replies, images, credentials, bodies and exception text. See the
[reference](opentelemetry-reference.md#privacy-and-retention) before adding new
instrumentation or changing retention.

## Compare streaming latency

```sh
node tools/sample-agent-latency.mjs --project PROJECT_ID --workflow WORKFLOW_ID \
  --samples 5 --out /tmp/flow-latency.json
```

This command uses real Codex text inference for short read-only questions. It never
applies proposals or starts image jobs. It creates a fresh scoped conversation for
each sample, verifies a reply with no edits, counts failures and writes timing/span
records without response content. Use an isolated QA project, then archive it
through the platform API. Compare saved phases across repeated, alternating runs
before claiming a speedup.

Server milestones use one monotonic clock from acceptance. Browser observations use
`performance.now()` from submit and two animation frames after the reply commits;
this is not a compositor paint guarantee. Refresh cannot recreate that browser
clock. Browser-to-server comparisons include transport and polling, so do not
subtract the clocks as if synchronized. Span durations overlap and are not additive.

The upstream request-to-first-delta span includes network, provider scheduling and
model processing. It cannot separate those without upstream telemetry. A high
reasoning setting is a diagnostic clue, not proof of a speedup at another setting.
