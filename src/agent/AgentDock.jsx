import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  MessageSquare,
  SquarePen,
  ArrowUp,
  ChevronDown,
  Square,
  LoaderCircle,
  CornerUpLeft,
  ArrowUpRight,
} from "lucide-react";
import { FlowClient } from "../../client/index.mjs";
import { IconButton } from "../components/IconButton.jsx";
import { HarnessModelPicker } from "./HarnessModelPicker.jsx";

import { mergeAgentSession } from "./stream-state.mjs";
import { selectedReasoning } from "../../shared/reasoning.mjs";
import { AgentActivity } from "./AgentActivity.jsx";
import { AgentTiming } from "./AgentTiming.jsx";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import {
  readAgentView,
  rememberAgentView,
  restoreAgentSession,
  agentElapsed,
  restoredAgentDraft,
} from "./view-state.mjs";
import "./agent-dock.css";

const AgentMessage = lazy(() =>
  import("./AgentMessage.jsx").then((module) => ({
    default: module.AgentMessage,
  })),
);

const pending = (turn) => ["queued", "thinking"].includes(turn?.status);
export function AgentDock({
  context,
  contextLabel,
  projectId,
  providers,
  controls,
  host,
  onPrepare,
  onApply,
  onUndo,
  onFocus,
  onStreamSession,
}) {
  const client = useMemo(
    () =>
      new FlowClient({
        url: window.location.origin,
        projectId: projectId || undefined,
      }),
    [projectId],
  );
  const [session, setSession] = useState(null),
    [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [provider, setProvider] = useState("codex-text"),
    [model, setModel] = useState("default"),
    [reasoningEffort, setReasoningEffort] = useState("medium"),
    [connected, setConnected] = useState(false),
    [restoredFor, setRestoredFor] = useState(null),
    [clock, setClock] = useState(Date.now());
  const textarea = useRef(null),
    browserTimings = useRef(new Map()),
    toggle = useRef(null),
    transcript = useRef(null),
    autoApply = useRef(null),
    submission = useRef(null),
    currentContext = useRef(context),
    currentClient = useRef(client),
    submitting = useRef(false);
  currentContext.current = context;
  currentClient.current = client;
  const latest = session?.turns.at(-1);
  const working = pending(latest);
  const textProviders = providers.filter((p) =>
    p.capabilities?.includes("text"),
  );
  const chosen = textProviders.find((p) => p.id === provider);
  useEffect(() => {
    let live = true;
    const saved = readAgentView(sessionStorage, projectId);
    setSession(null);
    setRestoredFor(null);
    setOpen(saved.open ?? false);
    setText(saved.draft || "");
    setProvider(saved.provider || "codex-text");
    setModel(saved.model || "default");
    setReasoningEffort(saved.reasoningEffort || "medium");
    setError("");
    autoApply.current = saved.autoApplyId || null;
    submission.current = null;
    restoreAgentSession(client, saved)
      .then((value) => {
        if (!live) return;
        setSession((previous) => mergeAgentSession(previous, value));
        setRestoredFor(client);
        const turn = value.turns.at(-1);
        setText(restoredAgentDraft(saved, turn));
        if (pending(turn)) {
          setOpen(true);
          if (!saved.provider) setProvider(turn.providerId);
          if (!saved.model) setModel(turn.model);
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [client, projectId]);
  useEffect(() => {
    if (restoredFor !== client || !session) return;
    rememberAgentView(sessionStorage, projectId, {
      sessionId: session.id,
      open,
      provider,
      model,
      reasoningEffort,
      draft: text,
    });
  }, [
    client,
    restoredFor,
    session?.id,
    projectId,
    open,
    provider,
    model,
    reasoningEffort,
    text,
  ]);
  useEffect(() => {
    if (!working) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working, latest?.id]);
  useEffect(() => {
    if (!open || !(latest?.preview?.text || latest?.answer?.message)) return;
    const measurement = browserTimings.current.get(latest.id);
    if (
      !measurement ||
      measurement.reported ||
      measurement.acceptedMs === undefined ||
      !followResponse.current
    )
      return;
    let first, second;
    first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (measurement.reported) return;
        measurement.reported = true;
        client
          .reportAgentTiming(session.id, latest.id, {
            elapsedMs: performance.now() - measurement.started,
            prepareMs: measurement.prepareMs,
            acceptedMs: measurement.acceptedMs,
          })
          .then(({ timing }) => {
            if (currentClient.current === client)
              setSession((value) =>
                value?.id === session.id
                  ? {
                      ...value,
                      turns: value.turns.map((turn) =>
                        turn.id === latest.id ? { ...turn, timing } : turn,
                      ),
                    }
                  : value,
              );
          })
          .catch(() => {});
        browserTimings.current.delete(latest.id);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [
    latest?.id,
    Boolean(latest?.preview?.text || latest?.answer?.message),
    open,
    client,
    session?.id,
  ]);
  useEffect(() => {
    if (!session?.id || !working || connected) return;
    let live = true,
      timer;
    const poll = async () => {
      try {
        const value = await client.agentConversation(session.id);
        if (!live) return;
        setSession((previous) => mergeAgentSession(previous, value));
        setError("");
        if (pending(value.turns.at(-1))) timer = setTimeout(poll, 1500);
      } catch (e) {
        if (live) {
          setError(e.message);
          timer = setTimeout(poll, 2000);
        }
      }
    };
    timer = setTimeout(poll, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [session?.id, working, connected, client]);
  useEffect(() => {
    if (!session?.id) return;
    onStreamSession?.({ sessionId: session.id, projectId });
    const receive = (event) => {
      if (event.detail.id !== session.id) return;
      setSession((previous) => mergeAgentSession(previous, event.detail));
      setError("");
    };
    const connection = (event) => setConnected(event.detail);
    window.addEventListener("flow:agent-session", receive);
    window.addEventListener("flow:agent-connection", connection);
    return () => {
      onStreamSession?.(null);
      window.removeEventListener("flow:agent-session", receive);
      window.removeEventListener("flow:agent-connection", connection);
    };
  }, [session?.id, projectId, onStreamSession]);
  const apply = async (turn) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await onApply(client, session.id, turn);
      if (currentClient.current === client)
        setSession((previous) => mergeAgentSession(previous, receipt.session));
    } catch (e) {
      if (currentClient.current === client) {
        setError(e.message);
        const latestSession = await client
          .agentConversation(session.id)
          .catch(() => null);
        if (latestSession && currentClient.current === client)
          setSession((previous) => mergeAgentSession(previous, latestSession));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (latest?.id !== autoApply.current || pending(latest)) return;
    autoApply.current = null;
    rememberAgentView(sessionStorage, projectId, { autoApplyId: null });
    if (
      latest.status === "ready" &&
      latest.answer?.edits.length &&
      latest.context.workflowId === currentContext.current.workflowId &&
      latest.context.page === currentContext.current.page
    )
      apply(latest);
  }, [latest?.id, latest?.status]);
  const followResponse = useRef(true);
  const followMessage = useCallback(() => {
    const container = transcript.current;
    if (container && followResponse.current)
      container.scrollTop = container.scrollHeight;
  }, []);
  useEffect(() => {
    const container = transcript.current;
    if (container && followResponse.current)
      container.scrollTop = container.scrollHeight;
  }, [
    session?.turns.length,
    latest?.status,
    latest?.preview?.text,
    latest?.activity?.length,
    open,
  ]);
  const expand = () => {
    setOpen(true);
    followResponse.current = true;
    requestAnimationFrame(() => textarea.current?.focus());
  };
  useEffect(() => {
    const select = (event) => {
      const { providerId, model: modelId } = event.detail || {};
      const entry = providers.find(
        (p) =>
          p.id === providerId && p.ready && p.capabilities?.includes("text"),
      );
      if (
        !entry?.modelDetails?.some(
          (m) => m.id === modelId && m.capabilities.includes("text"),
        )
      )
        return;
      setProvider(providerId);
      setModel(modelId);
      setReasoningEffort("inherit");
      setOpen(true);
    };
    window.addEventListener("flow:agent-select-model", select);
    return () => window.removeEventListener("flow:agent-select-model", select);
  }, [providers]);
  const send = async (event) => {
    event?.preventDefault();
    if (!text.trim() || !session || working || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setOpen(true);
    followResponse.current = true;
    const message = text.trim();
    const measurement = { started: performance.now() };
    try {
      const page = await onPrepare(currentContext.current);
      measurement.prepareMs = performance.now() - measurement.started;
      if (currentClient.current !== client)
        throw new Error(
          "You changed project. Send the message again from the current page.",
        );
      const fingerprint = JSON.stringify({
        message,
        provider,
        model,
        reasoningEffort: selectedReasoning(
          providers.find((p) => p.id === provider),
          model,
          reasoningEffort,
        ),
        page,
      });
      const id =
        submission.current?.fingerprint === fingerprint
          ? submission.current.id
          : crypto.randomUUID();
      submission.current = { fingerprint, id };
      browserTimings.current.set(id, measurement);
      autoApply.current = id;
      rememberAgentView(sessionStorage, projectId, { autoApplyId: id });
      const result = await client.askAgent(session.id, {
        id,
        message,
        providerId: provider,
        model,
        reasoningEffort: selectedReasoning(
          providers.find((p) => p.id === provider),
          model,
          reasoningEffort,
        ),
        context: page,
      });
      measurement.acceptedMs = performance.now() - measurement.started;
      if (currentClient.current !== client) return;
      submission.current = null;
      setSession((previous) => mergeAgentSession(previous, result.session));
      setText("");
    } catch (e) {
      if (currentClient.current === client) {
        setError(e.message);
        const recovered = await client
          .agentConversation(session.id)
          .catch(() => null);
        if (recovered && currentClient.current === client) {
          if (recovered.turns.some((t) => t.id === submission.current?.id)) {
            submission.current = null;
            setText("");
          }
          setSession((previous) => mergeAgentSession(previous, recovered));
        }
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return createPortal(
    <section
      className={`agent-dock ${open ? "is-open" : ""} ${controls ? "has-canvas-tools" : ""} ${host ? "in-editor" : ""}`}
      aria-label="Page-aware agent"
      onKeyDown={(e) => {
        if (e.key !== "Tab") e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          send();
        }
      }}
      onCopy={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
    >
      <div className="agent-panel-reveal" inert={!open} aria-hidden={!open}>
        <div className="agent-panel">
          <header className="agent-header">
            <div>
              <MessageSquare size={15} />
              <strong>Flow agent</strong>
            </div>
            <div>
              <IconButton
                label="New agent conversation"
                disabled={busy || working}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const next = await client.agentSession({ fresh: true });
                    if (currentClient.current === client) {
                      autoApply.current = null;
                      rememberAgentView(sessionStorage, projectId, {
                        autoApplyId: null,
                      });
                      setSession((previous) =>
                        mergeAgentSession(previous, next),
                      );
                    }
                  } catch (e) {
                    if (currentClient.current === client) setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <SquarePen size={15} />
              </IconButton>
              <IconButton
                label="Minimize agent chat"
                onClick={() => {
                  setOpen(false);
                  requestAnimationFrame(() => toggle.current?.focus());
                }}
              >
                <ChevronDown size={17} />
              </IconButton>
            </div>
          </header>
          <div className="agent-context" title={contextLabel}>
            <span className="agent-context-dot" />
            <span>{contextLabel}</span>
            {context.runId && <small>Recorded · read only</small>}
          </div>
          <div
            className="agent-transcript"
            ref={transcript}
            role="log"
            aria-label="Agent conversation"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={working}
            onScroll={(event) => {
              const container = event.currentTarget;
              followResponse.current =
                container.scrollHeight -
                  container.scrollTop -
                  container.clientHeight <
                70;
            }}
          >
            {!session?.turns.length && (
              <div className="agent-welcome">
                <p>
                  {context.page === "editor"
                    ? "Ask about this image or its regions. Generate edits with Send to agent in the editor."
                    : context.runId
                      ? "Ask about this run. Fork it to make changes."
                      : "Ask about this page or describe a change."}
                </p>
                <div>
                  {(context.page === "editor"
                    ? ["Explain the selected regions and their comments."]
                    : context.image
                      ? ["Explain this image and its inputs."]
                      : context.page === "styles"
                        ? ["Describe this visual style and suggest a scene."]
                        : context.workflowId
                          ? /sport|athlet/i.test(contextLabel)
                            ? [
                                "What sports are in this workflow?",
                                "Help me change the sports while keeping this style.",
                              ]
                            : [
                                "How does this workflow work?",
                                "Help me change its prompts and scenes.",
                              ]
                          : [
                              projectId
                                ? "What workflows are in this project?"
                                : "What projects do I have?",
                            ]
                  ).map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setText(s);
                        textarea.current?.focus();
                      }}
                    >
                      {s}
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(open || working) &&
              session?.turns.map((turn) => (
                <article className="agent-turn" key={turn.id}>
                  <div className="agent-user-message">{turn.message}</div>
                  <div className="agent-response">
                    <span className="agent-response-label">
                      <HarnessLogo id={turn.providerId} size={16} />
                      {textProviders.find((p) => p.id === turn.providerId)
                        ?.name || turn.providerId}{" "}
                      <span>· {turn.context.page}</span>
                      <small
                        className="agent-turn-status"
                        data-status={turn.status}
                      >
                        {turn.status === "ready"
                          ? turn.answer?.edits.length
                            ? "Changes ready"
                            : "Reply ready"
                          : turn.status === "completed"
                            ? turn.receipt?.undoneAt
                              ? "Undone"
                              : turn.receipt
                                ? "Applied"
                                : "Completed"
                            : turn.status}
                      </small>
                    </span>
                    <AgentActivity
                      turn={turn}
                      elapsed={
                        pending(turn) ? agentElapsed(turn, clock) : undefined
                      }
                    />
                    <AgentTiming
                      turn={turn}
                      client={client}
                      sessionId={session.id}
                    />
                    <Suspense
                      fallback={
                        <p>
                          {turn.answer?.message || turn.preview?.text || ""}
                        </p>
                      }
                    >
                      <AgentMessage
                        text={turn.answer?.message || turn.preview?.text || ""}
                        live={pending(turn)}
                        onResize={followMessage}
                      />
                    </Suspense>
                    {pending(turn) ? (
                      turn.activity?.some(
                        (call) => call.status === "running",
                      ) ? null : (
                        <>
                          <p className="agent-thinking" role="status">
                            <LoaderCircle size={13} className="spin" />
                            {turn.preview?.text
                              ? "Writing reply…"
                              : turn.progress ||
                                (turn.status === "queued"
                                  ? "Queued…"
                                  : "Thinking about this page…")}
                            <time className="agent-elapsed">
                              {agentElapsed(turn, clock)}
                            </time>
                          </p>
                          <div
                            className="agent-live-progress"
                            aria-hidden="true"
                          >
                            <i />
                          </div>
                        </>
                      )
                    ) : turn.answer ? null : (
                      <>
                        <p className="agent-turn-error">
                          {turn.error || turn.status}
                          {turn.preview?.text ? " · Partial reply" : ""}
                        </p>
                      </>
                    )}
                    {turn.status === "ready" &&
                      turn.answer?.edits.length > 0 && (
                        <button
                          className="agent-action"
                          disabled={
                            busy ||
                            context.workflowId !== turn.context.workflowId ||
                            Boolean(context.runId)
                          }
                          onClick={() => apply(turn)}
                        >
                          Apply {turn.answer.edits.length} changes
                        </button>
                      )}
                    {turn.receipt && !turn.receipt.undoneAt && (
                      <div className="agent-change-receipt">
                        <span>
                          ✓ Saved ·{" "}
                          {turn.receipt.changedNodeIds.length
                            ? `${turn.receipt.changedNodeIds.length} nodes updated`
                            : "Workflow updated"}
                        </span>
                        <button
                          disabled={
                            busy ||
                            context.workflowId !== turn.context.workflowId
                          }
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              const r = await onUndo(client, session.id, turn);
                              if (currentClient.current === client)
                                setSession((previous) =>
                                  mergeAgentSession(previous, r.session),
                                );
                            } catch (e) {
                              if (currentClient.current === client)
                                setError(e.message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          <CornerUpLeft size={12} />
                          Undo change
                        </button>
                      </div>
                    )}
                    {turn.receipt?.undoneAt && (
                      <small className="agent-change-receipt">
                        Change undone
                      </small>
                    )}
                    {["conflict", "failed", "interrupted"].includes(
                      turn.status,
                    ) && (
                      <p className="agent-turn-error">
                        {turn.error ||
                          "This workflow changed. Send a new message against the latest version."}
                      </p>
                    )}
                    {!!turn.answer?.focusNodeIds?.length &&
                      context.workflowId === turn.context.workflowId && (
                        <button
                          className="agent-focus"
                          onClick={() => {
                            onFocus(turn.answer.focusNodeIds[0]);
                            setOpen(false);
                          }}
                        >
                          Show relevant node <ArrowUpRight size={11} />
                        </button>
                      )}
                  </div>
                </article>
              ))}
          </div>
          {error && (
            <div className="agent-error" role="alert">
              {error}
              <button
                onClick={async () => {
                  try {
                    const next = session
                      ? await client.agentConversation(session.id)
                      : await restoreAgentSession(
                          client,
                          readAgentView(sessionStorage, projectId),
                        );
                    if (currentClient.current === client) {
                      setSession((previous) =>
                        mergeAgentSession(previous, next),
                      );
                      setRestoredFor(client);
                      if (pending(next.turns.at(-1))) setOpen(true);
                      setError("");
                    }
                  } catch (e) {
                    if (currentClient.current === client) setError(e.message);
                  }
                }}
              >
                Reconnect
              </button>
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
          <div className="agent-provider">
            <HarnessModelPicker
              providers={providers}
              provider={provider}
              model={model}
              reasoningEffort={reasoningEffort}
              onReasoningChange={setReasoningEffort}
              onChange={(providerId, modelId, effort) => {
                setProvider(providerId);
                setModel(modelId);
                setReasoningEffort(effort);
              }}
            />
          </div>
        </div>
      </div>
      <div className="agent-dock-row">
        {!!controls && (
          <div className="agent-canvas-controls canvas-toolbar">{controls}</div>
        )}
        <button
          ref={toggle}
          className="agent-toggle"
          aria-label={open ? "Collapse agent chat" : "Expand agent chat"}
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : expand())}
        >
          <MessageSquare size={17} />
          <span>
            {working
              ? latest.preview?.text
                ? "Writing"
                : latest.status === "queued"
                  ? "Queued"
                  : "Thinking"
              : "Agent"}
          </span>
          {working && <LoaderCircle size={12} className="spin" />}
        </button>
        <form className="agent-composer" onSubmit={send}>
          <textarea
            ref={textarea}
            aria-label="Message the page-aware agent"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              open ? "Describe what to change…" : "Ask or change anything…"
            }
            rows={1}
            onFocus={() => {
              if (!open) setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {working ? (
            <IconButton
              label="Stop agent"
              onClick={async () => {
                try {
                  const r = await client.cancelAgentTurn(session.id, latest.id);
                  if (currentClient.current === client)
                    setSession((previous) =>
                      mergeAgentSession(previous, r.session),
                    );
                } catch (e) {
                  if (currentClient.current === client) setError(e.message);
                }
              }}
            >
              <Square size={13} />
            </IconButton>
          ) : (
            <IconButton
              label="Send agent message"
              type="submit"
              disabled={busy || !text.trim() || !session || !chosen?.ready}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <ArrowUp size={17} />
              )}
            </IconButton>
          )}
        </form>
      </div>
    </section>,
    host || document.body,
  );
}
