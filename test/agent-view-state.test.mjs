import test from "node:test";
import assert from "node:assert/strict";
import {
  readAgentView,
  rememberAgentView,
  restoreAgentSession,
  agentElapsed,
  restoredAgentDraft,
} from "../src/agent/view-state.mjs";

test("refresh keeps each project's conversation, open chat, harness, draft and original apply intent isolated", () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  };
  rememberAgentView(storage, "sport", {
    sessionId: "session-a",
    autoApplyId: "turn-a",
    open: true,
    provider: "claude-code",
    model: "default",
    draft: "Use cycling",
  });
  rememberAgentView(storage, "quoture", {
    sessionId: "session-b",
    open: false,
  });
  rememberAgentView(storage, "sport", { draft: "Use swimming" });
  assert.deepEqual(readAgentView(storage, "sport"), {
    sessionId: "session-a",
    autoApplyId: "turn-a",
    open: true,
    provider: "claude-code",
    model: "default",
    draft: "Use swimming",
  });
  assert.equal(readAgentView(storage, "quoture").sessionId, "session-b");
  rememberAgentView(storage, "sport", { autoApplyId: null });
  assert.equal(readAgentView(storage, "sport").autoApplyId, undefined);
  assert.deepEqual(
    readAgentView({ getItem: () => "invalid json" }, "sport"),
    {},
  );
  const blocked = {
    getItem() {
      throw new Error("disabled");
    },
    setItem() {
      throw new Error("disabled");
    },
  };
  assert.doesNotThrow(() =>
    rememberAgentView(blocked, "sport", { open: true }),
  );
});
test("empty conversations restore safely; only a submitted matching draft is cleared", () => {
  assert.equal(restoredAgentDraft({}, undefined), "");
  assert.equal(
    restoredAgentDraft({ draft: "Unsent question" }, undefined),
    "Unsent question",
  );
  assert.equal(
    restoredAgentDraft(
      { draft: "Use cycling", autoApplyId: "a" },
      { id: "a", message: "Use cycling" },
    ),
    "",
  );
  assert.equal(
    restoredAgentDraft(
      { draft: "Use swimming", autoApplyId: "a" },
      { id: "a", message: "Use cycling" },
    ),
    "Use swimming",
  );
  assert.equal(
    restoredAgentDraft(
      { draft: "Use cycling", autoApplyId: "a" },
      { id: "b", message: "Use cycling" },
    ),
    "Use cycling",
  );
});
test("reconnection retrieves the exact saved conversation; network errors never create a replacement", async () => {
  const calls = [];
  const client = {
    async agentConversation(id) {
      calls.push(id);
      return { id, turns: [{ status: "thinking" }] };
    },
    async agentSession() {
      calls.push("open");
      return { id: "new" };
    },
  };
  assert.equal(
    (await restoreAgentSession(client, { sessionId: "original" })).id,
    "original",
  );
  assert.deepEqual(calls, ["original"]);
  client.agentConversation = async () => {
    throw Object.assign(new Error("Offline"), { status: 503 });
  };
  await assert.rejects(
    restoreAgentSession(client, { sessionId: "original" }),
    /Offline/,
  );
  assert.deepEqual(calls, ["original"]);
  client.agentConversation = async () => {
    throw Object.assign(new Error("Not found"), { status: 404 });
  };
  assert.equal(
    (await restoreAgentSession(client, { sessionId: "deleted" })).id,
    "new",
  );
});
test("agent elapsed time comes from persisted timestamps and never claims model completion percent", () => {
  const start = "2026-10-30T10:00:00Z";
  assert.equal(
    agentElapsed({ startedAt: start }, Date.parse(start) + 65000),
    "1m 5s",
  );
  assert.equal(
    agentElapsed({ createdAt: start }, Date.parse(start) + 5000),
    "5s",
  );
  assert.equal(
    agentElapsed({ startedAt: start }, Date.parse(start) - 1000),
    "0s",
  );
  assert.equal(agentElapsed({}), "");
});
