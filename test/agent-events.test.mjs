import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import express from "express";
import { registerEventRoutes } from "../server/routes/events.mjs";
import { mergeAgentSession } from "../src/agent/stream-state.mjs";

test("one event stream pushes scoped chat snapshots, reconnects from durable state and omits private graph context", async (t) => {
  const id = randomUUID(),
    turnId = randomUUID();
  const session = {
    id,
    projectId: "photos",
    streamRevision: 1,
    turns: [
      {
        id: turnId,
        status: "thinking",
        context: { page: "canvas" },
        resolved: { privateGraph: "PRIVATE" },
        proposal: { secret: "PRIVATE" },
      },
    ],
  };
  const agent = {
    events: new EventEmitter(),
    get(wanted, scope) {
      if (wanted !== id || scope !== "photos")
        throw Object.assign(new Error("wrong project"), { status: 409 });
      return structuredClone(session);
    },
  };
  const queue = new EventEmitter();
  const app = express(),
    closeEvents = registerEventRoutes(app, {
      queue,
      agent,
      search: { refresh() {} },
    });
  app.use((err, req, res, next) =>
    res.status(err.status || 400).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const root = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController();
  t.after(async () => {
    controller.abort();
    closeEvents();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  assert.equal(
    (await fetch(`${root}/api/events?sessionId=${id}&projectId=other`)).status,
    409,
  );
  const response = await fetch(
    `${root}/api/events?sessionId=${id}&projectId=photos`,
    { signal: controller.signal },
  );
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  const next = async () => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line.startsWith("data: ")) return JSON.parse(line.slice(6));
      }
      const value = await reader.read();
      assert.equal(value.done, false);
      buffer += decoder.decode(value.value, { stream: true });
    }
  };
  assert.equal((await next()).type, "connected");
  const snapshot = await next();
  assert.equal(snapshot.session.streamRevision, 1);
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
  agent.events.emit("change", { ...session, id: randomUUID() });
  session.turns[0].preview = {
    text: "Hello world",
    updatedAt: new Date().toISOString(),
  };
  session.streamRevision++;
  agent.events.emit("change", session);
  const update = await next();
  assert.equal(update.session.turns[0].preview.text, "Hello world");
  assert.equal(update.session.turns[0].answer, undefined);
  queue.emit("event", { type: "progress", runId: "run", message: "Working" });
  assert.equal(
    (await next()).type,
    "progress",
    "runs and chat share a single connection",
  );
  controller.abort();
  const reconnect = await fetch(
    `${root}/api/events?sessionId=${id}&projectId=photos`,
  );
  const chunk = await reconnect.body.getReader().read();
  assert.match(
    new TextDecoder().decode(chunk.value),
    /Hello world/,
    "reconnect starts from the latest durable reply",
  );
  await reconnect.body.cancel().catch(() => {});
});

test("a late HTTP acknowledgement cannot replace a newer pushed turn and unchanged turns keep their identity", () => {
  const first = {
    id: "s",
    streamRevision: 2,
    turns: [
      { id: "a", status: "ready", answer: { message: "Old" } },
      { id: "b", status: "thinking", preview: { text: "New" } },
    ],
  };
  assert.equal(
    mergeAgentSession(first, { ...first, streamRevision: 1 }),
    first,
  );
  const next = mergeAgentSession(first, {
    ...structuredClone(first),
    streamRevision: 3,
    turns: [
      structuredClone(first.turns[0]),
      { ...first.turns[1], preview: { text: "New words" } },
    ],
  });
  assert.equal(next.turns[0], first.turns[0]);
  assert.equal(next.turns[1].preview.text, "New words");
});
