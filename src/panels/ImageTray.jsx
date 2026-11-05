import { PromptValue } from "./PromptValue.jsx";
import { AssetDetails } from "./AssetDetails.jsx";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import React, { useContext, useEffect, useRef, useState } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Loader2,
  Scan,
  Maximize2,
} from "lucide-react";
import {
  describeField,
  inspectGeneration,
  recordFields,
  recordIdentity,
  recordTitle,
} from "../../shared/inspection.mjs";
import { StudioContext } from "../studio/context.jsx";
import { ImageLightbox } from "../media/ImageLightbox.jsx";
import { MediaPreview } from "../media/MediaPreview.jsx";
import { mediaKind, editableImage } from "../../shared/media.mjs";
import { rulesText } from "../../shared/rule-templates.mjs";
import { useAssetLineage } from "../media/useAssetLineage.mjs";
import { assetImage, assetLabel } from "../../shared/asset-inspection.mjs";

function References({ references, loading = false, onInspect }) {
  return (
    <div className="tray-references">
      {references.map((ref, i) => (
        <figure key={`${ref.url || ref.jobId}-${i}`}>
          {ref.url ? (
            <button
              type="button"
              className="tray-reference-button"
              onClick={() => onInspect(ref)}
              aria-label={`Inspect ${ref.label} ${i + 1} lineage`}
            >
              <img src={ref.url} alt={`${ref.label} ${i + 1}`} />
            </button>
          ) : (
            <span className="tray-unavailable">
              {loading ? "Loading image…" : "Image unavailable"}
            </span>
          )}
          <figcaption>
            {ref.label} · {i + 1}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function ImageTray({
  image,
  onClose,
  onSelect,
  onUseSeed,
  onEdit,
  providerName,
}) {
  const { readOnly } = useContext(StudioContext);
  const lineageState = useAssetLineage(image);
  const asset = lineageState.lineage?.asset;
  const origin = asset?.origin?.type === "job" ? asset.origin : null;
  const runId = image.runId || origin?.runId;
  const inspecting = {
    ...image,
    id: origin?.jobId || image.id,
    prompt: asset?.provenance?.prompt ?? image.prompt,
  };
  const video = mediaKind(image) === "video";
  const raster = editableImage(image);
  const extension =
    image.output?.match(/\.([a-z]+)$/i)?.[1] || (video ? "mp4" : "png");
  const medium = video ? "Video" : "Image";
  const cache = useRef(new Map());
  const [snapshot, setSnapshot] = useState(null),
    [retry, setRetry] = useState(0);
  const [tab, setTab] = useState("lineage");
  const [trail, setTrail] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const preview = useRef(null);
  const body = useRef(null);
  const lineageTab = useRef(null);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [image.output, image.assetId]);
  useEffect(() => {
    if (!runId) {
      setSnapshot(null);
      return;
    }
    const id = runId;
    if (cache.current.has(id)) {
      setSnapshot({ id, run: cache.current.get(id) });
      return;
    }
    const controller = new AbortController();
    setSnapshot({ id, loading: true });
    fetch(`/api/runs/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        const run = await response.json();
        if (!response.ok)
          throw new Error(run.error || "Could not load the saved run.");
        if (!controller.signal.aborted) {
          cache.current.set(id, run);
          setSnapshot({ id, run });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setSnapshot({ id, error: error.message });
      });
    return () => controller.abort();
  }, [runId, retry]);
  const current = snapshot?.id === runId ? snapshot : null;
  const inspection = inspectGeneration(inspecting, current?.run);
  const job = inspection.job,
    fields = recordFields(job),
    collection = image.collection || [];
  const matchedIndex = collection.findIndex((item) => item.id === image.id);
  const index =
    matchedIndex < 0
      ? collection.findIndex((item) => item.output === image.output)
      : matchedIndex;
  const title =
    recordTitle(job) ||
    image.label ||
    (asset && assetLabel(asset)) ||
    (job.seed !== undefined ? `Variation #${job.seed}` : "Seed reference");
  const select = (item) => {
    if (item) {
      setTrail([]);
      onSelect({ projectId: image.projectId, ...item, collection });
    }
  };
  const inspectSource = (source) => {
    setTrail((items) => [...items, image]);
    setExpanded(false);
    setTab("lineage");
    onSelect(source);
  };
  const inspectAsset = (parent) => inspectSource(assetImage(parent));
  const inspectReference = (ref) =>
    inspectSource({
      output: ref.url,
      projectId: image.projectId,
      ...(ref.jobId && { id: ref.jobId, runId }),
      label: ref.label,
    });
  return (
    <aside
      className={`image-tray ${tab === "lineage" ? "is-lineage" : ""}`}
      aria-label={`${medium} inspector`}
    >
      <header className="image-tray-header">
        <div>
          <span className="eyebrow">{medium} inspector</span>
          <h2>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label={`Close ${medium.toLowerCase()}`}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="image-tray-body" ref={body}>
        {trail.length > 0 && (
          <button
            className="tray-lineage-back"
            onClick={() => {
              onSelect(trail.at(-1));
              setTrail((items) => items.slice(0, -1));
            }}
          >
            <ChevronLeft size={14} />
            Back to previous image
          </button>
        )}
        {video ? (
          <div className="tray-preview">
            <MediaPreview item={image} alt={fields.scene || title} controls />
          </div>
        ) : (
          <button
            type="button"
            ref={preview}
            className="tray-preview tray-preview-open"
            aria-label={`Open ${title} full size`}
            title="Open full-size image"
            onClick={() => setExpanded(true)}
          >
            <MediaPreview item={image} alt={fields.scene || title} />
            <span className="tray-preview-expand">
              <Maximize2 size={14} /> View full size
            </span>
          </button>
        )}
        {expanded && !video && (
          <ImageLightbox
            key={image.output}
            image={image}
            title={title}
            collection={collection.filter(
              (item) => mediaKind(item) === "image",
            )}
            onSelect={select}
            onClose={() => {
              setExpanded(false);
              requestAnimationFrame(() => preview.current?.focus());
            }}
            onInspect={() => {
              setExpanded(false);
              setTab("lineage");
              requestAnimationFrame(() => lineageTab.current?.focus());
            }}
          />
        )}
        {raster && onEdit && (
          <button className="tray-edit-regions" onClick={() => onEdit(image)}>
            <Scan size={16} /> Edit image regions
          </button>
        )}
        {!video && (image.edit || job.edit) && onEdit && (
          <button
            className="tray-edit-origin"
            onClick={() => {
              const edit = image.edit || job.edit;
              onEdit({
                editorId: edit.editorId,
                output: edit.source,
                projectId: image.projectId,
              });
            }}
          >
            <img
              src={(image.edit || job.edit).source}
              alt="Original before this variation"
            />
            <span>
              Variation of original<small>Open original & edit comments</small>
            </span>
            <ChevronRight size={15} />
          </button>
        )}
        {job.mode && tab !== "lineage" && (
          <div className="tray-summary mode-badge">
            <HarnessLogo id={job.providerId} size={15} />
            <span>
              {job.mode.label} ·{" "}
              {job.metadata?.actualModel ||
                job.metadata?.model ||
                job.model ||
                "Default"}{" "}
              · copy {(job.comparison?.copyIndex ?? 0) + 1}
            </span>
          </div>
        )}
        {job.ratio && tab !== "lineage" && (
          <div className="tray-summary">
            <span>
              {job.metadata?.providerName || providerName(job.providerId)}
            </span>
            <span>{job.ratio}</span>
            <span>#{job.seed}</span>
          </div>
        )}
        {collection.length > 1 && (
          <details className="tray-collection-browser" open={tab !== "lineage"}>
            <summary>
              Collection · {index + 1} of {collection.length} images
            </summary>
            <div className="tray-navigation" aria-label="Output navigation">
              <button
                aria-label="Previous output"
                disabled={index <= 0}
                onClick={() => select(collection[index - 1])}
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <span aria-live="polite">
                {index + 1} / {collection.length}
              </span>
              <button
                aria-label="Next output"
                disabled={index >= collection.length - 1}
                onClick={() => select(collection[index + 1])}
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="tray-filmstrip" aria-label="Collection outputs">
              {collection.map((item, i) => (
                <button
                  key={item.id || item.output}
                  aria-label={`Inspect ${recordTitle(item) || `variation ${item.seed}`} output`}
                  aria-pressed={item.id === image.id}
                  onClick={() => select(item)}
                  title={recordTitle(item) || `Variation ${item.seed}`}
                >
                  <MediaPreview item={item} alt="" />
                  <span>{String(i + 1).padStart(2, "0")}</span>
                </button>
              ))}
            </div>
          </details>
        )}
        <div
          className="tray-tabs"
          role="tablist"
          aria-label={`${medium} details`}
        >
          <button
            ref={lineageTab}
            role="tab"
            aria-selected={tab === "lineage"}
            onClick={() => setTab("lineage")}
          >
            Lineage
          </button>
          <button
            role="tab"
            aria-selected={tab === "inputs"}
            onClick={() => setTab("inputs")}
          >
            Inputs
          </button>
          <button
            role="tab"
            aria-selected={tab === "output"}
            onClick={() => setTab("output")}
          >
            Output
          </button>
          <button
            role="tab"
            aria-selected={tab === "labels"}
            onClick={() => setTab("labels")}
          >
            Labels
          </button>
        </div>
        {tab === "lineage" || tab === "labels" ? (
          <AssetDetails
            image={image}
            job={job}
            lineageState={lineageState}
            onInspect={inspectAsset}
            view={tab}
          />
        ) : tab === "inputs" ? (
          <div role="tabpanel" aria-label={`${medium} inputs`}>
            <p className="tray-help">
              The values and references saved with this output's generation.
            </p>
            {job.promptSet && (
              <section className="tray-section">
                <h3>
                  Prompt Set scene<span>{job.promptSet.label}</span>
                </h3>
                <code>
                  {job.promptSet.nodeId} / {job.promptSet.itemId}
                </code>
              </section>
            )}
            {fields.quote && (
              <blockquote className="tray-quote">{fields.quote}</blockquote>
            )}
            {current?.loading && (
              <p className="tray-loading" role="status">
                <Loader2 size={13} className="spin" />
                Loading saved inputs…
              </p>
            )}
            {current?.error && (
              <div className="tray-load-error" role="alert">
                {current.error}
                <button onClick={() => setRetry((n) => n + 1)}>
                  Retry loading inputs
                </button>
              </div>
            )}
            {inspection.records.map((record) => (
              <section
                className="tray-section"
                key={`${record.nodeId}-${record.id}`}
              >
                <h3>
                  Source record<span>{record.label}</span>
                </h3>
                <details className="tray-record-details">
                  <summary>
                    {record.id}
                    <small>{Object.keys(record.fields).length} fields</small>
                  </summary>
                  <dl className="tray-record">
                    <div>
                      <dt>Record ID</dt>
                      <dd>
                        <code>{record.id}</code>
                      </dd>
                    </div>
                    {Object.entries(record.fields).map(([key, value]) => (
                      <div key={key}>
                        <dt title={describeField(key)}>{key}</dt>
                        <dd>{value || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </section>
            ))}
            {job.rules?.length > 0 && (
              <section className="tray-section">
                <h3>
                  Applied rules<span>{job.rules.length} enabled</span>
                </h3>
                <PromptValue
                  title="Generation rule instructions"
                  value={rulesText(job.rules)}
                  open
                />
              </section>
            )}
            <section className="tray-section">
              <h3>
                Reference images
                <span>{inspection.references.length} inputs</span>
              </h3>
              {inspection.references.length ? (
                <References
                  references={inspection.references}
                  loading={current?.loading}
                  onInspect={inspectReference}
                />
              ) : (
                <p className="tray-help">No reference images were supplied.</p>
              )}
            </section>
            {inspection.stages.map((stage, i) => (
              <section className="tray-section" key={stage.id}>
                <h3>
                  Upstream {stage.kind === "image" ? "image" : "prompt"}
                  <span>{stage.label || stage.id}</span>
                </h3>
                {stage.missing ? (
                  <p className="tray-help">
                    This input job is unavailable in the saved run.
                  </p>
                ) : (
                  <>
                    <div className="tray-stage-provider">
                      {providerName(stage.providerId)} ·{" "}
                      {stage.metadata?.model || stage.model || "default"}
                    </div>
                    <PromptValue
                      title={`Generated brief${inspection.stages.length > 1 ? ` ${i + 1}` : ""}`}
                      value={stage.resultText}
                      open
                    />
                    {stage.output && (
                      <button
                        className="tray-reference-button"
                        onClick={() =>
                          inspectReference({
                            url: stage.output,
                            jobId: stage.id,
                            label: stage.label,
                          })
                        }
                        aria-label={`Inspect ${stage.label || "upstream image"} lineage`}
                      >
                        <img
                          className="tray-upstream-image"
                          src={stage.output}
                          alt={stage.label || "Upstream image"}
                        />
                      </button>
                    )}
                    <PromptValue
                      title="Harness input prompt"
                      value={stage.prompt}
                    />
                    <PromptValue
                      title="Harness instructions"
                      value={stage.instructions}
                    />
                    {stage.references.length > 0 && (
                      <details className="tray-prompt">
                        <summary>
                          Harness reference images · {stage.references.length}
                        </summary>
                        <References
                          references={stage.references}
                          onInspect={inspectReference}
                        />
                      </details>
                    )}
                  </>
                )}
              </section>
            ))}
            {inspection.sources.length > 0 && (
              <section className="tray-section">
                <h3>
                  Source prompts & templates<span>Saved workflow</span>
                </h3>
                {inspection.sources.map((node) => (
                  <PromptValue
                    key={node.id}
                    title={node.data.label}
                    value={node.data.text || node.data.lines}
                  />
                ))}
              </section>
            )}
            <section className="tray-section">
              <h3>{medium} prompt</h3>
              <PromptValue
                title="Final resolved prompt"
                value={job.prompt}
                open
              />
            </section>
            {!runId && (
              <p className="tray-help">
                This reference has no generation run attached.
              </p>
            )}
          </div>
        ) : (
          <div role="tabpanel" aria-label={`${medium} output`}>
            <dl className="tray-record tray-output-values">
              {Object.entries({
                "Record / asset ID": recordIdentity(job),
                Provider:
                  job.metadata?.providerName ||
                  (job.providerId ? providerName(job.providerId) : undefined),
                Model: job.metadata?.model || job.model,
                Dimensions: job.metadata?.width
                  ? `${job.metadata.width} × ${job.metadata.height}`
                  : undefined,
                "Aspect ratio": job.ratio,
                Quality: job.quality,
                Resolution: job.video?.resolution,
                "Duration (seconds)": job.metadata?.durationSeconds,
                "Provider operation": job.providerOperation?.id,
                "Asset ID": job.assetId,
                Mode: job.mode?.label,
                Copy:
                  job.comparison?.copyIndex === undefined
                    ? undefined
                    : job.comparison.copyIndex + 1,
                [job.metadata?.seedMode === "deterministic"
                  ? "Seed"
                  : "Variation label"]: job.seed,
                "Job ID": job.id,
                "Run ID": runId,
              })
                .filter(([, value]) => value !== undefined)
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}
        <div className="tray-actions">
          <a
            className="primary-button"
            href={image.output}
            download={`${recordIdentity(job) || `flow-${job.seed ?? "reference"}`}.${extension}`}
          >
            <Download size={14} />
            Download {medium.toLowerCase()}
          </a>
          {raster && (
            <button
              className="secondary-button"
              disabled={readOnly}
              title={
                readOnly ? "Fork this recorded run to add a seed" : undefined
              }
              onClick={() => onUseSeed(image)}
            >
              <Plus size={14} />
              Use as a seed
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
