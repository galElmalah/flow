import React, { useContext } from "react";
import { ArrowUpRight, Play } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { Header, Socket } from "./NodeChrome.jsx";
import { accents } from "./catalog.mjs";
import { cls } from "../studio/ui.mjs";
import { promptItemJobs, promptItemStatus } from "../../shared/prompt-sets.mjs";
import "../prompt-sets.css";

export function PromptSetNode({ id, data, selected }) {
  const {
    inspectNode,
    inspectPromptItem,
    jobs,
    runWorkflow,
    starting,
    readOnly,
  } = useContext(StudioContext);
  const items = data.prompts || [],
    enabled = items.filter((item) => item.enabled !== false);
  const setJobs = jobs.filter((job) => job.promptSet?.nodeId === id);
  const working = setJobs.some((job) =>
    ["running", "queued", "retrying"].includes(job.status),
  );
  return (
    <div
      className={cls(
        "studio-node prompt-set-node",
        selected && "is-selected",
        working && "is-running",
      )}
      style={{ "--accent": accents["prompt-set"] }}
    >
      <Header id={id} type="prompt-set" label={data.label} />
      <div className="prompt-set-caption">{items.length} scenes</div>
      <div
        className="prompt-set-rows nodrag nowheel"
        aria-label={`${data.label} scenes`}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            className={cls(
              "prompt-set-row",
              item.enabled === false && "is-disabled",
            )}
            onClick={() => inspectPromptItem(id, item.id)}
            aria-label={`Edit scene ${item.label}`}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{item.label}</strong>
            <small>
              {item.enabled === false
                ? "Excluded"
                : promptItemStatus(promptItemJobs(jobs, id, item.id))}
            </small>
            <ArrowUpRight size={12} />
          </button>
        ))}
        {!items.length && (
          <button className="prompt-set-empty" onClick={() => inspectNode(id)}>
            Add your first scene
          </button>
        )}
      </div>
      <div className="prompt-set-node-actions nodrag">
        <button onClick={() => inspectNode(id)}>
          Edit scenes <ArrowUpRight size={12} />
        </button>
        <button
          disabled={readOnly || starting || !enabled.length || working}
          onClick={() =>
            runWorkflow(undefined, {
              promptSet: {
                nodeId: id,
                itemIds: enabled.map((item) => item.id),
              },
            })
          }
        >
          <Play size={12} />
          Run set
        </button>
      </div>
      <div className="node-foot">
        <span>{enabled.length} enabled</span>
      </div>
      <Socket type="text" top={110} label="Shared direction" />
      <Socket type="image" top={145} label="References" />
      <Socket type="text" kind="source" top={180} label="Scene prompts" />
    </div>
  );
}
