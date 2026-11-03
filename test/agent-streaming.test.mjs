import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { agentMessagePreview } from "../server/agent/message-preview.mjs";
import {
  redactPreview,
  redactTextResult,
} from "../harness-integrations/shared/preview.mjs";
import { AgentConversations } from "../server/agent/service.mjs";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { registerAgentRoutes } from "../server/routes/agent.mjs";
import { FlowClient, createImageWorkflow } from "../client/index.mjs";
import { restoreAgentSession } from "../src/agent/view-state.mjs";
import { initializeTracing, closeTracing } from "../observability/tracing.mjs";

const waitFor = async (read, check) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read();
    if (check(value)) return value;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Stream fixture timed out");
};

test("every JSON prefix exposes only decoded root message, with arbitrary order, fences and split escapes", () => {
  const message = 'A cyclist 🚲 says "hello".\nשינוי scenery \\ keep style.';
  for (const raw of [
    JSON.stringify({ message, edits: [{ data: { message: "PRIVATE" } }] }),
    JSON.stringify({
      edits: [{ data: { message: "PRIVATE", text: "}" } }],
      message,
    }),
    "```json\n" +
      JSON.stringify({ nested: { message: "PRIVATE" }, message }) +
      "\n```",
    JSON.stringify({ message }).replace("🚲", "\\uD83D\\uDEB2"),
  ]) {
    for (let end = 0; end <= raw.length; end++) {
      const value = agentMessagePreview(raw.slice(0, end));
      if (value !== null) {
        assert.ok(
          message.startsWith(value),
          JSON.stringify({ raw: raw.slice(0, end), value }),
        );
        assert.doesNotMatch(value, /PRIVATE|edits|nodeId/);
        assert.ok(!/[\uD800-\uDBFF]$/.test(value));
      }
    }
    assert.equal(agentMessagePreview(raw), message);
  }
  for (const raw of [
    '{"message":null}',
    '{"nested":{"message":"PRIVATE"}}',
    '{"message":"bad\\q',
    '{"message":"bad\ncontrol',
    "wire events",
  ])
    assert.equal(agentMessagePreview(raw), null);
});

test("stream redaction withholds split secrets, including JSON-escaped values and keys in the final answer", () => {
  const secret = "private-test-key";
  assert.equal(redactPreview("Use private-te", secret), "Use ");
  assert.equal(
    redactPreview("Use private-test-key today", secret),
    "Use [redacted] today",
  );
  assert.equal(
    redactPreview("Use private-terrain", secret),
    "Use private-terrain",
  );
  const escaped = [...secret]
    .map((char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
  const raw = `{"message":"Use ${escaped}","edits":[{"data":{"text":"${escaped}"}}],"${escaped}":true}`;
  const result = JSON.parse(redactTextResult(raw, secret));
  assert.equal(result.message, "Use [redacted]");
  assert.equal(result.edits[0].data.text, "[redacted]");
  assert.ok(Object.hasOwn(result, "[redacted]"));
  for (let end = 0; end <= raw.length; end++) {
    const projected = agentMessagePreview(raw.slice(0, end));
    if (projected !== null)
      assert.doesNotMatch(redactPreview(projected, secret), /private/);
  }
});

test("public agent snapshots grow before HTTP provider completion; private edits stay gated and escaped keys are scrubbed", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-agent-stream-"));
  await initializeTracing({ dataRoot: root });
  t.after(closeTracing);
  t.after(() => rm(root, { recursive: true, force: true }));
  const secret = "private-test-key",
    releases = [];
  let requests = 0;
  const answer = {
    message: `Cycling direction with ${secret} preserved.`,
    edits: [
      {
        op: "update-node",
        nodeId: "prompt",
        data: { text: "Monochrome cycling" },
      },
    ],
    focusNodeIds: ["prompt"],
  };
  const escaped = [...secret]
    .map((char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
  const raw = JSON.stringify(answer).replaceAll(secret, escaped);
  const split = raw.indexOf(escaped) + 6 * 8;
  const providerServer = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).stream, true);
    requests++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (text) =>
      res.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`,
      );
    send(raw.slice(0, split));
    await new Promise((done) => releases.push(done));
    send(raw.slice(split));
    res.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise((done) => providerServer.listen(0, "127.0.0.1", done));
  t.after(() => {
    releases.forEach((done) => done());
    providerServer.closeAllConnections();
    providerServer.close();
  });
  const store = new Store(path.join(root, ".flow"));
  await store.init();
  const projects = new ProjectService(store);
  await mkdir(path.join(root, "qa"));
  await projects.create({
    id: "qa",
    name: "Stream fixture",
    root: path.join(root, "qa"),
  });
  await store.saveWorkflow(
    createImageWorkflow({
      id: "flow",
      projectId: "qa",
      prompt: "Monochrome running",
    }),
  );
  const registry = new ProviderRegistry({
    root: path.resolve(import.meta.dirname, ".."),
    dataRoot: path.join(root, ".flow"),
    definitions: [],
    codexHealth: async () => ({ ready: false }),
  });
  await registry.reload();
  const catalog = await registry.saveConnection(null, {
    name: "Stream fixture",
    baseUrl: `http://127.0.0.1:${providerServer.address().port}/v1`,
    models: [{ id: "fixture", capabilities: ["text"] }],
    apiKey: { action: "replace", value: secret },
  });
  const providerId = catalog.find((provider) => provider.managed).id;
  const agent = new AgentConversations({
    store,
    projects,
    providers: registry,
    dataRoot: path.join(root, ".flow"),
    assetPath: () => {
      throw new Error("No images expected");
    },
  });
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app, { agent });
  app.use((error, _req, res, _next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const client = new FlowClient({
    url: `http://127.0.0.1:${server.address().port}`,
    projectId: "qa",
  });
  const session = await client.agentSession({ projectId: "qa" });
  const accepted = await client.askAgent(session.id, {
    id: randomUUID(),
    providerId,
    model: "fixture",
    message: "Use cycling",
    context: { page: "canvas", workflowId: "flow", revision: 0 },
  });
  const partial = await waitFor(
    () => client.agentConversation(session.id),
    (value) => Boolean(value.turns[0].preview?.text),
  );
  assert.equal(partial.turns[0].status, "thinking");
  assert.equal(partial.turns[0].preview.text, "Cycling direction with ");
  assert.equal(partial.turns[0].answer, undefined);
  assert.equal(partial.turns[0].proposal, undefined);
  assert.ok(!JSON.stringify(partial).includes(secret));
  const newer = await client.agentSession({ fresh: true });
  assert.notEqual(newer.id, session.id);
  const refreshedClient = new FlowClient({ url: client.url, projectId: "qa" });
  const recovered = await restoreAgentSession(refreshedClient, {
    sessionId: session.id,
  });
  assert.equal(recovered.id, session.id);
  assert.equal(recovered.turns[0].status, "thinking");
  assert.equal(recovered.turns[0].preview.text, partial.turns[0].preview.text);
  assert.match(recovered.turns[0].timing.traceId, /^[a-f0-9]{32}$/);
  assert.ok(
    recovered.turns[0].timing.milestones.previewPersisted >=
      recovered.turns[0].timing.milestones.providerStarted,
  );
  await assert.rejects(
    client.reportAgentTiming(session.id, accepted.turn.id, {
      elapsedMs: 10,
      prepareMs: 1,
      acceptedMs: 2,
      prompt: "not allowed",
    }),
    /unrecognized/i,
  );
  await client.reportAgentTiming(session.id, accepted.turn.id, {
    elapsedMs: 100,
    prepareMs: 1,
    acceptedMs: 2,
  });
  const observed = await client.agentTrace(session.id, accepted.turn.id);
  assert.equal(observed.timing.browser.elapsedMs, 100);
  assert.ok(observed.spans.some((s) => s.name === "agent.browser.observed"));
  assert.ok(!JSON.stringify(observed.spans).includes(secret));
  await assert.rejects(
    new FlowClient({ url: client.url, projectId: "foreign" }).agentTrace(
      session.id,
      accepted.turn.id,
    ),
    /another project/,
  );
  assert.equal(
    recovered.turns[0].activity.find((call) => call.name === "harness_request")
      .status,
    "running",
  );
  assert.deepEqual(recovered.turns[0].activity, partial.turns[0].activity);
  assert.equal(
    requests,
    1,
    "refresh reconnects without resubmitting inference",
  );
  await assert.rejects(
    client.applyAgentTurn(session.id, accepted.turn.id),
    /no ready proposal/i,
  );
  assert.equal(
    store.workflows.get("flow").nodes[0].data.text,
    "Monochrome running",
  );
  releases[0]();
  const finished = await waitFor(
    () => client.agentConversation(session.id),
    (value) => value.turns[0].status !== "thinking",
  );
  assert.equal(finished.turns[0].status, "ready");
  assert.equal(
    finished.turns[0].activity.find((call) => call.name === "harness_request")
      .status,
    "completed",
  );
  assert.equal(
    finished.turns[0].answer.message,
    "Cycling direction with [redacted] preserved.",
  );
  assert.ok(!JSON.stringify(finished).includes(secret));
  assert.ok(finished.turns[0].proposal);
  assert.equal(requests, 1);
  assert.equal(
    store.workflows.get("flow").nodes[0].data.text,
    "Monochrome running",
  );
  const next = await client.askAgent(session.id, {
    id: randomUUID(),
    providerId,
    model: "fixture",
    message: "Another direction",
    context: { page: "canvas", workflowId: "flow", revision: 0 },
  });
  const beforeCancel = await waitFor(
    () => client.agentConversation(session.id),
    (value) => Boolean(value.turns[1]?.preview?.text),
  );
  await client.cancelAgentTurn(session.id, next.turn.id);
  releases[1]();
  await Promise.allSettled([...agent.jobs]);
  const cancelled = (await client.agentConversation(session.id)).turns[1];
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.preview.text, beforeCancel.turns[1].preview.text);
  assert.equal(cancelled.answer, undefined);
  assert.equal(cancelled.proposal, undefined);
});
