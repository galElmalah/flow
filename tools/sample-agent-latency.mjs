import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WeftClient } from "../client/index.mjs";
const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:4310" },
    project: { type: "string" },
    workflow: { type: "string" },
    samples: { type: "string", default: "5" },
    out: { type: "string" },
    compare: { type: "boolean", default: false },
  },
});
const samples = Number(values.samples);
if (
  !values.project ||
  !values.workflow ||
  !Number.isInteger(samples) ||
  samples < 1 ||
  samples > 20
)
  throw new Error(
    "Use --project ID --workflow ID --samples 1..20 [--out report.json]. This uses real text inference, never image generation.",
  );
const client = new WeftClient({ url: values.url, projectId: values.project });
const server = await client.request("/api/server");
if (!server.telemetry?.enabled)
  throw new Error(
    "Start/restart the idle server with local OpenTelemetry enabled first.",
  );
const graph = await client.workflow(values.workflow);
const report = {
  createdAt: new Date().toISOString(),
  provider: "codex-text",
  nodeCount: graph.nodes.length,
  samples: [],
  failures: 0,
};
for (let index = 0; index < samples * (values.compare ? 2 : 1); index++) {
  const reasoningEffort = values.compare
    ? index % 2
      ? "medium"
      : "inherit"
    : "medium";
  const session = await client.agentSession({ fresh: true });
  const accepted = await client.askAgent(session.id, {
    id: randomUUID(),
    message:
      "Read-only latency check. Name this workflow’s main output and describe its shared visual style in two short sentences. Return edits:[] and focusNodeIds:[]. Do not change anything or generate images.",
    providerId: "codex-text",
    model: "default",
    reasoningEffort,
    context: { page: "canvas", workflowId: graph.id, revision: graph.revision },
  });
  const start = performance.now();
  let firstObservedMs, turn;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const current = await client.agentConversation(session.id);
    turn = current.turns.find((t) => t.id === accepted.turn.id);
    if (firstObservedMs === undefined && turn.preview?.text)
      firstObservedMs = performance.now() - start;
    if (!["thinking", "queued"].includes(turn.status)) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  if (["thinking", "queued"].includes(turn?.status)) {
    const cancelled = await client.cancelAgentTurn(
      session.id,
      accepted.turn.id,
    );
    turn = cancelled.turn;
  }
  const valid =
    turn?.status === "ready" &&
    turn.answer?.message?.length > 0 &&
    turn.answer.edits.length === 0;
  if (!valid) report.failures++;
  const trace = await client.agentTrace(session.id, accepted.turn.id);
  const sample = {
    reasoningEffort,
    sessionId: session.id,
    turnId: accepted.turn.id,
    status: turn.status,
    valid,
    firstObservedMs,
    timing: trace.timing,
    spans: trace.spans,
  };
  report.samples.push(sample);
  console.log(
    JSON.stringify({
      sample: index + 1,
      reasoningEffort,
      valid,
      status: turn.status,
      milestones: trace.timing?.milestones,
      traceId: trace.timing?.traceId,
    }),
  );
  if (values.out)
    await writeFile(values.out, JSON.stringify(report, null, 2) + "\n");
  if (!valid) {
    process.exitCode = 1;
    break;
  }
}
const stats = (rows) => {
  const first = rows
    .map((s) => s.timing?.milestones.previewPersisted)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return {
    count: rows.length,
    failures: rows.filter((s) => !s.valid).length,
    firstTextMs: first.length
      ? {
          median: first[Math.floor(first.length / 2)],
          min: first[0],
          max: first.at(-1),
        }
      : null,
  };
};
report.summary = values.compare
  ? Object.fromEntries(
      ["inherit", "medium"].map((effort) => [
        effort,
        stats(report.samples.filter((s) => s.reasoningEffort === effort)),
      ]),
    )
  : stats(report.samples);
console.log(JSON.stringify(report.summary));
if (values.out)
  await writeFile(values.out, JSON.stringify(report, null, 2) + "\n");
