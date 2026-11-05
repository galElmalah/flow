import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import React, { useContext, useState } from "react";
import {
  Image as ImageIcon,
  Grid2X2,
  ChevronLeft,
  ChevronRight,
  Check,
  Play,
  Maximize,
  Loader2,
} from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
import { Header, Socket } from "./NodeChrome.jsx";
import { GenerationModes } from "./GenerationModes.jsx";
export function GenerateNode({ id, data, selected }) {
  const {
    runWorkflow,
    resumeRun,
    jobs,
    plan,
    openImage,
    activeNodeIds,
    readOnly,
    starting,
  } = useContext(StudioContext);
  const nodeJobs = jobs.filter((j) => j.nodeId === id);
  const complete = nodeJobs.filter((j) => j.status === "completed");
  const [previewId, setPreviewId] = useState(null);
  const [previewAll, setPreviewAll] = useState(false);
  const chosenIndex = complete.findIndex((j) => j.id === previewId);
  const previewIndex = chosenIndex < 0 ? complete.length - 1 : chosenIndex;
  const currentImage = complete[previewIndex];
  const active =
    activeNodeIds.has(id) ||
    nodeJobs.some((job) =>
      ["queued", "running", "retrying"].includes(job.status),
    );
  const recoverable = nodeJobs.find(
    (job) =>
      job.providerOperation &&
      ["failed", "interrupted", "cancelled"].includes(job.status),
  );
  const uncertain = Boolean(recoverable && !recoverable.providerOperation.id);
  const pending = nodeJobs.find((job) =>
    ["queued", "running", "retrying"].includes(job.status),
  );
  const failed = nodeJobs.some((j) => j.status === "failed");
  const preview = currentImage?.output || data.preview;
  const viewPreview = () => {
    if (preview)
      openImage(
        currentImage
          ? { ...currentImage, collection: complete }
          : { output: preview, label: data.label },
      );
  };
  return (
    <div
      className={cls(
        "studio-node generate-node",
        selected && "is-selected",
        active && "is-running",
      )}
      style={{ "--accent": accents.generate }}
    >
      <Header id={id} type="generate" label={data.label} />
      <GenerationModes id={id} data={data} kind="image" />
      <div
        className={cls(
          "generation-preview nodrag",
          data.ratio === "2:1" && "wide-reference-preview",
        )}
        onDoubleClick={(e) => {
          e.stopPropagation();
        }}
      >
        {previewAll && complete.length ? (
          <div className="node-result-grid nowheel">
            {complete.map((j) => (
              <button
                key={j.id}
                aria-label={`View result ${j.seed}`}
                onClick={() => {
                  setPreviewId(j.id);
                  openImage({ ...j, collection: complete });
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <img src={j.output} alt={`Result ${j.seed}`} loading="lazy" />
                {j.mode && (
                  <span className="mode-badge">
                    <HarnessLogo id={j.providerId} size={12} />
                    {j.mode.label} · {(j.comparison?.copyIndex ?? 0) + 1}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : preview ? (
          <button
            className="generation-image-open"
            aria-label={`Inspect ${data.label} image lineage`}
            onClick={(event) => {
              event.stopPropagation();
              viewPreview();
            }}
          >
            <img src={preview} alt="Generation preview" />
          </button>
        ) : (
          <div className="gradient-swatch" />
        )}
        {preview && (
          <div className="preview-toolbar">
            <div>
              {complete.length > 1 && (
                <button
                  className="preview-mode"
                  aria-label={`Show ${previewAll ? "single result" : "all results"} for ${data.label}`}
                  aria-pressed={previewAll}
                  onClick={() => setPreviewAll(!previewAll)}
                >
                  <Grid2X2 size={12} />
                  {previewAll ? "All" : "Single"}
                </button>
              )}
              <button
                aria-label={`Previous result for ${data.label}`}
                disabled={previewIndex <= 0}
                hidden={previewAll}
                onClick={() => setPreviewId(complete[previewIndex - 1].id)}
              >
                <ChevronLeft size={14} />
              </button>
              <span aria-live="polite">
                {previewAll
                  ? `${complete.length} images`
                  : complete.length
                    ? `${previewIndex + 1} / ${complete.length}`
                    : "Reference"}
              </span>
              <button
                aria-label={`Next result for ${data.label}`}
                disabled={previewIndex >= complete.length - 1}
                hidden={previewAll}
                onClick={() => setPreviewId(complete[previewIndex + 1].id)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <button
              aria-label={`View result for ${data.label}`}
              onClick={viewPreview}
            >
              <Maximize size={14} />
            </button>
          </div>
        )}
        <span className="preview-tag">
          {active ? (
            <>
              <Loader2 size={11} className="spin" />
              Generating
            </>
          ) : complete.length ? (
            <>
              <Check size={11} /> {complete.length} generated
            </>
          ) : (
            <>Seed preview</>
          )}
        </span>
        <span className="preview-ratio">
          {currentImage?.metadata?.outputFormat === "gif" &&
            `GIF · ${currentImage.metadata.frameCount} frames · `}
          {currentImage?.metadata?.width
            ? `${currentImage.metadata.width}×${currentImage.metadata.height}`
            : data.ratio || "1:1"}
        </span>
      </div>
      {pending?.message && (
        <div className="video-job-status nodrag" role="status">
          {pending.message}
        </div>
      )}
      {Number.isFinite(pending?.providerOperation?.progress) && (
        <div className="mode-progress">
          <progress max="100" value={pending.providerOperation.progress} />
          <span>{pending.providerOperation.progress}%</span>
        </div>
      )}
      <button
        className="node-run nodrag"
        title={
          uncertain
            ? "Submission outcome is unknown. Check the provider before explicitly starting another paid request."
            : recoverable
              ? "Resume the saved provider operation without creating another request"
              : undefined
        }
        disabled={
          active ||
          readOnly ||
          starting ||
          uncertain ||
          Boolean(recoverable && !recoverable.runId)
        }
        onClick={() =>
          recoverable ? resumeRun(recoverable.runId) : runWorkflow(id)
        }
      >
        {active ? (
          <Loader2 size={13} className="spin" />
        ) : (
          <Play size={12} fill="currentColor" />
        )}
        <span>
          {active
            ? "Generating images"
            : uncertain
              ? "Submission needs review"
              : recoverable
                ? "Resume images"
                : failed
                  ? "Run again"
                  : "Run node"}
        </span>
        <span>
          {plan?.nodes?.[id] || data.count || 1} <ImageIcon size={11} />
        </span>
      </button>
      <Socket type="text" top={85} label="Prompt" />
      <Socket type="image" top={126} label="Image" />
      <Socket type="image" kind="source" top={223} label="Result" />
    </div>
  );
}
