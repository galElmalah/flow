import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Plus, Upload, X } from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { jsonRequest } from "../studio/ui.mjs";
import "./style-editor.css";

export function StyleEditor({ style, categories, onSaved, onClose }) {
  const referencesOnly = style && !style.custom;
  const [draft, setDraft] = useState({
    name: style?.name || "",
    category: style?.category || "Custom",
    description: style?.description || "",
    prompt: style?.prompt || "",
    scene: style?.scene || "",
    tags: style?.tags?.join(", ") || "",
  });
  const [references, setReferences] = useState(() =>
    structuredClone(style?.references || []),
  );
  const [newCategory, setNewCategory] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const panel = useRef(null),
    files = useRef(null),
    lock = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector("input,button")?.focus();
    return () => previous?.isConnected && previous.focus();
  }, []);
  const change = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const changeReference = (index, changes) =>
    setReferences((current) =>
      current.map((reference, i) =>
        i === index ? { ...reference, ...changes } : reference,
      ),
    );
  const upload = async (chosen) => {
    if (lock.current || !chosen.length) return;
    if (references.length + chosen.length > 16) {
      setError("Choose at most 16 reference images per style.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      for (const file of chosen) body.append("images", file);
      const assets = await jsonRequest("/api/uploads", {
        method: "POST",
        body,
      });
      setReferences((current) => [
        ...current,
        ...assets.map((asset) => ({
          url: asset.url,
          label: asset.name || "Uploaded reference",
          kind: "uploaded",
        })),
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      lock.current = false;
      setBusy(false);
      if (files.current) files.current.value = "";
    }
  };
  const save = async (event) => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const cleaned = references.map(({ source, ...reference }) => ({
        ...reference,
        label: reference.label.trim() || "Reference image",
        ...(source &&
          Object.values(source).some((value) => value?.trim()) && {
            source: { ...source, url: source.url?.trim() || undefined },
          }),
      }));
      const definition = {
        ...draft,
        prompt:
          draft.prompt.trim() ||
          "Use the reference images for visual style. Create a fresh composition for the requested subject.",
        tags: [
          ...new Set(
            draft.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ],
        references: cleaned,
      };
      const saved = await jsonRequest(
        style
          ? `/api/styles/${encodeURIComponent(style.id)}${referencesOnly ? "/references" : ""}`
          : "/api/styles",
        {
          method: style && !referencesOnly ? "PUT" : "POST",
          body: JSON.stringify(
            referencesOnly ? { references: cleaned } : definition,
          ),
        },
      );
      await onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const keyDown = (event) => {
    event.stopPropagation();
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      if (!lock.current) onClose();
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...panel.current.querySelectorAll(
        "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary,a[href]",
      ),
    ].filter((element) => element.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return createPortal(
    <div className="style-editor-overlay" onKeyDown={keyDown}>
      <form
        ref={panel}
        className="style-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-editor-title"
        onSubmit={save}
      >
        <header>
          <div>
            <h2 id="style-editor-title">
              {referencesOnly
                ? "Add reference images"
                : style
                  ? "Edit your style"
                  : "Add your own style"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close style editor"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </header>
        <div className="style-editor-scroll">
          {referencesOnly && <p className="style-editor-intro">{style.name}</p>}
          {!referencesOnly && (
            <>
              <label>
                Style name
                <input
                  aria-label="Style name"
                  value={draft.name}
                  onChange={(e) => change("name", e.target.value)}
                  maxLength={120}
                  required
                  disabled={busy}
                  placeholder="e.g. Quoture · midnight woodcuts"
                />
              </label>
              <div className="style-editor-category">
                <label>
                  Category
                  {newCategory ? (
                    <input
                      aria-label="New style category"
                      value={draft.category}
                      onChange={(e) => change("category", e.target.value)}
                      maxLength={120}
                      required
                      disabled={busy}
                      autoFocus
                    />
                  ) : (
                    <Autocomplete
                      label="Custom style category"
                      value={draft.category}
                      options={[
                        ...new Set(["Custom", ...categories, draft.category]),
                      ]
                        .filter(Boolean)
                        .map((value) => ({ value, label: value }))}
                      onChange={(value) => change("category", value)}
                      disabled={busy}
                    />
                  )}
                </label>
                <button
                  type="button"
                  className="style-secondary"
                  disabled={busy}
                  onClick={() => {
                    setNewCategory(!newCategory);
                    if (!newCategory) change("category", "");
                  }}
                >
                  {newCategory ? "Choose existing" : "New category"}
                </button>
              </div>
              <label>
                Description
                <textarea
                  aria-label="Style description"
                  value={draft.description}
                  onChange={(e) => change("description", e.target.value)}
                  maxLength={2000}
                  rows={2}
                  disabled={busy}
                  placeholder="What makes this direction distinct?"
                />
              </label>
              <label>
                Style prompt
                <textarea
                  aria-label="Custom style prompt"
                  value={draft.prompt}
                  onChange={(e) => change("prompt", e.target.value)}
                  maxLength={12000}
                  rows={3}
                  disabled={busy}
                  placeholder="Medium, texture, color, lighting, composition rules…"
                />
                <small>
                  Reusable visual direction. Leave blank to use the images as
                  style guidance.
                </small>
              </label>
              <label>
                Baseline scene prompt
                <textarea
                  aria-label="Custom scene prompt"
                  value={draft.scene}
                  onChange={(e) => change("scene", e.target.value)}
                  maxLength={16000}
                  rows={3}
                  disabled={busy}
                  placeholder="Subject, setting and composition to start from…"
                />
              </label>
              <label>
                Tags
                <input
                  aria-label="Style tags"
                  value={draft.tags}
                  onChange={(e) => change("tags", e.target.value)}
                  disabled={busy}
                  placeholder="woodcut, editorial, monochrome"
                />
                <small>Separate tags with commas.</small>
              </label>
            </>
          )}
          <div className="style-editor-reference-heading">
            <div>
              <h3>Reference images</h3>
              <small>{references.length}/16 · PNG, JPEG or WebP</small>
            </div>
            <button
              className="style-secondary"
              type="button"
              onClick={() => files.current.click()}
              disabled={busy || references.length >= 16}
            >
              <Upload size={14} /> Upload images
            </button>
          </div>
          <input
            ref={files}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            aria-label="Reference image files"
            onChange={(e) => upload([...e.target.files])}
          />
          {!references.length && (
            <p className="style-editor-empty">
              Add images from your device. Prompts can also be saved without
              images.
            </p>
          )}
          <div className="style-editor-references">
            {references.map((reference, index) => (
              <article key={`${reference.url}-${index}`}>
                <div className="style-editor-reference-row">
                  <img src={reference.url} alt={reference.label} />
                  <label>
                    Reference label
                    <input
                      aria-label={`Reference ${index + 1} label`}
                      value={reference.label}
                      maxLength={160}
                      onChange={(e) =>
                        changeReference(index, { label: e.target.value })
                      }
                      disabled={busy}
                    />
                  </label>
                  {!referencesOnly && (
                    <button
                      type="button"
                      aria-label={`Remove reference ${index + 1}`}
                      onClick={() =>
                        setReferences((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                      disabled={busy}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <details>
                  <summary>Scene, prompt & source</summary>
                  <label>
                    Scene for this image
                    <textarea
                      aria-label={`Reference ${index + 1} scene`}
                      value={reference.scene || ""}
                      rows={2}
                      maxLength={16000}
                      onChange={(e) =>
                        changeReference(index, { scene: e.target.value })
                      }
                      disabled={busy}
                      placeholder="Optional · overrides the baseline when this image is selected"
                    />
                  </label>
                  {reference.kind === "uploaded" && (
                    <label>
                      Reference prompt
                      <textarea
                        aria-label={`Reference ${index + 1} prompt`}
                        value={reference.prompt || ""}
                        rows={2}
                        maxLength={16000}
                        onChange={(e) =>
                          changeReference(index, { prompt: e.target.value })
                        }
                        disabled={busy}
                        placeholder="Optional · describe this image or record its original prompt"
                      />
                    </label>
                  )}
                  <label>
                    Source URL
                    <input
                      type="url"
                      aria-label={`Reference ${index + 1} source`}
                      value={reference.source?.url || ""}
                      onChange={(e) =>
                        changeReference(index, {
                          source: { ...reference.source, url: e.target.value },
                        })
                      }
                      disabled={busy}
                      placeholder="https://…"
                    />
                  </label>
                  <div className="style-editor-source-fields">
                    <label>
                      Creator
                      <input
                        aria-label={`Reference ${index + 1} creator`}
                        value={reference.source?.creator || ""}
                        maxLength={200}
                        onChange={(e) =>
                          changeReference(index, {
                            source: {
                              ...reference.source,
                              creator: e.target.value,
                            },
                          })
                        }
                        disabled={busy}
                      />
                    </label>
                    <label>
                      License / usage notes
                      <input
                        aria-label={`Reference ${index + 1} license`}
                        value={reference.source?.license || ""}
                        maxLength={200}
                        onChange={(e) =>
                          changeReference(index, {
                            source: {
                              ...reference.source,
                              license: e.target.value,
                            },
                          })
                        }
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <small>
                    {reference.kind === "generated"
                      ? "The recorded run keeps its original generation prompt and provenance."
                      : "Source information is optional and supplied by you."}
                  </small>
                </details>
              </article>
            ))}
          </div>
          {error && (
            <p className="style-action-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <span>Saved locally · no generation</span>
          <button
            type="button"
            className="style-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="style-primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={15} className="style-spin" />
            ) : (
              <Plus size={15} />
            )}{" "}
            {style ? "Save changes" : "Add to library"}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
