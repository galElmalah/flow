# OpenTelemetry reference

Flow initializes the OpenTelemetry Node SDK when the local server starts. Traces
are saved locally by default. Collector export is optional. Follow the
[observability guide](observability.md) for setup and troubleshooting.

## Configuration

Set variables before starting the server. Restart an idle server to apply changes;
`flow serve` reuses an existing server and cannot change its environment.

| Variable | Behavior and default |
| --- | --- |
| `OTEL_SDK_DISABLED=true` | Disables Flow's SDK, including local traces. |
| `FLOW_OTEL_ENABLED=0` | Also disables Flow's SDK. |
| `OTEL_SERVICE_NAME` | Resource service name; defaults to `flow`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL; appends `/v1/traces` and `/v1/metrics`. Unset by default. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Complete traces URL; overrides the base URL for traces. |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Complete metrics URL; overrides the base URL for metrics. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (default) or `http/json`. No gRPC support. |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | Per-signal protocol override. |
| `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER` | `none` disables that collector signal; `otlp` enables it, defaulting to `http://localhost:4318` if no endpoint is set. Neither disables local trace storage. |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | Positive integer milliseconds; defaults to 2000. |
| `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`, `OTEL_EXPORTER_OTLP_METRICS_TIMEOUT` | Per-signal timeout override. |
| `OTEL_METRIC_EXPORT_INTERVAL` | Positive integer milliseconds; defaults to 60000. Must be at least the metrics timeout. |
| `FLOW_OTEL_OTLP_ENDPOINT` | Legacy complete traces URL. Overrides standard traces endpoints and defaults to `http/json`. Prefer standard settings for new installations. |

Collector URLs must use HTTP or HTTPS on `localhost`, `127.0.0.1` or `[::1]`,
without URL credentials, query strings or fragments. Invalid enabled configuration
fails startup. No collector traffic occurs unless an endpoint or an `otlp` exporter
is configured. Metrics are created only when their collector export is configured.

The exporters also support their SDK's standard OTLP header settings. Keep secrets
in the process environment, outside graphs and source control. The trace SDK honors
standard sampler and batch-processor settings, including `OTEL_TRACES_SAMPLER`,
`OTEL_TRACES_SAMPLER_ARG` and `OTEL_BSP_*`. Sampling also affects local trace storage.

Flow owns its server's global tracer, async context manager and optional meter
provider. Do not preload another telemetry SDK into that process. This integration
does not install automatic instrumentation, browser exporters, baggage propagation
or an OpenTelemetry logs pipeline.

## Trace coverage

| Span | Covers |
| --- | --- |
| `METHOD /api/route/:id` | HTTP handling, with SERVER kind, route template, status and duration. |
| `workflow.submit` | Saving the initial run receipt. Ends before jobs finish. |
| `workflow.job` | One execution attempt, including inputs, provider execution and result handling. |
| `asset.inputs.capture`, `asset.inputs.freeze` | Capturing and freezing input assets. |
| `provider.execute` | The provider adapter call. |
| Agent spans | Context resolution, persistence, preflight, provider requests and streaming milestones. Codex adds process/RPC and first-delta spans. |

Incoming W3C `traceparent` context is extracted on HTTP requests. Active context
survives asynchronous work. Run and job receipts persist trace/span IDs and sampling
flags; retries after storage reload remain children of the original submission.
Historical runs without receipts start new job traces when retried.

The JavaScript client injects an active W3C context when one exists, and preserves
an explicitly supplied `traceparent`. API responses carry `X-Flow-Trace-Id`;
SDK, CLI JSON and MCP failures expose it as `error.traceId` when
available. Flow does not propagate context to provider APIs or subprocesses.

SSE events, trace reads and timing-report requests are excluded to avoid
self-observation loops. Run trace reads return only the submission branch, excluding
sibling runs and HTTP ancestors. Project scope is checked before reading. Empty
spans can mean active, unsampled, disabled, historical or rotated data; they do not
mean that execution never happened.

## Metrics

Durations use seconds. By default, export uses cumulative temporality and a
60-second interval.

| Instrument | Type | Attributes |
| --- | --- | --- |
| `http.server.request.duration` | Histogram | HTTP method, route template, status code; `error.type` for a disconnected response. |
| `flow.job.duration` | Histogram | Job kind, provider ID and final attempt status. |
| `flow.job.queue.duration` | Histogram | The same job attributes. Enqueue-to-start time; retries reset enqueue time. |
| `flow.job.attempts` | Counter | The same job attributes. Counts finished attempts, including failures and interruptions. |

Histogram views retain only those attributes and cap each instrument at 2000
series. HTTP buckets range from 5 ms to 10 s; job and queue buckets extend to 30
minutes, followed by an overflow bucket. IDs, prompts, model labels and request
paths are not metric labels.

## Privacy and retention

Flow's instrumentation allowlists IDs, counts, phases, route templates, status
codes, provider/model labels and numeric timings. It excludes prompts, replies,
images, bodies, headers, complete URLs, credentials, reasoning, raw process output
and exception messages/stacks. The OTLP exporter receives the same Flow attributes.
Independently added instrumentation must implement its own filtering.

Local traces live in `.flow/telemetry/` (or `FLOW_DATA_DIR/telemetry/`). Files are
created with mode 0600 and the directory with 0700. JSONL rotates at 10 MiB, retaining
the current file and two backups. Agent milestones and run receipts remain in
SQLite after detailed spans rotate out. Local trace reads wait for local writes
only. Collector traces are batched; graceful shutdown drains jobs and flushes
exporters within the server's five-second deadline. Forced termination can lose
pending exports.

See the official [JavaScript instrumentation guide](https://opentelemetry.io/docs/languages/js/instrumentation/)
and [exporter guide](https://opentelemetry.io/docs/languages/js/exporters/)
for SDK concepts. Flow-specific supported options are listed above.
