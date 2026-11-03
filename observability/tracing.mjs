import { AsyncLocalStorage } from "node:async_hooks";
import {
  mkdir,
  appendFile,
  readFile,
  stat,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { ROOT_CONTEXT, trace, SpanStatusCode } from "@opentelemetry/api";

const allowed = new Set([
  "gen_ai.request.model",
  "gen_ai.request.reasoning_effort",
  "flow.session_id",
  "flow.turn_id",
  "flow.workflow_id",
  "flow.project_id",
  "flow.provider_id",
  "flow.job_id",
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
export function spanRecord(span) {
  return {
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
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
export class LocalSpanExporter {
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
const scope = new AsyncLocalStorage();
let runtime;
export async function initializeTracing({
  dataRoot,
  otlpEndpoint = process.env.FLOW_OTEL_OTLP_ENDPOINT,
  enabled = process.env.FLOW_OTEL_ENABLED !== "0",
} = {}) {
  if (runtime) return runtime;
  if (!enabled) return null;
  const { NodeTracerProvider, SimpleSpanProcessor } =
    await import("@opentelemetry/sdk-trace-node");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const local = new LocalSpanExporter(path.join(dataRoot, "telemetry"));
  await local.init();
  const processors = [new SimpleSpanProcessor(local)];
  if (otlpEndpoint) {
    const { OTLPTraceExporter } =
      await import("@opentelemetry/exporter-trace-otlp-http");
    const url = new URL(otlpEndpoint);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(
        "OTLP export must use a local collector URL without credentials.",
      );
    processors.push(
      new SimpleSpanProcessor(
        new OTLPTraceExporter({ url: url.href, timeoutMillis: 2000 }),
      ),
    );
  }
  const provider = new NodeTracerProvider({
    spanProcessors: processors,
    resource: resourceFromAttributes({
      "service.name": "flow",
      "service.version": "0.1.0",
    }),
  });
  runtime = { provider, local, tracer: provider.getTracer("flow", "0.1.0") };
  return runtime;
}
export function startSpan(name, attributes = {}, parent) {
  const parentContext = parent
    ? trace.setSpan(ROOT_CONTEXT, parent)
    : scope.getStore() || ROOT_CONTEXT;
  return (runtime?.tracer || trace.getTracer("flow")).startSpan(
    name,
    { attributes: safeAttributes(attributes) },
    parentContext,
  );
}
export function inSpan(span, fn) {
  return scope.run(trace.setSpan(scope.getStore() || ROOT_CONTEXT, span), fn);
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
    ? { traceId: id.traceId, spanId: id.spanId }
    : {};
}
export function browserObservation(identity, values) {
  if (!identity.traceId || !identity.spanId) return;
  const parent = trace.wrapSpanContext({
    traceId: identity.traceId,
    spanId: identity.spanId,
    traceFlags: 1,
    isRemote: true,
  });
  const span = startSpan("agent.browser.observed", values, parent);
  mark(span, "first_preview_painted", values);
  span.end();
}
export async function readTrace(traceId) {
  await runtime?.provider.forceFlush();
  return runtime ? runtime.local.read(traceId) : [];
}
export async function closeTracing() {
  await runtime?.provider.shutdown();
  runtime = undefined;
}
export function tracingStatus() {
  return {
    enabled: Boolean(runtime),
    exporter: runtime ? "local-jsonl" : null,
    directory: runtime?.local.directory,
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
  const span = startSpan("http.server", { "http.request.method": req.method });
  const finish = () => {
    span.setAttribute("http.route", req.route?.path || "/api/unknown");
    span.setAttribute("http.response.status_code", res.statusCode);
    if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  };
  res.once("finish", finish);
  res.once("close", () => {
    if (!res.writableFinished) finish();
  });
  inSpan(span, next);
}
