import React, { useContext } from "react";
import { Grid2X2, ArrowUpRight, ArrowRight, Play } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
import { Header, Socket } from "./NodeChrome.jsx";
import { MediaPreview } from "../media/MediaPreview.jsx";
import { recordFields, recordTitle } from "../../shared/inspection.mjs";
export function OutputNode({ id, data, selected, type = "output" }) {
  const video = type === "video-output";
  const noun = video ? "videos" : "images";
  const {
    jobs,
    openImage,
    setView,
    outputSources,
    runWorkflow,
    activeNodeIds,
    readOnly,
    starting,
  } = useContext(StudioContext);
  const relevant = jobs.filter((j) => outputSources[id]?.has(j.nodeId));
  const complete = relevant.filter((j) => j.status === "completed" && j.output);
  const recent = complete.slice(-4);
  const running = [...(outputSources[id] || [])].some((nodeId) =>
    activeNodeIds.has(nodeId),
  );
  return (
    <div
      className={cls(
        "studio-node output-node",
        selected && "is-selected",
        running && "is-running",
      )}
      style={{ "--accent": accents.output }}
    >
      <Header id={id} type={type} label={data.label} />
      {recent.length ? (
        <div className="output-grid nodrag">
          {recent.map((j) => (
            <button
              key={j.id}
              title={recordFields(j).quote || recordTitle(j)}
              onClick={() => openImage({ ...j, collection: complete })}
            >
              <MediaPreview
                item={j}
                alt={`${recordTitle(j) || "Generated variation"} · ${j.seed}`}
              />
              <span>
                {j.mode
                  ? `${j.mode.label} · ${(j.comparison?.copyIndex ?? 0) + 1}`
                  : `#${j.seed}`}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="output-placeholder">
          <Grid2X2 size={28} aria-hidden="true" />
          {running && (
            <span>Waiting for first {video ? "video" : "image"}…</span>
          )}
        </div>
      )}
      <div className="output-status">
        <span className={cls("tiny-dot", running && "pulsing")} />
        <span>
          {complete.length
            ? `${complete.length} ${complete.length === 1 ? (video ? "video" : "image") : noun} generated`
            : running
              ? "Generation in progress"
              : "No outputs yet"}
        </span>
      </div>
      <button
        className="node-run nodrag"
        aria-label={`Run ${data.label}`}
        disabled={running || readOnly || starting}
        onClick={() => runWorkflow(id)}
      >
        <Play size={12} />
        <span>{running ? "Flow is running" : "Run this flow"}</span>
        <ArrowRight size={12} />
      </button>
      <button
        className="output-gallery nodrag"
        aria-label={`Open ${data.label} gallery`}
        onClick={() =>
          complete.length
            ? openImage({ ...complete[0], collection: complete })
            : setView("gallery")
        }
      >
        Open gallery <ArrowUpRight size={13} />
      </button>
      <Socket
        type={video ? "video" : "image"}
        top={155}
        label={video ? "Videos" : "Images"}
      />
      {!video && (
        <Socket type="image" kind="source" top={290} label="Collection" />
      )}
    </div>
  );
}
