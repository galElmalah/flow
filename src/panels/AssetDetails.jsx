import React, { useEffect, useState } from "react";
import { Loader2, Download, ArrowUpRight } from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { PromptValue } from "./PromptValue.jsx";
import {
  assetLabel,
  assetScope as scopeParams,
} from "../../shared/asset-inspection.mjs";
import "./asset-details.css";

const request = async (url, options) => {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Could not save asset details.");
  return value;
};
const roleLabel = (role) => String(role || "ancestor").replaceAll("-", " ");
function Values({ values }) {
  return (
    <dl className="tray-record">
      {Object.entries(values)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
    </dl>
  );
}
function ParentAsset({ asset, relations, onInspect, byId }) {
  const provenance = asset.provenance || {};
  const role =
    [...new Set(relations.map((relation) => roleLabel(relation.role)))].join(
      " · ",
    ) || "Earlier ancestor";
  const content = (
    <>
      <span>
        {asset.kind === "image" ? <img src={asset.url} alt="" /> : asset.kind}
      </span>
      <div>
        <strong>{assetLabel(asset)}</strong>
        <small>{role}</small>
      </div>
      {asset.kind !== "text" && <ArrowUpRight size={13} />}
    </>
  );
  return (
    <article className="asset-parent-card">
      {asset.kind === "text" ? (
        <div className="asset-parent-heading">{content}</div>
      ) : (
        <button
          className="asset-parent-heading"
          onClick={() => onInspect(asset)}
          aria-label={`Inspect ${role} · ${assetLabel(asset)} lineage`}
        >
          {content}
        </button>
      )}
      {(provenance.prompt || asset.generation?.resultText) && (
        <details className="asset-parent-evidence">
          <summary>
            {asset.kind === "text"
              ? "Prompt generation & output"
              : "Prompt & generation settings"}
          </summary>
          <PromptValue
            title="Prompt that generated this input"
            value={provenance.prompt}
            open
          />
          <PromptValue
            title="Generated prompt text"
            value={asset.generation?.resultText || provenance.resultText}
            open
          />
          <PromptValue
            title="Harness instructions"
            value={asset.generation?.instructions || provenance.instructions}
          />
          <Values
            values={{
              Provider:
                asset.generation?.providerName ||
                provenance.requested?.providerId,
              Model: asset.generation?.model || provenance.requested?.model,
              Seed: provenance.requested?.seed,
              "Aspect ratio": provenance.requested?.ratio,
            }}
          />
        </details>
      )}
      {(asset.parents || []).length > 0 && (
        <details className="asset-parent-evidence">
          <summary>Connected sources · {asset.parents.length}</summary>
          <ul>
            {asset.parents.map((parent, i) => (
              <li key={i}>
                {roleLabel(parent.role)} ·{" "}
                {byId.get(parent.assetId)
                  ? assetLabel(byId.get(parent.assetId))
                  : "Unavailable source"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
export function AssetDetails({
  image,
  job = {},
  lineageState,
  onInspect,
  view = "lineage",
}) {
  const { lineage, loading, error: loadError } = lineageState;
  const [draft, setDraft] = useState(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    const annotations = lineage?.asset.annotations;
    setDraft(
      annotations
        ? {
            ...annotations,
            tagsText: (annotations.tags || []).join(", "),
            training: {
              allowed: false,
              rights: "unknown",
              notes: "",
              ...annotations.training,
            },
          }
        : null,
    );
    setError("");
  }, [lineage?.asset.id, lineage?.asset.annotations?.revision]);
  useEffect(() => setSaved(false), [lineage?.asset.id]);
  if (loading)
    return (
      <p className="tray-help" role="status">
        <Loader2 size={13} className="spin" /> Loading saved lineage…
      </p>
    );
  if (!lineage)
    return (
      <div className="tray-load-error" role="alert">
        {loadError}
        <button onClick={lineageState.reload}>Retry lineage</button>
      </div>
    );
  const asset = lineage.asset,
    provenance = asset.provenance || {},
    generation = asset.generation || {};
  const ancestors = lineage.ancestors || [],
    byId = new Map([asset, ...ancestors].map((item) => [item.id, item]));
  const directIds = new Set((asset.parents || []).map((edge) => edge.assetId));
  const directParents = [...directIds]
    .map((id) => byId.get(id))
    .filter(Boolean);
  const earlierAncestors = ancestors.filter(
    (ancestor) => !directIds.has(ancestor.id),
  );
  const relationsFor = (id) =>
    [asset, ...ancestors].flatMap((child) =>
      (child.parents || [])
        .filter((edge) => edge.assetId === id)
        .map((edge) => ({ ...edge, childId: child.id })),
    );
  const assetScope = asset.projectId ?? null;
  const dataset = new URLSearchParams({
    ...scopeParams(assetScope),
    ...(asset.origin?.runId ? { runId: asset.origin.runId } : {}),
    mode: "all",
  });
  const json = (value) => JSON.stringify(value, null, 2);
  if (view === "labels")
    return (
      <div className="asset-details">
        {draft && (
          <>
            <section className="tray-section">
              <h3>
                Annotations<span>Revision {draft.revision}</span>
              </h3>
              <form
                className="asset-annotation-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setSaving(true);
                  setError("");
                  setSaved(false);
                  try {
                    const result = await request(
                      `/api/assets/${asset.id}/annotations`,
                      {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          ...scopeParams(assetScope),
                          revision: draft.revision,
                          caption: draft.caption || "",
                          tags: draft.tagsText
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                          decision: draft.decision,
                          training: draft.training,
                        }),
                      },
                    );
                    lineageState.updateAsset(result);
                    setDraft({
                      ...result.annotations,
                      tagsText: (result.annotations.tags || []).join(", "),
                      training: result.annotations.training,
                    });
                    setSaved(true);
                  } catch (error) {
                    setError(error.message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <label>
                  Caption
                  <textarea
                    aria-label="Asset caption"
                    rows="3"
                    value={draft.caption || ""}
                    onChange={(event) =>
                      setDraft({ ...draft, caption: event.target.value })
                    }
                    placeholder="Describe this output for future reuse…"
                  />
                </label>
                <label>
                  Tags
                  <input
                    aria-label="Asset tags"
                    value={draft.tagsText}
                    onChange={(event) =>
                      setDraft({ ...draft, tagsText: event.target.value })
                    }
                    placeholder="athlete, monochrome, cycling"
                  />
                </label>
                <label>
                  Review
                  <Autocomplete
                    label="Asset review decision"
                    value={draft.decision}
                    options={[
                      { value: "unreviewed", label: "Unreviewed" },
                      { value: "accepted", label: "Accepted" },
                      { value: "rejected", label: "Rejected" },
                    ]}
                    onChange={(decision) => setDraft({ ...draft, decision })}
                  />
                </label>
                <label>
                  Rights
                  <Autocomplete
                    label="Asset training rights"
                    value={draft.training.rights}
                    options={[
                      { value: "unknown", label: "Unknown" },
                      { value: "confirmed", label: "Confirmed" },
                      { value: "restricted", label: "Restricted" },
                    ]}
                    onChange={(rights) =>
                      setDraft({
                        ...draft,
                        training: { ...draft.training, rights },
                      })
                    }
                  />
                </label>
                <label className="asset-training-check">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.training.allowed)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        training: {
                          ...draft.training,
                          allowed: event.target.checked,
                        },
                      })
                    }
                  />
                  Allow this asset in training exports
                </label>
                <label>
                  Review & rights notes
                  <textarea
                    aria-label="Asset training notes"
                    rows="2"
                    value={draft.training.notes || ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        training: {
                          ...draft.training,
                          notes: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <p className="tray-help">
                  Training exports require Accepted, rights Confirmed, and
                  explicit permission. Labels remain separate from the original
                  generation.
                </p>
                {error && (
                  <p role="alert" className="tray-load-error">
                    {error}
                  </p>
                )}
                {saved && (
                  <p role="status" className="tray-help">
                    Annotations saved.
                  </p>
                )}
                <button
                  className="primary-button"
                  disabled={saving}
                  type="submit"
                >
                  {saving ? "Saving…" : "Save annotations"}
                </button>
              </form>
            </section>
            <a
              className="secondary-button"
              href={`/api/assets/dataset?${dataset}`}
              download
            >
              <Download size={14} />
              {asset.origin?.runId || image.runId
                ? "Export this run’s asset records · JSONL"
                : "Export this project’s asset records · JSONL"}
            </a>
          </>
        )}
      </div>
    );
  return (
    <div className="asset-details" role="tabpanel" aria-label="Image lineage">
      <section className="tray-section asset-generation-summary">
        <h3>
          {generation.nodeLabel ||
            asset.displayName ||
            image.label ||
            assetLabel(asset)}
          <span>
            {asset.origin?.type === "upload"
              ? "Uploaded source"
              : asset.origin?.type === "job-input"
                ? "Captured input"
                : provenance.completeness === "captured"
                  ? "Saved generation"
                  : "Historical evidence"}
          </span>
        </h3>
        <Values
          values={{
            Source: asset.origin?.originalName,
            Project: asset.projectId || "Unassigned",
            Workflow: generation.workflowName || asset.origin?.workflowId,
            Provider:
              generation.providerName || provenance.requested?.providerId,
            Model:
              generation.model ||
              provenance.effective?.model ||
              provenance.requested?.model,
            "Seed / variation label": provenance.requested?.seed,
            "Aspect ratio": provenance.requested?.ratio,
            Mode: provenance.mode?.label || job.mode?.label,
          }}
        />
      </section>
      <section className="tray-section">
        <h3>Prompt that generated this image</h3>
        {provenance.prompt ? (
          <PromptValue
            key={asset.id}
            title="Final resolved prompt"
            value={provenance.prompt}
            open
          />
        ) : (
          <p className="tray-help">
            {asset.origin?.type === "upload"
              ? "Uploaded reference. No generation prompt was recorded."
              : asset.origin?.type === "job-input"
                ? "This is a captured copy of an input. Follow its connected source below for the original generation."
                : "No generation prompt was recorded for this source."}
          </p>
        )}
        <PromptValue
          title="Harness instructions"
          value={generation.instructions || provenance.instructions}
        />
        <PromptValue
          title="Generated prompt text"
          value={generation.resultText || provenance.resultText}
          open
        />
      </section>
      {(provenance.edit?.requestSnapshot?.comments || provenance.edit?.comments)
        ?.length > 0 && (
        <section className="tray-section">
          <h3>Edit comments</h3>
          {(
            provenance.edit.requestSnapshot?.comments ||
            provenance.edit.comments
          ).map((comment) => (
            <blockquote className="tray-quote" key={comment.id}>
              {comment.text}
            </blockquote>
          ))}
        </section>
      )}
      {provenance.records?.length > 0 && (
        <section className="tray-section">
          <h3>
            Source records<span>{provenance.records.length} records</span>
          </h3>
          {provenance.records.map((record, index) => (
            <details
              className="tray-prompt"
              key={`${record.nodeId}-${record.id}-${index}`}
            >
              <summary>
                {record.fields?.title || record.fields?.author || record.id}
              </summary>
              <Values values={{ "Record ID": record.id, ...record.fields }} />
            </details>
          ))}
        </section>
      )}
      <section className="tray-section">
        <h3>
          Source chain<span>{directIds.size} direct inputs</span>
        </h3>
        {directParents.length ? (
          <div className="asset-parent-list">
            {directParents.map((parent) => (
              <ParentAsset
                key={parent.id}
                asset={parent}
                byId={byId}
                relations={relationsFor(parent.id).filter(
                  (relation) => relation.childId === asset.id,
                )}
                onInspect={onInspect}
              />
            ))}
          </div>
        ) : (
          <p className="tray-help">
            {asset.origin?.type === "upload"
              ? "This uploaded file is the original source."
              : "No input assets were recorded."}
          </p>
        )}
        {earlierAncestors.length > 0 && (
          <details className="asset-earlier-ancestors" open>
            <summary>Earlier sources · {earlierAncestors.length}</summary>
            <div className="asset-parent-list">
              {earlierAncestors.map((parent) => (
                <ParentAsset
                  key={parent.id}
                  asset={parent}
                  byId={byId}
                  relations={relationsFor(parent.id)}
                  onInspect={onInspect}
                />
              ))}
            </div>
          </details>
        )}
        {lineage.missing?.length > 0 && (
          <details className="tray-prompt">
            <summary>Unavailable sources · {lineage.missing.length}</summary>
            <ul className="tray-help">
              {lineage.missing.map((source, index) => (
                <li key={index}>
                  {roleLabel(source.role)} · {source.reason}
                  {source.url && <code>{source.url}</code>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {provenance.sources?.length > 0 && (
        <section className="tray-section">
          <h3>Shared direction & templates</h3>
          {provenance.sources.map((source) => (
            <PromptValue
              key={source.nodeId}
              title={source.label || source.nodeId}
              value={source.text || source.lines}
            />
          ))}
        </section>
      )}
      <PromptValue
        title="Edit instructions"
        value={
          provenance.edit?.requestSnapshot?.instructions ||
          provenance.edit?.instructions
        }
      />
      {[
        ["Requested settings", provenance.requested],
        ["Prompt Set snapshot", provenance.promptSet],
        ["Provider-reported values", provenance.effective],
        ["Image edit origin", provenance.edit],
      ]
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <details className="tray-prompt" key={label}>
            <summary>{label}</summary>
            <pre>{json(value)}</pre>
          </details>
        ))}
      <details className="tray-prompt">
        <summary>Asset identity & saved evidence</summary>
        <Values
          values={{
            "Asset ID": asset.id,
            "Source file": asset.url,
            Run: asset.origin?.runId,
            "Job ID": asset.origin?.jobId,
            "SHA-256": asset.fingerprint?.sha256,
            "Fingerprint evidence": asset.fingerprint?.evidence,
            "Observed at": asset.fingerprint?.observedAt,
          }}
        />
        {provenance.completeness !== "captured" && (
          <p className="tray-help">
            Historical evidence is partial. Original input bytes and unreported
            settings cannot be reconstructed.
          </p>
        )}
      </details>
    </div>
  );
}
