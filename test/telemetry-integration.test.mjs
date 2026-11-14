import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import sharp from "sharp";
import { context, propagation, metrics, trace } from "@opentelemetry/api";
import { FlowClient } from "../client/index.mjs";
import { Store } from "../server/store.mjs";
import { Queue } from "../server/queue.mjs";
import { ProjectService } from "../server/projects.mjs";
import { registerRunRoutes } from "../server/routes/runs.mjs";
import { starter } from "./fixtures/paper-workflow.mjs";
import { telemetryConfig } from "../observability/config.mjs";
import {
  initializeTracing,
  closeTracing,
  flushTelemetry,
  traceHttp,
  traced,
  readTrace,
  tracingStatus,
} from "../observability/tracing.mjs";

const listen = (server) =>
  new Promise((done) => server.listen(0, "127.0.0.1", done));
const close = async (server) => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
};
async function waitFor(check) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Local telemetry fixture timed out");
}
const exportedSpans = (requests) =>
  requests
    .flatMap((r) => r.body.resourceSpans || [])
    .flatMap((r) => r.scopeSpans || [])
    .flatMap((s) => s.spans || []);

test("standard OTLP options resolve signal paths, formats and local-only defaults", () => {
  const local = telemetryConfig({});
  assert.equal(local.traces.url, null);
  assert.equal(local.metrics.url, null);
  const config = telemetryConfig({
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318/otel/",
    OTEL_SERVICE_NAME: "my-flow",
  });
  assert.equal(config.traces.url, "http://127.0.0.1:4318/otel/v1/traces");
  assert.equal(config.metrics.url, "http://127.0.0.1:4318/otel/v1/metrics");
  assert.equal(config.traces.protocol, "http/protobuf");
  assert.equal(config.serviceName, "my-flow");
  const override = telemetryConfig({
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:9999/custom",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
  });
  assert.equal(override.traces.url, "http://localhost:9999/custom");
  assert.equal(override.metrics.url, null);
  assert.equal(override.traces.protocol, "http/json");
  assert.equal(
    telemetryConfig({
      FLOW_OTEL_OTLP_ENDPOINT: "http://localhost:4318/v1/traces",
    }).traces.protocol,
    "http/json",
  );
  for (const url of [
    "https://example.com/v1/traces",
    "http://u:p@localhost:4318",
    "http://localhost:4318?key=secret",
    "file:///tmp/traces",
  ])
    assert.throws(
      () => telemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: url }),
      /loopback/,
    );
  assert.throws(
    () =>
      telemetryConfig({
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
      }),
    /http\/protobuf/,
  );
  assert.throws(
    () => telemetryConfig({ OTEL_METRIC_EXPORT_INTERVAL: "bad" }),
    /positive integer/,
  );
  assert.equal(
    telemetryConfig({
      OTEL_SDK_DISABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "invalid",
    }).enabled,
    false,
  );
});

test("SDK, concurrent HTTP runs, persisted jobs and metrics share real collector traces without content", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-otel-integration-"));
  const requests = [];
  const collector = http.createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    requests.push({ path: req.url, body: JSON.parse(Buffer.concat(parts)) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  await listen(collector);
  const store = new Store(root);
  await store.init();
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#123" },
  })
    .png()
    .toBuffer();
  const seed = path.join(root, "uploads", "seed.png");
  await writeFile(seed, png);
  const queue = new Queue(store, {
    resolveAsset: () => seed,
    adapter: async ({ job, directory }) => {
      await new Promise((done) => setTimeout(done, 5));
      if (job.seed % 2) throw new Error("PRIVATE_PROVIDER_ERROR");
      await writeFile(path.join(directory, "output.png"), png);
    },
  });
  let restored;
  const app = express();
  app.use(traceHttp);
  app.use(express.json());
  app.post("/api/runs/:label", async (_req, res) => {
    const graph = structuredClone(starter);
    graph.nodes.find((n) => n.type === "variations").data.lines =
      "PRIVATE_PROMPT_ONE\nPRIVATE_PROMPT_TWO";
    graph.nodes.find((n) => n.type === "generate").data.count = 1;
    res.json(await queue.create(graph));
  });
  app.get("/api/fail/:id", (_req, res) =>
    res.status(500).json({ error: "PRIVATE_HTTP_ERROR" }),
  );
  registerRunRoutes(app, { store, projects: new ProjectService(store), queue });
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = http.createServer(app);
  await listen(server);
  t.after(async () => {
    await waitFor(() => queue.active.size === 0);
    await closeTracing();
    await Promise.all([close(server), close(collector)]);
    await store.close();
    await restored?.close();
    await rm(root, { recursive: true, force: true });
  });
  await initializeTracing({
    dataRoot: root,
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.address().port}`,
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_SERVICE_NAME: "flow-test",
    },
  });
  assert.deepEqual(tracingStatus().otlp, { traces: true, metrics: true });
  const client = new FlowClient({
    url: `http://127.0.0.1:${server.address().port}`,
  });
  const runs = await Promise.all(
    [1, 2].map(() =>
      trace.getTracer("test-agent").startActiveSpan("caller", async (span) => {
        try {
          const response = await client.response("/api/runs/PRIVATE_PATH", {
            method: "POST",
            headers: { baggage: "secret=PRIVATE_BAGGAGE" },
            body: "{}",
          });
          assert.equal(
            response.headers.get("X-Flow-Trace-Id"),
            span.spanContext().traceId,
          );
          return { run: await response.json(), parent: span.spanContext() };
        } finally {
          span.end();
        }
      }),
    ),
  );
  await waitFor(
    () =>
      queue.active.size === 0 &&
      runs.every(({ run }) => store.runs.get(run.id).status === "failed"),
  );
  for (const { run, parent } of runs) {
    const spans = await readTrace(parent.traceId);
    const request = spans.find((s) => s.name === "POST /api/runs/:label");
    assert.equal(request.parentSpanId, parent.spanId);
    assert.equal(request.kind, 1);
    const submit = spans.find((s) => s.name === "workflow.submit");
    assert.equal(submit.parentSpanId, request.spanId);
    const jobs = spans.filter((s) => s.name === "workflow.job");
    assert.equal(jobs.length, 2);
    assert.ok(
      jobs.every(
        (s) =>
          s.parentSpanId === submit.spanId &&
          s.attributes["flow.run_id"] === run.id,
      ),
    );
    assert.ok(
      spans.some((s) => s.name === "provider.execute" && s.status.code === 2),
    );
  }
  assert.notEqual(runs[0].parent.traceId, runs[1].parent.traceId);
  const receipt = await client.runTrace(runs[0].run.id);
  assert.equal(receipt.traceId, runs[0].parent.traceId);
  assert.ok(receipt.spans.some((s) => s.name === "workflow.job"));
  assert.ok(
    receipt.spans.every(
      (s) => !s.name.startsWith("POST ") && s.name !== "caller",
    ),
  );
  await assert.rejects(
    client.runTrace("missing"),
    (error) => error.status === 404,
  );
  await new ProjectService(store).create({ id: "other", name: "Other", root });
  await assert.rejects(
    new FlowClient({ url: client.url, projectId: "other" }).runTrace(
      runs[0].run.id,
    ),
    (error) => error.status === 409,
  );
  const cli = await promisify(execFile)(
    process.execPath,
    [
      path.resolve(import.meta.dirname, "../cli/flow.mjs"),
      "trace",
      runs[0].run.id,
      "--url",
      client.url,
      "--json",
    ],
    { cwd: root },
  );
  assert.deepEqual(JSON.parse(cli.stdout), receipt);
  await store.flush();
  restored = new Store(root);
  await restored.init();
  const resumed = new Queue(restored, {
    resolveAsset: () => seed,
    adapter: async ({ directory }) =>
      writeFile(path.join(directory, "output.png"), png),
  });
  resumed.action(runs[0].run.id, "retry");
  await waitFor(
    () =>
      resumed.active.size === 0 &&
      restored.runs.get(runs[0].run.id).status === "completed",
  );
  assert.equal(
    (await readTrace(runs[0].parent.traceId)).filter(
      (s) => s.name === "workflow.job",
    ).length,
    3,
  );
  await assert.rejects(
    client.request("/api/fail/PRIVATE_PATH"),
    (error) => error.status === 500 && /^[a-f0-9]{32}$/.test(error.traceId),
  );
  const unsampledId = "1234567890abcdef1234567890abcdef";
  const unsampled = await client.request("/api/runs/PRIVATE_PATH", {
    method: "POST",
    headers: { traceparent: `00-${unsampledId}-1234567890abcdef-00` },
    body: "{}",
  });
  await waitFor(
    () =>
      queue.active.size === 0 &&
      store.runs.get(unsampled.id).status === "failed",
  );
  assert.equal(unsampled.telemetry.traceFlags, 0);
  assert.equal(store.runs.get(unsampled.id).jobs[0].telemetry.traceFlags, 0);
  assert.deepEqual(await readTrace(unsampledId), []);
  await flushTelemetry();
  const spans = exportedSpans(requests);
  const resource = requests.flatMap((r) => r.body.resourceSpans || [])[0]
    .resource.attributes;
  assert.ok(
    resource.some(
      (a) => a.key === "service.name" && a.value.stringValue === "flow-test",
    ),
  );
  assert.ok(
    resource.some(
      (a) =>
        a.key === "telemetry.sdk.language" && a.value.stringValue === "nodejs",
    ),
  );
  assert.ok(resource.some((a) => a.key === "service.version"));
  assert.ok(spans.some((s) => s.name === "workflow.job"));
  const metricNames = requests
    .flatMap((r) => r.body.resourceMetrics || [])
    .flatMap((r) => r.scopeMetrics || [])
    .flatMap((s) => s.metrics || [])
    .map((m) => m.name);
  for (const name of [
    "http.server.request.duration",
    "flow.job.duration",
    "flow.job.queue.duration",
    "flow.job.attempts",
  ])
    assert.ok(metricNames.includes(name), name);
  assert.ok(requests.some((r) => r.path === "/v1/traces"));
  assert.ok(requests.some((r) => r.path === "/v1/metrics"));
  assert.doesNotMatch(JSON.stringify(requests), /PRIVATE/);
  const metricBodies = JSON.stringify(
    requests.filter((r) => r.path === "/v1/metrics"),
  );
  assert.doesNotMatch(
    metricBodies,
    /flow\.(job_id|run_id|session_id|workflow_id)/,
  );
  const headers = {};
  propagation.inject(context.active(), headers);
  assert.equal(headers.baggage, undefined);
});

test("draining shutdown finishes active job spans before the SDK closes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-otel-drain-"));
  const store = new Store(root);
  await store.init();
  await initializeTracing({ dataRoot: root, env: {} });
  t.after(async () => {
    await closeTracing();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const begun = Promise.withResolvers();
  const queue = new Queue(store, {
    resolveAsset: () => "unused",
    adapter: () => {},
  });
  // A text-only job avoids image I/O and waits on the real cancellation signal.
  queue.adapter = ({ signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
      begun.resolve();
    });
  const plan = {
    graph: {},
    jobs: [
      {
        id: "drain-job",
        nodeId: "text",
        kind: "text",
        status: "queued",
        attempts: 0,
        prompt: "PRIVATE",
        images: [],
        dependencies: [],
      },
    ],
  };
  const run = await queue.create(
    { id: "drain", name: "Drain", nodes: [] },
    {},
    plan,
  );
  await begun.promise;
  await queue.stop({ drain: true });
  assert.equal(queue.active.size, 0);
  const job = (await readTrace(run.telemetry.traceId)).find(
    (s) => s.name === "workflow.job",
  );
  assert.equal(job.attributes["flow.status"], "interrupted");
});

test("protobuf collectors receive both signals and disabling telemetry performs no export", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-otel-proto-"));
  const requests = [];
  const collector = http.createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    requests.push({
      path: req.url,
      type: req.headers["content-type"],
      bytes: Buffer.concat(parts),
    });
    res.writeHead(200, { "Content-Type": "application/x-protobuf" });
    res.end();
  });
  await listen(collector);
  t.after(async () => {
    await closeTracing();
    await close(collector);
    await rm(root, { recursive: true, force: true });
  });
  await initializeTracing({
    dataRoot: root,
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.address().port}`,
    },
  });
  traced("protobuf.smoke", {}, () => {});
  metrics
    .getMeter("collector-fixture")
    .createCounter("fixture.requests")
    .add(1);
  await flushTelemetry();
  for (const signal of ["traces", "metrics"]) {
    const request = requests.find((r) => r.path === `/v1/${signal}`);
    assert.ok(request, signal);
    assert.equal(request.type, "application/x-protobuf");
    assert.ok(request.bytes.length > 0);
  }
  await closeTracing();
  const before = requests.length;
  await initializeTracing({
    dataRoot: root,
    env: { OTEL_SDK_DISABLED: "true" },
  });
  traced("disabled", {}, () => {});
  await flushTelemetry();
  assert.equal(tracingStatus().enabled, false);
  assert.equal(requests.length, before);
});
