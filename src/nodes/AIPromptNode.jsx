import { Autocomplete } from "../components/Autocomplete.jsx";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import React, { useContext, useState } from "react";
import { Type, Sparkles, ChevronDown, Play, Copy, Loader2 } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
import { Header, Socket } from "./NodeChrome.jsx";
import { modelsFor } from "../panels/ProviderPicker.jsx";
import { recordTitle } from "../../shared/inspection.mjs";
export function AIPromptNode({ id, data, selected }) {
  const {
    editNode,
    chooseProvider,
    providers,
    jobs,
    runWorkflow,
    activeNodeIds,
    readOnly,
    starting,
  } = useContext(StudioContext);
  const provider = providers.find(
    (p) => p.id === (data.providerId || "codex-text"),
  );
  const results = jobs.filter((j) => j.nodeId === id),
    active = activeNodeIds.has(id),
    failed = results.find((j) => j.status === "failed");
  const completed = results.filter((j) => j.resultText),
    [index, setIndex] = useState(0);
  const result = completed[Math.min(index, completed.length - 1)];
  const [copyMessage, setCopyMessage] = useState("");
  return (
    <div
      className={cls(
        "studio-node ai-prompt-node",
        selected && "is-selected",
        active && "is-running",
      )}
      style={{ "--accent": accents["prompt-generate"] }}
    >
      <Header id={id} type="prompt-generate" label={data.label} />
      <button
        className="model-select provider-trigger nodrag"
        aria-label={`Choose provider for ${data.label}`}
        disabled={readOnly}
        onClick={() => chooseProvider(id)}
      >
        <span className="codex-symbol">
          <HarnessLogo
            id={provider?.id || data.providerId || "codex-text"}
            size={22}
          />
        </span>
        <span>
          {provider?.name || data.providerId || "Codex"}
          <span className="model-sub">
            Prompt generation ·{" "}
            {provider?.ready ? "Connected" : "Setup required"}
          </span>
        </span>
        <ChevronDown size={13} />
      </button>
      <label className="model-inline-select nodrag">
        Model
        {provider?.kind === "harness" ? (
          <input
            readOnly={readOnly}
            aria-label={`Model for ${data.label}`}
            value={data.model || "default"}
            onChange={(e) =>
              editNode(id, { model: e.target.value || "default" })
            }
            placeholder="default"
          />
        ) : (
          <Autocomplete
            disabled={readOnly}
            label={`Model for ${data.label}`}
            value={data.model || modelsFor(provider, "text")[0]}
            onChange={(value) => editNode(id, { model: value })}
            options={modelsFor(provider, "text").map((m) => ({
              value: m,
              label: m,
              icon: (
                <HarnessLogo id={provider?.id} model modelId={m} size={18} />
              ),
            }))}
          />
        )}
      </label>
      <span className="ai-field-label">INSTRUCTIONS</span>
      <textarea
        readOnly={readOnly}
        className="prompt-text nodrag nowheel"
        aria-label={`${data.label} instructions`}
        value={data.text || ""}
        onChange={(e) => editNode(id, { text: e.target.value })}
        placeholder="Turn the incoming idea into a detailed image prompt…"
      />
      <div className="ai-result nodrag nowheel">
        <header>
          <span>
            <Sparkles size={11} /> GENERATED PROMPT
          </span>
          {completed.length > 1 && (
            <Autocomplete
              label={`${data.label} result`}
              value={Math.min(index, completed.length - 1)}
              onChange={(value) => setIndex(Number(value))}
              options={completed.map((j, i) => ({
                value: String(i),
                label: recordTitle(j) || `${i + 1} / ${completed.length}`,
              }))}
            />
          )}
          {result && (
            <button
              title="Copy generated prompt"
              aria-label="Copy generated prompt"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.resultText);
                  setCopyMessage("Prompt copied");
                } catch {
                  setCopyMessage(
                    "Could not copy. Select the generated prompt and copy it manually.",
                  );
                }
              }}
            >
              <Copy size={12} />
            </button>
          )}
        </header>
        {copyMessage && <small role="status">{copyMessage}</small>}
        <p className={failed ? "error" : ""}>
          {active
            ? "Writing your next direction…"
            : result?.resultText ||
              failed?.error ||
              "Your generated text appears here. Connect it to another prompt or image node."}
        </p>
      </div>
      <button
        className="node-run nodrag"
        disabled={active || readOnly || starting}
        onClick={() => runWorkflow(id)}
      >
        {active ? (
          <Loader2 size={13} className="spin" />
        ) : (
          <Play size={12} fill="currentColor" />
        )}
        <span>{active ? "Writing prompt" : "Run node"}</span>
        <span>
          {completed.length || planCount(results)} <Type size={11} />
        </span>
      </button>
      <Socket type="image" top={85} label="Reference" />
      <Socket type="text" top={124} label="Brief" />
      <Socket type="text" kind="source" top={260} label="Prompt" />
    </div>
  );
}
const planCount = (results) => results.length || 1;
