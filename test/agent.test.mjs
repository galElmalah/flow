import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { AgentConversations } from "../server/agent/service.mjs";
import { registerAgentRoutes } from "../server/routes/agent.mjs";
import { registerWorkflowRoutes } from "../server/routes/workflows.mjs";
import { FlowClient } from "../client/index.mjs";
import { applyAgentEdits, agentAnswerSchema } from "../shared/agent.mjs";

const graph = () => ({
  id: "sports",
  projectId: "sport",
  revision: 0,
  name: "Sports motion",
  nodes: [
    {
      id: "scene",
      type: "prompt",
      position: { x: 0, y: 0 },
      data: { label: "Shared style", text: "Monochrome sprinting", rules: [] },
    },
    {
      id: "records",
      type: "dataset",
      position: { x: 0, y: 100 },
      data: {
        label: "Sports",
        records: [{ id: "a", fields: { sport: "running" } }],
      },
    },
  ],
  edges: [],
});
const input = (revision = 0, message = "Use cycling") => ({
  id: randomUUID(),
  message,
  providerId: "codex-text",
  context: {
    page: "canvas",
    workflowId: "sports",
    revision,
    selectedNodeIds: ["scene"],
  },
});
const answer = {
  message: "Changed the sporting activity while preserving the style.",
  edits: [
    {
      op: "update-node",
      nodeId: "scene",
      data: { text: "Monochrome cycling" },
    },
  ],
  focusNodeIds: ["scene"],
};

async function waitReady(client, id, turnId) {
  for (let n = 0; n < 100; n++) {
    const session = await client.agentConversation(id);
    const turn = session.turns.find((t) => t.id === turnId);
    if (!["queued", "thinking"].includes(turn.status)) return turn;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Agent fixture timed out");
}

test("durable app agent API scopes context, prepares, applies, and conditionally undoes without inference", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-agent-"));
  const store = new Store(path.join(root, ".flow"));
  await store.init();
  const projects = new ProjectService(store);
  for (const id of ["sport", "other"]) {
    await mkdir(path.join(root, id));
    await projects.create({ id, name: id, root: path.join(root, id) });
  }
  await store.saveWorkflow(graph());
  let calls = 0,
    hold = false,
    respond = answer;
  const providers = {
    async run(context) {
      calls++;
      assert.equal(context.job.purpose, "app-assistant");
      assert.equal(context.job.kind, "text");
      assert.match(context.directory, /agent\/[a-f0-9-]+\/[a-f0-9-]+$/);
      assert.notEqual(context.directory, projects.require("sport").root);
      assert.match(
        context.job.prompt,
        /Monochrome sprinting|Monochrome cycling/,
      );
      context.onProgress("Writing with fixture");
      if (hold)
        await new Promise((resolve, reject) =>
          context.signal.addEventListener(
            "abort",
            () => reject(new Error("Cancelled")),
            { once: true },
          ),
        );
      return { kind: "text", text: JSON.stringify(respond) };
    },
  };
  let agent = new AgentConversations({
    store,
    projects,
    providers,
    assetPath: () => {},
    dataRoot: store.root,
  });
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app, {
    get agent() {
      return agent;
    },
  });
  registerWorkflowRoutes(app, { store, projects, assetPath: () => {} });
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await agent.close();
    await new Promise((r) => server.close(r));
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = new FlowClient({ url, projectId: "sport" }),
    other = new FlowClient({ url, projectId: "other" });
  const session = await client.agentSession();
  assert.equal((await client.agentSession()).id, session.id);
  assert.equal(session.projectId, "sport");
  await assert.rejects(other.agentConversation(session.id), /another project/);
  const cross = input();
  await store.saveWorkflow({ ...graph(), id: "foreign", projectId: "other" });
  cross.context.workflowId = "foreign";
  await assert.rejects(client.askAgent(session.id, cross), /another project/);
  const question = input();
  const queued = await client.askAgent(session.id, question);
  assert.equal(queued.turn.id, question.id);
  const ready = await waitReady(client, session.id, question.id);
  assert.equal(ready.status, "ready");
  assert.deepEqual(
    ready.activity.map((call) => [call.name, call.status]),
    [
      ["read_page_context", "completed"],
      ["harness_request", "completed"],
      ["validate_workflow_changes", "completed"],
    ],
  );
  assert.equal(ready.activity.at(-1).output.operationCount, 1);
  assert.equal(ready.proposal.workflow.nodes[0].data.label, "Shared style");
  assert.equal(
    store.workflows.get("sports").nodes[0].data.text,
    "Monochrome sprinting",
    "proposal does not mutate workflow",
  );
  await client.askAgent(session.id, question);
  assert.equal(calls, 1, "same request never invokes twice");
  await assert.rejects(
    client.askAgent(session.id, { ...question, message: "different" }),
    /different content/,
  );
  const persistWorkflow = store.persistWorkflow;
  store.persistWorkflow = () => {
    throw new Error("Fixture transaction failure");
  };
  await assert.rejects(
    client.applyAgentTurn(session.id, question.id),
    /Fixture transaction failure/,
  );
  store.persistWorkflow = persistWorkflow;
  const failedApply = (await client.agentConversation(session.id)).turns[0];
  assert.equal(failedApply.status, "ready");
  assert.equal(
    failedApply.receipt,
    undefined,
    "failed transaction cannot record a saved-change receipt",
  );
  assert.equal(failedApply.activity.at(-1).status, "failed");
  assert.equal(store.workflows.get("sports").revision, 0);
  const applied = await client.applyAgentTurn(session.id, question.id);
  assert.equal(applied.turn.activity.at(-1).name, "apply_agent_changes");
  assert.equal(applied.turn.activity.at(-1).status, "completed");
  assert.equal(applied.turn.activity.at(-1).output.revision, 1);
  assert.equal(applied.workflow.revision, 1);
  assert.equal(applied.workflow.nodes[0].data.text, "Monochrome cycling");
  assert.equal(
    (await client.applyAgentTurn(session.id, question.id)).workflow.revision,
    1,
  );
  const undone = await client.undoAgentTurn(session.id, question.id);
  assert.equal(undone.turn.activity.at(-1).name, "undo_agent_changes");
  assert.equal(undone.turn.activity.at(-1).status, "completed");
  assert.equal(undone.workflow.revision, 2);
  assert.equal(undone.workflow.nodes[0].data.text, "Monochrome sprinting");
  assert.equal(
    (await client.undoAgentTurn(session.id, question.id)).workflow.revision,
    2,
  );
  const stale = input(2);
  await client.askAgent(session.id, stale);
  await waitReady(client, session.id, stale.id);
  await store.saveWorkflow({
    ...store.workflows.get("sports"),
    name: "Human changed this",
    revision: 3,
  });
  await assert.rejects(
    client.applyAgentTurn(session.id, stale.id),
    /workflow changed/,
  );
  assert.equal(store.workflows.get("sports").name, "Human changed this");
  assert.equal(
    (await client.agentConversation(session.id)).turns.find(
      (turn) => turn.id === stale.id,
    ).status,
    "conflict",
  );
  hold = true;
  const blocked = input(3);
  await client.askAgent(session.id, blocked);
  await assert.rejects(
    client.askAgent(session.id, input(3)),
    /current message/,
  );
  const cancelled = await client.cancelAgentTurn(session.id, blocked.id);
  assert.equal(cancelled.turn.status, "cancelled");
  assert.equal(
    cancelled.turn.activity.find((call) => call.name === "harness_request")
      .status,
    "cancelled",
  );
  assert.equal(cancelled.turn.activity.at(-1).name, "cancel_agent_turn");
  assert.equal(cancelled.turn.activity.at(-1).status, "completed");
  await agent.close();
  hold = false;
  const malformed = input(3);
  respond = {
    message: "bad",
    edits: [{ op: "rename", name: "bad", projectId: "other" }],
  };
  await client.askAgent(session.id, malformed);
  assert.equal(
    (await waitReady(client, session.id, malformed.id)).status,
    "failed",
  );
  // Constructor recovery reads durable unfinished turns without invoking any provider.
  const snapshot = agent.get(session.id);
  snapshot.turns.push({
    ...input(3),
    status: "thinking",
    createdAt: new Date().toISOString(),
    activity: [
      {
        id: randomUUID(),
        name: "harness_request",
        kind: "harness",
        status: "running",
        startedAt: new Date().toISOString(),
        input: { providerId: "codex-text" },
      },
    ],
  });
  agent.save(snapshot);
  const beforeCalls = calls;
  const recovered = new AgentConversations({
    store,
    projects,
    providers,
    assetPath: () => {},
    dataRoot: store.root,
  });
  assert.equal(recovered.get(session.id).turns.at(-1).status, "interrupted");
  assert.equal(
    recovered.get(session.id).turns.at(-1).activity[0].status,
    "interrupted",
  );
  assert.equal(
    recovered.get(session.id).turns[0].activity.at(-1).name,
    "undo_agent_changes",
  );
  assert.equal(
    recovered.get(session.id).turns[0].activity.at(-1).status,
    "completed",
  );
  assert.equal(calls, beforeCalls);
  await recovered.close();
  // Read-only snapshots retain their original graph and cannot receive proposals.
  const runId = randomUUID();
  const run = {
    id: runId,
    projectId: "sport",
    workflowId: "sports",
    name: "Recorded",
    status: "completed",
    createdAt: new Date().toISOString(),
    graph: graph(),
    jobs: [],
  };
  await store.saveRun(run);
  respond = answer;
  const readonly = input(3);
  readonly.context.runId = runId;
  await client.askAgent(session.id, readonly);
  assert.equal(
    (await waitReady(client, session.id, readonly.id)).status,
    "failed",
  );
  assert.equal(run.graph.nodes[0].data.text, "Monochrome sprinting");
  const fresh = await client.agentSession({ fresh: true });
  assert.notEqual(fresh.id, session.id);
  assert.equal(fresh.turns.length, 0);
  assert.equal((await client.agentSession()).id, fresh.id);
  assert.ok(
    (await client.agentConversation(session.id)).turns.length > 0,
    "new conversations retain earlier history",
  );
});

test("agent edit contracts preserve untouched fields and reject invalid graphs and identity changes", () => {
  const before = graph();
  const result = applyAgentEdits(before, answer.edits);
  assert.equal(result.graph.nodes[0].data.label, "Shared style");
  assert.deepEqual(result.graph.nodes[1], before.nodes[1]);
  assert.equal(before.nodes[0].data.text, "Monochrome sprinting");
  assert.throws(() =>
    agentAnswerSchema.parse({
      message: "bad",
      edits: [
        { op: "update-node", nodeId: "scene", data: { projectId: "other" } },
      ],
    }),
  );
  assert.throws(
    () =>
      applyAgentEdits(before, [
        {
          op: "connect",
          edge: { id: "missing", source: "gone", target: "scene" },
        },
      ]),
    /missing node/,
  );
  assert.throws(
    () => applyAgentEdits(before, [{ op: "remove-node", nodeId: "gone" }]),
    /does not exist/,
  );
});

test("agent apply and Undo tolerate only viewport saves while preserving the latest viewport", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-agent-pan-"));
  const store = new Store(path.join(root, ".flow"));
  await store.init();
  const projects = new ProjectService(store);
  await mkdir(path.join(root, "sport"));
  await projects.create({
    id: "sport",
    name: "Sports",
    root: path.join(root, "sport"),
  });
  await store.saveWorkflow({ ...graph(), viewport: { x: 0, y: 0, zoom: 1 } });
  let finishModel;
  const providers = {
    run: () =>
      new Promise((resolve) => {
        finishModel = resolve;
      }),
  };
  const agent = new AgentConversations({
    store,
    projects,
    providers,
    assetPath: () => {},
    dataRoot: store.root,
  });
  t.after(async () => {
    await agent.close();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const session = agent.open({ projectId: "sport" });
  const asked = agent.ask(session.id, input(), "sport");
  assert.equal(agent.get(session.id).turns.at(-1).status, "thinking");
  const panned = { x: 234, y: -157, zoom: 0.49 };
  await store.saveWorkflow({
    ...store.workflows.get("sports"),
    viewport: panned,
    revision: 1,
  });
  finishModel({ kind: "text", text: JSON.stringify(answer) });
  await Promise.all([...agent.jobs]);
  const applied = agent.apply(session.id, asked.turn.id, "sport");
  assert.equal(applied.workflow.revision, 2);
  assert.equal(applied.workflow.nodes[0].data.text, "Monochrome cycling");
  assert.deepEqual(
    applied.workflow.viewport,
    panned,
    "apply preserves pans made during model inference",
  );
  const afterApplyPan = { x: -50, y: 60, zoom: 0.8 };
  await store.saveWorkflow({
    ...store.workflows.get("sports"),
    viewport: afterApplyPan,
    revision: 3,
  });
  const undone = agent.undo(session.id, asked.turn.id, "sport");
  assert.equal(undone.workflow.revision, 4);
  assert.equal(undone.workflow.nodes[0].data.text, "Monochrome sprinting");
  assert.deepEqual(
    undone.workflow.viewport,
    afterApplyPan,
    "Undo preserves pans made after apply",
  );

  // Content, record and layout edits remain conflicts, even alongside a viewport change.
  providers.run = async () => ({ kind: "text", text: JSON.stringify(answer) });
  for (const change of [
    (g) => {
      g.name += " renamed";
    },
    (g) => {
      g.nodes[0].data.text += " human text";
    },
    (g) => {
      g.nodes[1].data.records[0].fields.sport = "rowing";
    },
    (g) => {
      g.nodes[0].position.x += 10;
    },
  ]) {
    const before = structuredClone(store.workflows.get("sports"));
    const proposal = agent.ask(session.id, input(before.revision), "sport");
    await Promise.all([...agent.jobs]);
    const human = structuredClone(before);
    change(human);
    human.viewport = { x: 999, y: 999, zoom: 1 };
    human.revision++;
    await store.saveWorkflow(human);
    assert.throws(
      () => agent.apply(session.id, proposal.turn.id, "sport"),
      (error) => error.status === 409,
    );
    assert.deepEqual(
      store.workflows.get("sports"),
      human,
      "conflict preserves all human edits",
    );
  }
  const final = agent.ask(
    session.id,
    input(store.workflows.get("sports").revision),
    "sport",
  );
  await Promise.all([...agent.jobs]);
  agent.apply(session.id, final.turn.id, "sport");
  const newer = structuredClone(store.workflows.get("sports"));
  newer.nodes[0].position.y += 25;
  newer.revision++;
  await store.saveWorkflow(newer);
  assert.throws(
    () => agent.undo(session.id, final.turn.id, "sport"),
    (error) => error.status === 409,
  );
  assert.deepEqual(
    store.workflows.get("sports"),
    newer,
    "Undo refuses to overwrite a later layout edit",
  );
});

test("non-Codex thinking choices survive the agent API and reach the selected adapter", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "flow-agent-thinking-"));
  const store = new Store(directory);
  await store.init();
  const projects = new ProjectService(store);
  const requests = [];
  const agent = new AgentConversations({
    store,
    projects,
    dataRoot: directory,
    assetPath: () => {},
    providers: {
      run: async ({ job }) => {
        requests.push(job);
        return {
          kind: "text",
          text: JSON.stringify({
            message: "Ready",
            edits: [],
            focusNodeIds: [],
          }),
        };
      },
    },
  });
  t.after(async () => {
    await agent.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const session = agent.open({ fresh: true });
  for (const [providerId, reasoningEffort] of [
    ["ollama", "off"],
    ["ollama", "on"],
    ["ollama", "inherit"],
    ["pi", "high"],
    ["claude-code", "low"],
  ]) {
    const id = randomUUID();
    agent.ask(session.id, {
      id,
      providerId,
      reasoningEffort,
      model: providerId === "ollama" ? "local" : "default",
      message: "Say ready",
      context: { page: "settings" },
    });
    let turn;
    for (let n = 0; n < 100; n++) {
      turn = agent.get(session.id).turns.find((t) => t.id === id);
      if (!["queued", "thinking"].includes(turn.status)) break;
      await new Promise((done) => setTimeout(done, 5));
    }
    assert.equal(turn.status, "ready", turn.error);
    assert.equal(turn.reasoningEffort, reasoningEffort);
    assert.equal(requests.at(-1).reasoningEffort, reasoningEffort);
    assert.equal(requests.at(-1).providerId, providerId);
  }
});
