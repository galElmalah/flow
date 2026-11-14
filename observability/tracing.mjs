import {
  mkdir,
  appendFile,
  readFile,
  stat,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  ROOT_CONTEXT,
  context,
  propagation,
  metrics,
  trace,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { telemetryConfig } from "./config.mjs";
import packageInfo from "../package.json" with { type: "json" };

const allowed = new Set([
  "gen_ai.request.model",
  "gen_ai.request.reasoning_effort",
  "flow.session_id",
  "flow.turn_id",
  "flow.workflow_id",
  "flow.project_id",
  "flow.provider_id",
  "flow.job_id",
  "flow.job.kind",
  "flow.job.attempt",
  "flow.run_id",
  "flow.status",
  "flow.phase",
  "flow.prompt_bytes",
  "flow.output_bytes",
  "flow.node_count",
  "flow.turn_count",
  "flow.preview_chars",
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "error.type",
  "ui.elapsed_ms",
  "ui.prepare_ms",
  "ui.accepted_ms",
  "ui.first_preview_ms",
]);
export const safeAttributes = (attributes = {}) =>
  Object.fromEntries(
    Object.entries(attributes).filter(
      ([key, value]) =>
        allowed.has(key) &&
        ((typeof value === "number" && Number.isFinite(value)) ||
          typeof value === "boolean" ||
          (typeof value === "string" && value.length <= 120)),
    ),
  );
const milliseconds = ([s, ns]) => s * 1000 + ns / 1e6;
function spanRecord(span) {
  return {
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    kind: span.kind,
    startTime: milliseconds(span.startTime),
    durationMs: milliseconds(span.duration),
    attributes: safeAttributes(span.attributes),
    status: { code: span.status.code },
    events: span.events.map((event) => ({
      name: event.name,
      time: milliseconds(event.time),
      attributes: safeAttributes(event.attributes),
    })),
  };
}
class LocalSpanExporter {
  constructor(directory, { maxBytes = 10 * 1024 * 1024 } = {}) {
    this.directory = directory;
    this.maxBytes = maxBytes;
    this.pending = Promise.resolve();
    this.size = 0;
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.size =
      (await stat(path.join(this.directory, "spans.jsonl")).catch(() => null))
        ?.size || 0;
  }
  export(spans, done) {
    const lines = spans
      .map((span) => JSON.stringify(spanRecord(span)) + "\n")
      .join("");
    this.pending = this.pending.then(async () => {
      if (this.size + Buffer.byteLength(lines) > this.maxBytes) {
        await rm(path.join(this.directory, "spans.2.jsonl"), { force: true });
        for (const [from, to] of [
          ["spans.1.jsonl", "spans.2.jsonl"],
          ["spans.jsonl", "spans.1.jsonl"],
        ])
          await rename(
            path.join(this.directory, from),
            path.join(this.directory, to),
          ).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        this.size = 0;
      }
      await appendFile(path.join(this.directory, "spans.jsonl"), lines, {
        mode: 0o600,
      });
      this.size += Buffer.byteLength(lines);
    });
    this.pending.then(
      () => done({ code: 0 }),
      () => done({ code: 1 }),
    );
    this.pending = this.pending.catch(() => {});
  }
  async read(traceId) {
    await this.pending;
    const records = [];
    for (const file of ["spans.2.jsonl", "spans.1.jsonl", "spans.jsonl"]) {
      const data = await readFile(
        path.join(this.directory, file),
        "utf8",
      ).catch((error) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      for (const line of data.split("\n")) {
        if (!line) continue;
        try {
          const span = JSON.parse(line);
          if (span.traceId === traceId) records.push(span);
        } catch {}
      }
    }
    return records.sort((a, b) => a.startTime - b.startTime);
  }
  forceFlush() {
    return this.pending;
  }
  shutdown() {
    return this.pending;
  }
}
let runtime;
export async function initializeTracing({
  dataRoot,
  otlpEndpoint,
  enabled,
  env = process.env,
} = {}) {
  if (runtime) return runtime;
  const config = telemetryConfig(env, { otlpEndpoint, enabled });
  if (!config.enabled) return null;
  const { NodeTracerProvider, SimpleSpanProcessor, BatchSpanProcessor } =
    await import("@opentelemetry/sdk-trace-node");
  const { resourceFromAttributes, defaultResource } = await import(
    "@opentelemetry/resources"
  );
  const local = new LocalSpanExporter(path.join(dataRoot, "telemetry"));
  await local.init();
  const processors = [new SimpleSpanProcessor(local)];
  if (config.traces.url) {
    const { OTLPTraceExporter } =
      config.traces.protocol === "http/json"
        ? await import("@opentelemetry/exporter-trace-otlp-http")
        : await import("@opentelemetry/exporter-trace-otlp-proto");
    processors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: config.traces.url,
          timeoutMillis: config.traces.timeoutMillis,
        }),
      ),
    );
  }
  const resource = defaultResource().merge(
    resourceFromAttributes({
      "service.name": config.serviceName,
      "service.version": packageInfo.version,
    }),
  );
  const provider = new NodeTracerProvider({
    spanProcessors: processors,
    resource,
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  let meterProvider, instruments;
  if (config.metrics.url) {
    const {
      MeterProvider,
      PeriodicExportingMetricReader,
      AggregationType,
      createAllowListAttributesProcessor,
    } = await import("@opentelemetry/sdk-metrics");
    const { OTLPMetricExporter } =
      config.metrics.protocol === "http/json"
        ? await import("@opentelemetry/exporter-metrics-otlp-http")
        : await import("@opentelemetry/exporter-metrics-otlp-proto");
    const httpKeys = [
      "http.request.method",
      "http.route",
      "http.response.status_code",
      "error.type",
    ];
    const jobKeys = ["flow.job.kind", "flow.provider_id", "flow.status"];
    const buckets = {
      "http.server.request.duration": [
        0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5,
        10,
      ],
      "flow.job.duration": [
        0.01, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800,
      ],
      "flow.job.queue.duration": [
        0.01, 0.1, 0.5, 1, 5, 10, 30, 60, 120, 300, 600, 1800,
      ],
    };
    const views = Object.entries(buckets).map(
      ([instrumentName, boundaries]) => ({
        instrumentName,
        meterName: "flow",
        aggregationCardinalityLimit: 2000,
        attributesProcessors: [
          createAllowListAttributesProcessor(
            instrumentName.startsWith("http.") ? httpKeys : jobKeys,
          ),
        ],
        aggregation: {
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
          options: { boundaries },
        },
      }),
    );
    meterProvider = new MeterProvider({
      resource,
      views,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: config.metrics.url,
            timeoutMillis: config.metrics.timeoutMillis,
          }),
          exportIntervalMillis: config.metrics.exportIntervalMillis,
          exportTimeoutMillis: config.metrics.timeoutMillis,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);
    const meter = meterProvider.getMeter("flow", packageInfo.version);
    instruments = {
      http: meter.createHistogram("http.server.request.duration", {
        unit: "s",
      }),
      job: meter.createHistogram("flow.job.duration", { unit: "s" }),
      queue: meter.createHistogram("flow.job.queue.duration", { unit: "s" }),
      attempts: meter.createCounter("flow.job.attempts", { unit: "{attempt}" }),
    };
  }
  runtime = {
    provider,
    local,
    meterProvider,
    instruments,
    config,
    tracer: provider.getTracer("flow", packageInfo.version),
  };
  return runtime;
}
export function startSpan(name, attributes = {}, parent, options = {}) {
  const parentContext =
    parent === null
      ? ROOT_CONTEXT
      : parent
        ? trace.setSpan(ROOT_CONTEXT, parent)
        : context.active();
  return (runtime?.tracer || trace.getTracer("flow")).startSpan(
    name,
    { ...options, attributes: safeAttributes(attributes) },
    parentContext,
  );
}
export function inSpan(span, fn) {
  return context.with(trace.setSpan(context.active(), span), fn);
}
export function traced(name, attributes, fn) {
  const span = startSpan(name, attributes);
  const fail = () => span.setStatus({ code: SpanStatusCode.ERROR });
  try {
    const result = inSpan(span, () => fn(span));
    if (result?.then)
      return result.then(
        (value) => {
          span.end();
          return value;
        },
        (error) => {
          fail();
          span.end();
          throw error;
        },
      );
    span.end();
    return result;
  } catch (error) {
    fail();
    span.end();
    throw error;
  }
}
export function mark(span, name, attributes = {}) {
  span?.addEvent(name, safeAttributes(attributes));
}
export function traceIdentity(span) {
  const id = span?.spanContext();
  return id && trace.isSpanContextValid(id)
    ? { traceId: id.traceId, spanId: id.spanId, traceFlags: id.traceFlags }
    : {};
}
export function parentFromIdentity(identity) {
  if (!identity || !trace.isSpanContextValid(identity)) return null;
  return trace.wrapSpanContext({
    ...identity,
    traceFlags: identity.traceFlags ?? 1,
    isRemote: true,
  });
}
export function observeJob({ kind, providerId, status, durationMs, queueMs }) {
  const attributes = safeAttributes({
    "flow.job.kind": kind,
    "flow.provider_id": providerId,
    "flow.status": status,
  });
  runtime?.instruments?.job.record(durationMs / 1000, attributes);
  runtime?.instruments?.queue.record(queueMs / 1000, attributes);
  runtime?.instruments?.attempts.add(1, attributes);
}
export function browserObservation(identity, values) {
  if (!identity.traceId || !identity.spanId) return;
  const parent = parentFromIdentity(identity);
  if (!parent) return;
  const span = startSpan("agent.browser.observed", values, parent);
  mark(span, "first_preview_painted", values);
  span.end();
}
export async function readTrace(traceId) {
  return runtime ? runtime.local.read(traceId) : [];
}
export async function flushTelemetry() {
  await Promise.all([
    runtime?.provider.forceFlush(),
    runtime?.meterProvider?.forceFlush(),
  ]);
}
export async function closeTracing() {
  if (!runtime) return;
  await Promise.allSettled([
    runtime.provider.shutdown(),
    runtime.meterProvider?.shutdown(),
  ]);
  trace.disable();
  context.disable();
  propagation.disable();
  if (runtime.meterProvider) metrics.disable();
  runtime = undefined;
}
export function tracingStatus() {
  return {
    enabled: Boolean(runtime),
    exporter: runtime ? "local-jsonl" : null,
    directory: runtime?.local.directory,
    serviceName: runtime?.config.serviceName,
    otlp: {
      traces: Boolean(runtime?.config.traces.url),
      metrics: Boolean(runtime?.config.metrics.url),
    },
  };
}
export function traceHttp(req, res, next) {
  if (
    !req.path.startsWith("/api") ||
    req.path === "/api/events" ||
    req.path.includes("/trace") ||
    req.path.endsWith("/timing")
  )
    return next();
  const parent = propagation.extract(ROOT_CONTEXT, req.headers);
  const span = context.with(parent, () =>
    startSpan("http.server", { "http.request.method": req.method }, undefined, {
      kind: SpanKind.SERVER,
    }),
  );
  const identity = traceIdentity(span);
  if (identity.traceId) res.setHeader("X-Flow-Trace-Id", identity.traceId);
  const started = performance.now();
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    const attributes = safeAttributes({
      "http.request.method": req.method,
      "http.route":
        typeof req.route?.path === "string" ? req.route.path : "/api/unknown",
      "http.response.status_code": res.statusCode,
      ...(!res.writableFinished && { "error.type": "connection_closed" }),
    });
    span.setAttributes(attributes);
    span.updateName(`${req.method} ${attributes["http.route"]}`);
    runtime?.instruments?.http.record(
      (performance.now() - started) / 1000,
      attributes,
    );
    if (res.statusCode >= 500 || !res.writableFinished)
      span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  };
  res.once("finish", finish);
  res.once("close", () => {
    if (!res.writableFinished) finish();
  });
  inSpan(span, next);
}
