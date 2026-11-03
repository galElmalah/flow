import React, { useState } from "react";
import {
  Check,
  ChevronRight,
  LoaderCircle,
  Square,
  Wrench,
  X,
  Undo2,
} from "lucide-react";
import { AgentDisclosure } from "./AgentDisclosure.jsx";

const labels = {
  read_page_context: "Read page context",
  harness_request: "Request harness reply",
  validate_workflow_changes: "Validate workflow proposal",
  apply_agent_changes: "Apply workflow changes",
  cancel_agent_turn: "Stop agent request",
  undo_agent_changes: "Undo workflow changes",
};
const kinds = {
  tool: "Platform tool",
  context: "Context",
  harness: "Harness",
  validation: "Validation",
};
const pretty = (value) => JSON.stringify(value, null, 2);
function StateIcon({ status }) {
  if (status === "running") return <LoaderCircle className="spin" size={12} />;
  if (status === "completed" || status === "applied")
    return <Check size={12} />;
  if (status === "failed" || status === "interrupted") return <X size={12} />;
  if (status === "undone") return <Undo2 size={12} />;
  return <Square size={10} />;
}
function phaseDescription(call, turn) {
  if (call.status === "running")
    return turn.progress || "Working on this step…";
  if (["failed", "interrupted", "cancelled"].includes(call.status))
    return (
      call.output?.message ||
      call.output?.error ||
      turn.error ||
      `Step ${call.status}.`
    );
  if (typeof call.output?.message === "string") return call.output.message;
  if (call.name === "read_page_context") {
    const output = call.output || {};
    return output.workflowId
      ? `Read ${output.nodeCount ?? 0} nodes from the current workflow${output.readOnly ? " · read only" : ""}.`
      : `Read the ${output.page || turn.context?.page || "current"} page context.`;
  }
  if (call.name === "harness_request") return "Harness reply received.";
  if (call.name === "apply_agent_changes") return "Workflow changes saved.";
  if (call.name === "undo_agent_changes") return "Workflow changes undone.";
  return "Step completed.";
}
function Inspector({ call }) {
  const [open, setOpen] = useState(false);
  return (
    <AgentDisclosure
      className="agent-phase-inspector"
      open={open}
      onToggle={() => setOpen(!open)}
      summary={
        <>
          <ChevronRight className="agent-call-chevron" size={11} />
          <span>Inputs & result</span>
        </>
      }
    >
      <div className="agent-call-body">
        <div className="agent-call-meta">
          <span>{kinds[call.kind] || "Activity"}</span>
          <code>{call.name}</code>
        </div>
        <strong>Input</strong>
        <pre>{pretty(call.input || {})}</pre>
        {call.output !== undefined && (
          <>
            <strong>Result</strong>
            <pre>{pretty(call.output)}</pre>
          </>
        )}
        {call.startedAt && (
          <span className="agent-call-time">
            Started {new Date(call.startedAt).toLocaleTimeString()}
            {call.finishedAt
              ? ` · Finished ${new Date(call.finishedAt).toLocaleTimeString()}`
              : " · In progress"}
          </span>
        )}
      </div>
    </AgentDisclosure>
  );
}
function Operation({ edit, status }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <AgentDisclosure
        className="agent-operation"
        data-status={status}
        open={open}
        onToggle={() => setOpen(!open)}
        summary={
          <>
            <Wrench size={11} />
            <span>
              {edit.op}
              {edit.nodeId
                ? ` · ${edit.nodeId}`
                : edit.node?.id
                  ? ` · ${edit.node.id}`
                  : ""}
            </span>
            <ChevronRight className="agent-call-chevron" size={11} />
          </>
        }
      >
        <div className="agent-call-body">
          <strong>Arguments</strong>
          <pre>{pretty(edit)}</pre>
        </div>
      </AgentDisclosure>
    </li>
  );
}
export function AgentActivity({ turn, elapsed }) {
  const edits = turn.answer?.edits || [];
  const operationStatus = turn.receipt?.undoneAt
    ? "undone"
    : turn.receipt
      ? "applied"
      : "proposed";
  const calls = turn.activity?.length
    ? turn.activity
    : edits.length
      ? [
          {
            id: "workflow-operations",
            name: "Workflow operations",
            status: operationStatus,
          },
        ]
      : [];
  const current =
    calls.findLast((call) => call.status === "running") || calls.at(-1);
  const frontier = current ? `${current.id}:${current.status}` : "";
  const [selection, setSelection] = useState({ frontier, openId: current?.id });
  const openId =
    selection.frontier === frontier ? selection.openId : current?.id;
  if (!calls.length) return null;
  const operationsCall =
    calls.findLast((call) =>
      [
        "validate_workflow_changes",
        "apply_agent_changes",
        "undo_agent_changes",
      ].includes(call.name),
    ) || calls.at(-1);
  return (
    <div className="agent-activity" aria-label="Agent activity and tool calls">
      <ol className="agent-phase-tree" aria-label="Agent phases">
        {calls.map((call) => (
          <li className="agent-phase" key={call.id} data-status={call.status}>
            <AgentDisclosure
              className="agent-phase-row"
              open={openId === call.id}
              onToggle={() =>
                setSelection({
                  frontier,
                  openId: openId === call.id ? null : call.id,
                })
              }
              summary={
                <>
                  <span className="agent-phase-marker">
                    <StateIcon status={call.status} />
                  </span>
                  <span className="agent-phase-title">
                    {labels[call.name] || call.name}
                  </span>
                  <small className="agent-phase-status">
                    {call.status === "running"
                      ? `Working${elapsed ? ` · ${elapsed}` : ""}`
                      : call.status}
                  </small>
                  <ChevronRight className="agent-call-chevron" size={11} />
                </>
              }
            >
              <div className="agent-phase-content">
                <p
                  className="agent-phase-description"
                  aria-live={call.status === "running" ? "polite" : "off"}
                >
                  {phaseDescription(call, turn)}
                </p>
                {call.id === operationsCall?.id && !!edits.length && (
                  <div className="agent-operations">
                    <span className="agent-operations-heading">
                      Workflow operations · {operationStatus}
                    </span>
                    <ol>
                      {edits.map((edit, index) => (
                        <Operation
                          key={index}
                          edit={edit}
                          status={operationStatus}
                        />
                      ))}
                    </ol>
                  </div>
                )}
                <Inspector call={call} />
              </div>
            </AgentDisclosure>
          </li>
        ))}
      </ol>
    </div>
  );
}
