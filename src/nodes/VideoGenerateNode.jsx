import React, { useContext } from "react";
import { Play, Loader2, Video } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import { MediaPreview } from "../media/MediaPreview.jsx";
import { Header, Socket } from "./NodeChrome.jsx";
import { accents } from "./catalog.mjs";
import { cls } from "../studio/ui.mjs";
import "../media/media.css";
import { GenerationModes } from "./GenerationModes.jsx";

export function VideoGenerationControls(props) {
  return <GenerationModes {...props} kind="video" />;
}

export function VideoGenerateNode({ id, data, selected }) {
  const context = useContext(StudioContext);
  const {
    jobs,
    activeNodeIds,
    starting,
    runWorkflow,
    resumeRun,
    openImage,
    readOnly,
    openSettings,
    providers,
  } = context;
  const nodeJobs = jobs.filter((job) => job.nodeId === id);
  const completed = nodeJobs.filter(
    (job) => job.status === "completed" && job.output,
  );
  const current = completed.at(-1);
  const pending = nodeJobs.find((job) =>
    ["running", "queued", "retrying", "interrupted"].includes(job.status),
  );
  const failed = nodeJobs.find((job) => job.status === "failed");
  const recoverable = nodeJobs.find(
    (job) =>
      job.providerOperation &&
      ["failed", "interrupted", "cancelled"].includes(job.status),
  );
  const uncertain = Boolean(recoverable && !recoverable.providerOperation.id);
  const active =
    activeNodeIds.has(id) ||
    nodeJobs.some((job) =>
      ["queued", "running", "retrying"].includes(job.status),
    );
  const effectiveProviderId =
    data.modes?.find(
      (mode) => !providers.some((p) => p.id === mode.providerId && p.ready),
    )?.providerId ||
    data.modes?.[0]?.providerId ||
    data.providerId ||
    "gemini-video";
  const provider = providers.find((p) => p.id === effectiveProviderId);
  const ready = data.modes?.length
    ? data.modes.every((mode) =>
        providers.some((p) => p.id === mode.providerId && p.ready),
      )
    : Boolean(provider?.ready);
  const gemini = effectiveProviderId === "gemini-video";
  return (
    <div
      className={cls(
        "studio-node generate-node video-generate-node",
        selected && "is-selected",
        active && "is-running",
      )}
      style={{ "--accent": accents["video-generate"] }}
    >
      <Header id={id} type="video-generate" label={data.label} />
      <VideoGenerationControls {...context} id={id} data={data} />
      <div className="generation-preview video-generation-preview nodrag">
        {current ? (
          <>
            <MediaPreview
              item={current}
              controls
              alt="Generated video preview"
            />
            <button
              className="video-inspect"
              onClick={() => openImage({ ...current, collection: completed })}
            >
              Inspect clip & inputs
            </button>
          </>
        ) : (
          <div className="video-empty">
            <Video size={28} />
            <span>
              {active ? "Generating video…" : "Your video appears here"}
            </span>
          </div>
        )}
        {current?.mode && (
          <div className="mode-badge">
            <HarnessLogo id={current.providerId} size={13} />
            {current.mode.label} · copy{" "}
            {(current.comparison?.copyIndex ?? 0) + 1}
          </div>
        )}
        {completed.length > 1 && (
          <span className="preview-tag">{completed.length} clips</span>
        )}
      </div>
      {!ready && (
        <div className="video-setup-notice nodrag" role="status">
          <strong>
            {gemini
              ? "Video API setup required"
              : "Video provider setup required"}
          </strong>
          <p>
            {provider?.status ||
              (gemini
                ? "Connect a Gemini API key or Google OAuth application credentials."
                : "Configure or reload this video provider in Settings.")}
          </p>
          <button
            disabled={readOnly}
            onClick={() =>
              openSettings(
                provider?.kind === "comfyui" ? "local-models" : "providers",
              )
            }
          >
            {gemini ? "Set up Gemini video" : "Manage video provider"}
          </button>
          {gemini && (
            <small>
              Gemini Pro / Flow credits do not authenticate this API.
            </small>
          )}
        </div>
      )}
      <div className="video-job-status nodrag" role="status" aria-live="polite">
        {active ? <Loader2 size={13} className="spin" /> : null}
        {pending?.message ||
          (active
            ? "Waiting for provider progress…"
            : failed?.error ||
              (current
                ? "Video saved locally"
                : provider?.kind === "command"
                  ? "Ready for local video processing"
                  : "Plan before generation · provider billing applies"))}
      </div>
      {Number.isFinite(pending?.providerOperation?.progress) && (
        <div className="mode-progress">
          <progress max="100" value={pending.providerOperation.progress} />
          <span>{pending.providerOperation.progress}%</span>
        </div>
      )}
      <button
        className="node-run nodrag"
        disabled={
          !ready ||
          active ||
          starting ||
          readOnly ||
          uncertain ||
          (recoverable && !recoverable.runId)
        }
        title={
          uncertain
            ? "Submission outcome is unknown. Check the provider before explicitly creating a new run."
            : recoverable
              ? "Poll the saved provider operation without submitting another video"
              : undefined
        }
        onClick={() =>
          recoverable ? resumeRun(recoverable.runId) : runWorkflow(id)
        }
      >
        {active ? <Loader2 className="spin" size={13} /> : <Play size={12} />}
        <span>
          {active
            ? "Generating video"
            : uncertain
              ? "Submission needs review"
              : recoverable
                ? "Resume video"
                : failed
                  ? "Run again"
                  : "Run node"}
        </span>
        <span>
          {context.plan?.nodes?.[id] ??
            data.modes?.reduce((sum, mode) => sum + mode.count, 0) ??
            data.count ??
            1}{" "}
          <Video size={12} />
        </span>
      </button>
      <Socket type="text" top={85} label="Prompt" />
      <Socket type="image" top={126} label="Initial image" />
      <Socket type="video" kind="source" top={250} label="Video" />
    </div>
  );
}
