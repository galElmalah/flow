import React, { useEffect, useState } from "react";
import { Clock3, ChevronRight } from "lucide-react";
import { AgentDisclosure } from "./AgentDisclosure.jsx";
const labels = {
  accepted: "Server accepted",
  contextResolved: "Page context ready",
  providerStarted: "Provider checks started",
  spawned: "Codex process spawned",
  initialized: "Codex initialized",
  configured: "Tool isolation verified",
  threadStarted: "Thread ready",
  turnRequested: "Model requested",
  turnAccepted: "Model accepted",
  firstActivity: "First model activity",
  firstDelta: "First text delta",
  firstOutput: "First answer chunk",
  previewAvailable: "Reply decoded",
  previewPersisted: "Reply saved for display",
  providerCompleted: "Model turn completed",
  providerFinished: "Provider finished",
  finished: "Turn finished",
};
const duration = (ms) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
export function AgentTiming({ turn, client, sessionId }) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  const points = Object.entries(turn.timing?.milestones || {}).sort(
    (a, b) => a[1] - b[1],
  );
  useEffect(() => {
    if (!open) return;
    let live = true;
    client
      .agentTrace(sessionId, turn.id)
      .then((value) => {
        if (live) {
          setData(value);
          setError("");
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [open, turn.id, turn.timing?.milestones?.finished, sessionId, client]);
  if (!points.length) return null;
  const first = turn.timing.milestones.previewPersisted;
  const end = turn.timing.milestones.finished;
  const spans = data?.spans || [];
  const displayedSpans = spans.filter((span) => span.name !== "agent.persist");
  const codex = spans.find((span) => span.name === "codex.session")?.attributes;
  const origin = spans.length ? Math.min(...spans.map((s) => s.startTime)) : 0;
  const total = spans.length
    ? Math.max(...spans.map((s) => s.startTime + s.durationMs)) - origin
    : 1;
  return (
    <AgentDisclosure
      className="agent-timing"
      open={open}
      onToggle={() => setOpen(!open)}
      summary={
        <>
          <Clock3 size={12} />
          <span>Timing</span>
          <small>
            {first !== undefined
              ? `First text ${duration(first)}`
              : ["queued", "thinking"].includes(turn.status)
                ? "Waiting for first text"
                : turn.answer?.message
                  ? "First text not measured"
                  : "No reply text received"}
            {end !== undefined ? ` · Total ${duration(end)}` : ""}
          </small>
          <ChevronRight size={12} />
        </>
      }
    >
      <div className="agent-timing-body">
        {codex?.["gen_ai.request.model"] && (
          <p>
            {codex["gen_ai.request.model"]}
            {codex["gen_ai.request.reasoning_effort"]
              ? ` · ${codex["gen_ai.request.reasoning_effort"]} reasoning`
              : ""}
          </p>
        )}
        <p>
          Milestones from server acceptance. Browser paint uses its own submit
          clock.
        </p>
        <dl>
          {turn.timing.milestones.turnRequested !== undefined && (
            <>
              <dt>Local provider setup</dt>
              <dd>
                {duration(
                  turn.timing.milestones.turnRequested -
                    turn.timing.milestones.providerStarted,
                )}
              </dd>
            </>
          )}
          {turn.timing.milestones.firstDelta !== undefined &&
            turn.timing.milestones.turnRequested !== undefined && (
              <>
                <dt>Model request → first text</dt>
                <dd>
                  {duration(
                    turn.timing.milestones.firstDelta -
                      turn.timing.milestones.turnRequested,
                  )}
                </dd>
              </>
            )}
          {first !== undefined &&
            turn.timing.milestones.firstDelta !== undefined && (
              <>
                <dt>First delta → published reply</dt>
                <dd>{duration(first - turn.timing.milestones.firstDelta)}</dd>
              </>
            )}
        </dl>
        <details className="agent-timing-milestones">
          <summary>All server milestones</summary>
          <dl>
            {points.map(([name, ms]) => (
              <React.Fragment key={name}>
                <dt>{labels[name] || name}</dt>
                <dd>{duration(ms)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </details>
        {turn.timing.browser && (
          <dl>
            <dt>Click → first reply paint</dt>
            <dd>{duration(turn.timing.browser.elapsedMs)}</dd>
            <dt>Prepare page / save draft</dt>
            <dd>{duration(turn.timing.browser.prepareMs)}</dd>
            <dt>Click → request accepted</dt>
            <dd>{duration(turn.timing.browser.acceptedMs)}</dd>
          </dl>
        )}
        {!!spans.length && (
          <div
            className="agent-trace-waterfall"
            aria-label="OpenTelemetry trace waterfall"
          >
            {displayedSpans.map((s) => (
              <div
                className="agent-trace-row"
                key={s.spanId}
                title={`${s.name}: ${duration(s.durationMs)}`}
              >
                <span>{s.name}</span>
                <i>
                  <b
                    style={{
                      marginLeft: `${(100 * (s.startTime - origin)) / total}%`,
                      width: `${Math.max(0.5, (100 * s.durationMs) / total)}%`,
                    }}
                  />
                </i>
                <small>{duration(s.durationMs)}</small>
              </div>
            ))}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {turn.timing.traceId && (
          <code className="agent-trace-id">Trace {turn.timing.traceId}</code>
        )}
      </div>
    </AgentDisclosure>
  );
}
