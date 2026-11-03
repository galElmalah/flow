import React, { useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  LoaderCircle,
  ArrowUpRight,
  RefreshCw,
  Info,
} from "lucide-react";
import { jsonRequest } from "../studio/ui.mjs";
import { AssetLineagePanel } from "../panels/AssetLineagePanel.jsx";

export function Variations({
  editor,
  preview,
  onPreview,
  onOpenVersion,
  onOriginal,
  onGroups,
  onSend,
  onOpenWorkflow,
  busy,
}) {
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const groupsRef = useRef(onGroups);
  const stripRef = useRef(null);
  const revealedVersion = useRef(null);
  groupsRef.current = onGroups;
  useEffect(() => {
    if (preview || revealedVersion.current === editor.source.url) return;
    const strip = stripRef.current;
    const active = strip?.querySelector(".editor-variation-tile.is-active");
    if (!active) return;
    const viewport = strip.getBoundingClientRect();
    const tile = active.getBoundingClientRect();
    const left = viewport.left + strip.clientLeft + 8;
    const right = viewport.left + strip.clientLeft + strip.clientWidth - 8;
    if (tile.left < left) strip.scrollLeft += tile.left - left;
    else if (tile.right > right) strip.scrollLeft += tile.right - right;
    revealedVersion.current = editor.source.url;
  }, [groups, editor.source.url, preview]);
  useEffect(() => {
    let live = true,
      timer;
    const poll = async () => {
      try {
        const next = await jsonRequest(
          `/api/image-editors/${editor.id}/variations`,
        );
        if (!live) return;
        setGroups(next);
        groupsRef.current?.(next);
        setError("");
      } catch (err) {
        if (live) setError(err.message);
      }
      if (live) timer = setTimeout(poll, 1500);
    };
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    editor.id,
    editor.requests.length,
    editor.requests.at(-1)?.runId,
    reload,
  ]);
  const original = editor.original || editor.source;
  const atOriginal = !preview && editor.source.url === original.url;
  return (
    <section className="editor-variations" aria-label="Image variations">
      <header>
        <div>
          <strong>Image versions</strong>
          <span>
            {editor.projectId || editor.source.projectId
              ? `Project · ${editor.projectId || editor.source.projectId}`
              : "Unassigned image"}
          </span>
        </div>
        <span>
          {groups.flatMap((g) => g.jobs).filter((j) => j.output).length} saved
          versions
        </span>
      </header>
      {error && (
        <p role="alert">
          Couldn’t load variations. {error}{" "}
          <button onClick={() => setReload((n) => n + 1)}>Retry</button>
        </p>
      )}
      <div className="editor-variation-strip" ref={stripRef}>
        <button
          className={`editor-variation-tile ${atOriginal ? "is-active" : ""}`}
          onClick={onOriginal}
          aria-label="View original image"
          aria-pressed={atOriginal}
        >
          <img src={original.url} alt="" />
          <span>Original</span>
        </button>
        {!groups.length && !editor.requests.length && (
          <div className="editor-variation-empty">
            <ImagePlus size={22} />
            <div>
              Your next version appears here.
              <small>
                Select a region, comment on the image, then send to your agent.
              </small>
            </div>
          </div>
        )}
        {groups.map((group, index) => {
          const done = group.jobs.filter((j) => j.output).length;
          const active = ["running", "queued"].includes(group.status);
          return (
            <div
              className={`editor-variation-group ${active ? "is-running" : ""}`}
              key={group.requestId}
            >
              <div className="editor-variation-jobs">
                {group.jobs.map((job, i) =>
                  job.output ? (
                    <div className="editor-version-option" key={job.id}>
                      <button
                        className={`editor-variation-tile ${!preview && editor.source.url === job.output ? "is-active" : ""}`}
                        onClick={() => onOpenVersion(job)}
                        aria-label={`Edit version ${index + 1}.${i + 1}`}
                        aria-pressed={
                          !preview && editor.source.url === job.output
                        }
                      >
                        <img
                          src={job.output}
                          alt={`Image version ${index + 1}.${i + 1}`}
                        />
                        <span>
                          {group.mode === "recolor"
                            ? "Recolor"
                            : group.mode === "whole"
                              ? "Regenerated"
                              : "Version"}{" "}
                          {index + 1}
                          {group.jobs.length > 1 ? `.${i + 1}` : ""}
                        </span>
                      </button>
                      <button
                        className="editor-version-info"
                        aria-label={`Inspect version ${index + 1}.${i + 1}`}
                        onClick={() =>
                          onPreview({ ...job, versionRequest: group })
                        }
                      >
                        <Info size={13} />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="editor-variation-pending"
                      key={job.id}
                      role="status"
                    >
                      {["queued", "running", "retrying"].includes(
                        job.status,
                      ) ? (
                        <LoaderCircle size={18} className="spin" />
                      ) : (
                        <ImagePlus size={18} />
                      )}
                      <span>{job.status}</span>
                    </div>
                  ),
                )}
                {!group.jobs.length && (
                  <div className="editor-variation-pending">
                    <ImagePlus size={18} />
                    <span>
                      {group.status === "prepared"
                        ? "Ready to send"
                        : "Run unavailable"}
                    </span>
                  </div>
                )}
              </div>
              <div className="editor-variation-info">
                <strong>
                  {active
                    ? `${group.mode === "recolor" ? "Recoloring" : "Generating"} · ${done}/${group.jobs.length}`
                    : group.status === "completed"
                      ? `${done} ${done === 1 ? "variation" : "variations"} saved`
                      : group.status}
                </strong>
                <small>
                  {group.jobs.find((j) => j.status === "running")?.message ||
                    group.comments?.map((c) => c.text).join(" · ") ||
                    group.instructions}
                </small>
                {group.jobs.find((j) => j.error) && (
                  <small role="alert">
                    {group.jobs.find((j) => j.error).error}
                  </small>
                )}
                <div>
                  {group.status === "prepared" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        onSend(group.requestId, group.editorId, group)
                      }
                    >
                      {group.mode === "recolor"
                        ? "Apply recolor"
                        : "Send to agent"}{" "}
                      <ArrowUpRight size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => onOpenWorkflow({ id: group.workflowId })}
                  >
                    {["failed", "paused", "cancelled", "interrupted"].includes(
                      group.status,
                    ) ? (
                      <RefreshCw size={12} />
                    ) : (
                      <ArrowUpRight size={12} />
                    )}{" "}
                    Open workflow
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function VariationDetails({
  image,
  editor,
  providers,
  onOriginal,
  onEdit,
}) {
  const request =
    image.versionRequest ||
    editor.requests.find((r) => r.id === image.edit?.requestId);
  const original = editor.original || editor.source;
  return (
    <section
      className="editor-variation-details"
      aria-label="Variation details"
    >
      <h2>Variation details</h2>
      <button className="editor-result-primary" onClick={onEdit}>
        <ImagePlus size={15} /> Continue editing
      </button>
      <a
        className="editor-result-download"
        href={image.output}
        download="image-variation.png"
      >
        Download image <ArrowUpRight size={13} />
      </a>
      <button className="editor-result-original" onClick={onOriginal}>
        <img src={original.url} alt="Original source" />
        <span>
          Original image<small>Compare & view comments</small>
        </span>
      </button>
      <dl>
        <div>
          <dt>Project</dt>
          <dd>{image.project?.name || image.projectId || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>
            {image.metadata?.providerName ||
              providers.find((p) => p.id === image.providerId)?.name ||
              image.providerId}
          </dd>
        </div>
        <div>
          <dt>Dimensions</dt>
          <dd>
            {image.metadata?.width
              ? `${image.metadata.width} × ${image.metadata.height}`
              : image.ratio}
          </dd>
        </div>
      </dl>
      <h3>Instructions sent with this version</h3>
      {request?.comments.map((comment, i) => (
        <article key={comment.id}>
          <span>
            Comment {i + 1} ·{" "}
            {comment.regionIds
              .map(
                (id) =>
                  request.regions?.find((r) => r.id === id)?.label ||
                  editor.regions.find((r) => r.id === id)?.label ||
                  id,
              )
              .join(" + ")}
          </span>
          <p>{comment.text}</p>
        </article>
      ))}
      {request?.instructions && <p>{request.instructions}</p>}
      <AssetLineagePanel
        key={image.output}
        image={{ ...image, projectId: editor.projectId ?? image.projectId }}
      />
    </section>
  );
}
