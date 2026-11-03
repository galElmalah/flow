import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  initializeTracing,
  closeTracing,
  traced,
  readTrace,
  safeAttributes,
  mark,
} from "../observability/tracing.mjs";

test("real OpenTelemetry exports related spans locally; content and error messages never enter the trace", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-otel-test-"));
  t.after(async () => {
    await closeTracing();
    await rm(root, { recursive: true, force: true });
  });
  await initializeTracing({ dataRoot: root });
  let id, parentId, childId;
  await traced(
    "agent.turn",
    { "flow.turn_id": "test-turn", prompt: "PRIVATE PROMPT" },
    async (span) => {
      id = span.spanContext().traceId;
      parentId = span.spanContext().spanId;
      await traced("provider.preflight", {}, async (child) => {
        childId = child.spanContext().spanId;
        await new Promise((done) => setTimeout(done, 5));
      });
      mark(span, "first_output", {
        reply: "PRIVATE REPLY",
        "flow.preview_chars": 12,
      });
      await assert.rejects(
        traced("failed.request", {}, async () => {
          throw new Error("PRIVATE CREDENTIAL");
        }),
        /PRIVATE CREDENTIAL/,
      );
    },
  );
  const spans = await readTrace(id);
  const parent = spans.find((s) => s.spanId === parentId),
    child = spans.find((s) => s.spanId === childId);
  assert.ok(parent && child);
  assert.equal(child.parentSpanId, parentId);
  assert.equal(child.traceId, id);
  assert.ok(child.durationMs >= 4);
  assert.equal(spans.find((s) => s.name === "failed.request").status.code, 2);
  const raw = await readFile(
    path.join(root, "telemetry", "spans.jsonl"),
    "utf8",
  );
  assert.doesNotMatch(raw, /PRIVATE/);
  assert.deepEqual(
    safeAttributes({
      prompt: "x",
      api_key: "x",
      "ui.elapsed_ms": NaN,
      "flow.preview_chars": 12,
    }),
    { "flow.preview_chars": 12 },
  );
});

test("optional OTLP export reaches a local collector with real SDK spans", async (t) => {
  const { createServer } = await import("node:http");
  const root = await mkdtemp(path.join(tmpdir(), "flow-otel-collector-"));
  const received = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await closeTracing();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  });
  await initializeTracing({
    dataRoot: root,
    otlpEndpoint: `http://127.0.0.1:${server.address().port}/v1/traces`,
  });
  let traceId;
  traced("collector.smoke", {}, (span) => {
    traceId = span.spanContext().traceId;
  });
  await readTrace(traceId);
  assert.ok(received.length > 0);
  assert.ok(
    received
      .flatMap((batch) => batch.resourceSpans || [])
      .some((resource) =>
        resource.resource?.attributes?.some(
          (attr) =>
            attr.key === "service.name" && attr.value?.stringValue === "flow",
        ),
      ),
  );
  assert.ok(
    received
      .flatMap((batch) => batch.resourceSpans || [])
      .flatMap((resource) => resource.scopeSpans || [])
      .flatMap((scope) => scope.spans || [])
      .some((span) => span.name === "collector.smoke"),
  );
});
