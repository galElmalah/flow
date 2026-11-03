import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Heart,
  Image,
  LoaderCircle,
  Plus,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { jsonRequest } from "../studio/ui.mjs";
import {
  interleaveStyles,
  referencePresentation,
  styleCategories,
} from "./style-gallery-state.mjs";
import { useStyleSearch } from "./useStyleSearch.mjs";
import { ReferenceSources } from "./ReferenceSources.jsx";
import { StyleEditor } from "./StyleEditor.jsx";
import "./style-gallery.css";

function ReferenceImage({
  reference,
  name,
  status,
  eager = false,
  className = "",
}) {
  const [failed, setFailed] = useState(false);
  const presentation = referencePresentation(status);
  useEffect(() => setFailed(false), [reference?.url]);
  if (!reference?.url || failed)
    return (
      <div className={`style-reference-empty ${className}`}>
        {presentation.active && !failed ? (
          <LoaderCircle size={24} className="style-spin" />
        ) : (
          <Image size={24} />
        )}
        <span>{failed ? "Reference unavailable" : presentation.label}</span>
        <small>
          {failed
            ? "The saved image could not be loaded."
            : presentation.detail}
        </small>
      </div>
    );
  return (
    <img
      className={className}
      src={reference.url}
      alt={`${name} reference`}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function StyleGallery({
  project,
  onStart,
  onApply,
  readOnly = false,
  onClose,
  backLabel = "Back to canvas",
  onAgentContext,
  onOpenImage,
}) {
  const [catalog, setCatalog] = useState({
    styles: [],
    categories: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [favorites, setFavorites] = useState(false);
  const [selectedId, setSelectedId] = useState(null),
    [referenceIndex, setReferenceIndex] = useState(0),
    [subject, setSubject] = useState("");
  const [subjectEdited, setSubjectEdited] = useState(false);
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [message, setMessage] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState(new Set());
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState(null);
  const favoriteLocks = useRef(new Set()),
    actionLock = useRef(false),
    live = useRef(true),
    requestSerial = useRef(0),
    detailElement = useRef(null),
    returnFocus = useRef(null);
  const refresh = async ({ quiet = false } = {}) => {
    const serial = ++requestSerial.current;
    if (!quiet) setRefreshing(true);
    try {
      const result = await jsonRequest("/api/styles");
      if (!live.current || serial !== requestSerial.current) return;
      setCatalog(result);
      setError("");
      setRevision((value) => value + 1);
    } catch (err) {
      if (live.current && serial === requestSerial.current)
        setError(err.message);
    } finally {
      if (live.current && serial === requestSerial.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };
  useEffect(() => {
    live.current = true;
    refresh();
    return () => {
      live.current = false;
      requestSerial.current++;
    };
  }, []);
  const missingReferences = catalog.styles.filter(
    (style) => !style.references?.length,
  ).length;
  const activeReferences = catalog.styles.filter(
    (style) =>
      !style.references?.length &&
      ["running", "retrying"].includes(style.referenceStatus),
  ).length;
  const queuedReferences = catalog.styles.filter(
    (style) =>
      !style.references?.length &&
      ["pending", "queued"].includes(style.referenceStatus),
  ).length;
  useEffect(() => {
    if (loading || !missingReferences) return;
    const timer = setInterval(() => refresh({ quiet: true }), 10000);
    return () => clearInterval(timer);
  }, [loading, missingReferences]);
  const categories = useMemo(
    () => styleCategories(catalog.styles, catalog.categories),
    [catalog],
  );
  const search = useStyleSearch({ query, category, favorites, revision });
  const browsable = useMemo(
    () => interleaveStyles(catalog.styles),
    [catalog.styles],
  );
  const visible = search.active ? search.styles : browsable;
  const selected = catalog.styles.find((style) => style.id === selectedId);
  useEffect(() => {
    onAgentContext?.(
      selected ? { styleId: selected.id, name: selected.name } : null,
    );
  }, [selected?.id, onAgentContext]);
  useEffect(() => () => onAgentContext?.(null), [onAgentContext]);
  const selectedReference =
    selected?.references?.[referenceIndex] || selected?.references?.[0];
  const selectedReferencePrompt = selectedReference
    ? selected?.referencePrompts?.[selectedReference.url]
    : selected?.referencePrompt;
  const baselineScene =
    selected?.referenceScenes?.[selectedReference?.url] ||
    selected?.scene ||
    "";
  useEffect(() => {
    if (!subjectEdited) setSubject(baselineScene);
  }, [baselineScene, selectedId, subjectEdited]);
  const closeDetail = () => {
    if (!actionLock.current) {
      setSelectedId(null);
      setActionError("");
      setMessage("");
      returnFocus.current?.isConnected && returnFocus.current.focus();
    }
  };
  useEffect(() => {
    const escape = (event) => {
      if (event.target.closest?.(".agent-dock")) return;
      if (editor) return;
      if (
        event.key === "Tab" &&
        selectedId &&
        window.matchMedia("(max-width: 760px)").matches
      ) {
        const controls = [
          ...detailElement.current.querySelectorAll(
            'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
          ),
        ].filter((element) => element.getClientRects().length);
        if (!controls.length) return;
        const first = controls[0],
          last = controls[controls.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !detailElement.current.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !detailElement.current.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        actionLock.current
      )
        return;
      if (selectedId) {
        event.preventDefault();
        closeDetail();
      } else onClose?.();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selectedId, onClose, editor]);
  useEffect(() => {
    if (selectedId)
      detailElement.current
        ?.querySelector('button[aria-label="Close style details"]')
        ?.focus();
  }, [selectedId]);
  const openStyle = (style) => {
    if (actionLock.current) return;
    returnFocus.current = document.activeElement;
    setSelectedId(style.id);
    setReferenceIndex(0);
    setSubjectEdited(false);
    setSubject(
      style.referenceScenes?.[style.references?.[0]?.url] || style.scene || "",
    );
    setActionError("");
    setMessage("");
  };
  const favorite = async (style) => {
    if (favoriteLocks.current.has(style.id)) return;
    favoriteLocks.current.add(style.id);
    setFavoriteBusy(new Set(favoriteLocks.current));
    try {
      await jsonRequest(
        `/api/styles/${encodeURIComponent(style.id)}/favorite`,
        { method: "PUT", body: JSON.stringify({ favorite: !style.favorite }) },
      );
      if (live.current) {
        setCatalog((value) => ({
          ...value,
          styles: value.styles.map((item) =>
            item.id === style.id
              ? { ...item, favorite: !style.favorite }
              : item,
          ),
        }));
        setRevision((value) => value + 1);
      }
    } catch (err) {
      if (live.current) setError(err.message);
    } finally {
      favoriteLocks.current.delete(style.id);
      if (live.current) setFavoriteBusy(new Set(favoriteLocks.current));
    }
  };
  const runAction = async (kind) => {
    if (!selected || actionLock.current) return;
    if (kind === "apply" && (readOnly || !onApply)) return;
    actionLock.current = true;
    setBusy(true);
    setActionError("");
    setMessage("");
    try {
      if (kind === "start")
        await onStart(selected, {
          subject: subject.trim(),
          referenceUrl: selectedReference?.url,
        });
      else {
        await onApply(selected);
        if (live.current)
          setMessage("Style direction added to the selected prompt.");
      }
    } catch (err) {
      if (live.current)
        setActionError(
          err.message || "Could not complete this action. Try again.",
        );
    } finally {
      actionLock.current = false;
      if (live.current) setBusy(false);
    }
  };
  const resetFilters = () => {
    setQuery("");
    setCategory("all");
    setFavorites(false);
  };
  return (
    <section
      className={`style-gallery ${selected ? "has-style-detail" : ""}`}
      aria-label="Style library"
    >
      <div className="style-library-main">
        <header className="style-library-header">
          <button
            className="style-back"
            onClick={onClose}
            aria-label={backLabel}
          >
            <ArrowLeft size={17} />
          </button>
          <h1>Styles</h1>
          <button
            className="style-add-entry"
            onClick={() => setEditor({ style: null })}
            disabled={busy}
          >
            <Plus size={15} /> Add your own
          </button>
          <button
            className="style-refresh"
            onClick={() => refresh()}
            disabled={refreshing}
            aria-label="Refresh style library"
          >
            <RefreshCw size={15} className={refreshing ? "style-spin" : ""} />
          </button>
        </header>
        <div className="style-filter-bar">
          <label className="style-search">
            <Search size={17} />
            <input
              type="search"
              aria-label="Search styles"
              placeholder="Search styles, moods, materials…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                aria-label="Clear style search"
                onClick={() => setQuery("")}
              >
                <X size={13} />
              </button>
            )}
          </label>
          <Autocomplete
            label="Style category"
            value={category}
            options={[
              { value: "all", label: "All categories" },
              ...categories.map((name) => ({ value: name, label: name })),
            ]}
            onChange={setCategory}
          />
          <button
            className={`style-favorites-filter ${favorites ? "is-active" : ""}`}
            aria-pressed={favorites}
            onClick={() => setFavorites((value) => !value)}
          >
            <Heart size={15} fill={favorites ? "currentColor" : "none"} />
            <span>Favorites</span>
          </button>
        </div>
        <div className="style-results-heading">
          <span className="style-result-count">
            {loading
              ? "Opening the local library…"
              : search.loading
                ? "Finding styles…"
                : `${visible.length} ${visible.length === 1 ? "style" : "styles"}${query || category !== "all" || favorites ? ` of ${catalog.total || catalog.styles.length}` : ""}`}
            {!loading && !query.trim() && (
              <small className="style-compact-progress">
                {catalog.styles.length - missingReferences}/
                {catalog.styles.length} references ready
                {activeReferences ? ` · ${activeReferences} generating` : ""}
              </small>
            )}
          </span>
          <span>
            {search.mode === "semantic" && query.trim()
              ? "Semantic matches"
              : missingReferences > 0
                ? `${catalog.styles.length - missingReferences}/${catalog.styles.length} ready${activeReferences ? ` · ${activeReferences} generating` : queuedReferences ? ` · ${queuedReferences} queued` : " · updates automatically"}`
                : ""}
          </span>
        </div>
        <ReferenceSources sources={catalog.sourceCollections} />
        {(error || search.error) && (
          <div className="style-error" role="alert">
            <span>{error || search.error}</span>
            <button onClick={() => refresh()} disabled={refreshing}>
              Retry
            </button>
          </div>
        )}
        {loading || (search.loading && !visible.length) ? (
          <div className="style-library-empty" role="status">
            <LoaderCircle className="style-spin" size={24} />
            <h2>{loading ? "Loading styles…" : "Searching styles…"}</h2>
          </div>
        ) : visible.length ? (
          <div className="style-card-grid">
            {visible.map((style, index) => (
              <article
                key={style.id}
                className={`style-card ${selectedId === style.id ? "is-selected" : ""}`}
              >
                <button
                  className="style-card-open"
                  onClick={() => openStyle(style)}
                  aria-label={`Explore ${style.name}`}
                  disabled={busy}
                >
                  <div className="style-card-image">
                    <ReferenceImage
                      reference={style.references?.[0]}
                      name={style.name}
                      status={style.referenceStatus}
                      eager={index < 6}
                    />
                  </div>
                  <div className="style-card-caption">
                    <h2>{style.name}</h2>
                  </div>
                </button>
                <button
                  className={`style-favorite ${style.favorite ? "is-active" : ""}`}
                  aria-label={`${style.favorite ? "Unfavorite" : "Favorite"} ${style.name}`}
                  aria-pressed={Boolean(style.favorite)}
                  onClick={() => favorite(style)}
                  disabled={favoriteBusy.has(style.id)}
                >
                  <Heart
                    size={15}
                    fill={style.favorite ? "currentColor" : "none"}
                  />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="style-library-empty">
            <Search size={26} />
            <h2>
              {favorites ? "No saved styles here yet" : "No matching styles"}
            </h2>
            <button className="style-secondary" onClick={resetFilters}>
              Show all styles
            </button>
          </div>
        )}
      </div>
      {selected && (
        <>
          <button
            className="style-detail-backdrop"
            aria-label="Close style details"
            onClick={closeDetail}
            disabled={busy}
          />
          <aside
            ref={detailElement}
            className="style-detail"
            aria-label={`${selected.name} style details`}
          >
            <div className="style-detail-top">
              <span>
                STYLE /{" "}
                {String(catalog.styles.indexOf(selected) + 1).padStart(3, "0")}
              </span>
              <button
                aria-label="Close style details"
                onClick={closeDetail}
                disabled={busy}
              >
                <X size={19} />
              </button>
            </div>
            <div className="style-detail-scroll">
              <div className="style-detail-image">
                {selectedReference?.url && onOpenImage ? (
                  <button
                    className="style-reference-inspect"
                    aria-label={`Inspect ${selected.name} reference lineage`}
                    onClick={() =>
                      onOpenImage({
                        output: selectedReference.url,
                        projectId: project?.id,
                        label: selected.name,
                      })
                    }
                  >
                    <ReferenceImage
                      reference={selectedReference}
                      name={selected.name}
                      eager
                    />
                  </button>
                ) : (
                  <ReferenceImage
                    reference={selectedReference}
                    name={selected.name}
                    status={selected.referenceStatus}
                    eager
                  />
                )}
              </div>
              {selected.references?.length > 1 && (
                <div
                  className="style-reference-strip"
                  aria-label="Style references"
                >
                  {selected.references.map((reference, index) => (
                    <button
                      key={`${reference.url}-${index}`}
                      aria-label={`Show reference ${index + 1}`}
                      aria-pressed={referenceIndex === index}
                      onClick={() => setReferenceIndex(index)}
                      disabled={busy}
                    >
                      <ReferenceImage
                        reference={reference}
                        name={selected.name}
                      />
                    </button>
                  ))}
                </div>
              )}
              <p className="style-provenance">
                {selectedReference
                  ? selectedReference.kind === "uploaded"
                    ? "Uploaded reference"
                    : "AI-generated reference"
                  : "No reference image"}
              </p>
              {selectedReference?.label && (
                <p className="style-reference-label">
                  {selectedReference.label}
                </p>
              )}
              {selectedReference?.source && (
                <p className="style-reference-source">
                  {selectedReference.source.url && (
                    <a
                      href={selectedReference.source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Reference source <ArrowUpRight size={12} />
                    </a>
                  )}
                  {selectedReference.source.creator && (
                    <>
                      {selectedReference.source.url ? " · " : ""}
                      {selectedReference.source.creator}
                    </>
                  )}
                  {selectedReference.source.license && (
                    <>
                      <br />
                      {selectedReference.source.license}
                    </>
                  )}
                </p>
              )}
              <div className="style-detail-title">
                <div>
                  <p className="style-eyebrow">{selected.category}</p>
                  <h2>{selected.name}</h2>
                </div>
                <button
                  className={`style-detail-favorite ${selected.favorite ? "is-active" : ""}`}
                  aria-label={`${selected.favorite ? "Unfavorite" : "Favorite"} ${selected.name}`}
                  aria-pressed={Boolean(selected.favorite)}
                  onClick={() => favorite(selected)}
                  disabled={favoriteBusy.has(selected.id)}
                >
                  <Heart
                    size={18}
                    fill={selected.favorite ? "currentColor" : "none"}
                  />
                </button>
              </div>
              <p className="style-detail-description">{selected.description}</p>
              <div className="style-custom-actions">
                <button
                  onClick={() => setEditor({ style: selected })}
                  disabled={busy}
                >
                  {selected.custom ? <Pencil size={13} /> : <Plus size={13} />}
                  {selected.custom
                    ? "Edit style & references"
                    : "Add reference images"}
                </button>
              </div>
              <details className="style-exact-prompt" open>
                <summary>Style prompt</summary>
                <p>{selected.prompt}</p>
              </details>
              {selectedReferencePrompt && (
                <details className="style-exact-prompt style-reference-prompt">
                  <summary>Reference image prompt</summary>
                  <p>{selectedReferencePrompt}</p>
                </details>
              )}
              <label className="style-subject">
                Scene prompt
                <textarea
                  aria-label="Subject for this style"
                  value={subject}
                  onChange={(event) => {
                    setSubjectEdited(true);
                    setSubject(event.target.value);
                  }}
                  placeholder="A quiet afternoon in a bookshop, two friends sharing a story…"
                  rows={3}
                  disabled={busy}
                />
              </label>
              <button
                className="style-scene-reset"
                disabled={busy || !baselineScene}
                onClick={() => {
                  setSubject(baselineScene);
                  setSubjectEdited(false);
                }}
              >
                Use reference scene
              </button>
              <ReferenceSources sources={selected.sources} compact />
              <p className="style-project-scope">
                Creates a workflow in{" "}
                <strong>{project?.name || "your local workspace"}</strong>. Run
                it to generate images.
              </p>
              {actionError && (
                <div className="style-action-error" role="alert">
                  {actionError}
                </div>
              )}
              {message && (
                <div className="style-action-message" role="status">
                  <Check size={14} />
                  {message}
                </div>
              )}
            </div>
            <div className="style-detail-actions">
              <button
                className="style-primary"
                onClick={() => runAction("start")}
                disabled={busy || !onStart}
              >
                {busy ? (
                  <LoaderCircle className="style-spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
                Start with this style <ArrowUpRight size={16} />
              </button>
              {onApply && !readOnly && (
                <button
                  className="style-secondary"
                  onClick={() => runAction("apply")}
                  disabled={busy}
                >
                  Add direction to selected prompt
                </button>
              )}
            </div>
          </aside>
        </>
      )}
      {editor && (
        <StyleEditor
          style={editor.style}
          categories={categories}
          onClose={() => setEditor(null)}
          onSaved={async (saved) => {
            await refresh({ quiet: true });
            resetFilters();
            setSelectedId(saved.id);
            setReferenceIndex(0);
            setSubjectEdited(false);
            setEditor(null);
          }}
        />
      )}
    </section>
  );
}
