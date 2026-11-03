import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Scan,
  MousePointer2,
  Layers,
  MessageSquare,
  Eye,
  EyeOff,
  LockKeyhole,
  LockKeyholeOpen,
  ChevronUp,
  ChevronDown,
  Download,
  Check,
  LoaderCircle,
  ArrowUpRight,
  RefreshCw,
  GitBranch,
} from "lucide-react";
import { jsonRequest } from "../studio/ui.mjs";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { SamSetup } from "../components/SamSetup.jsx";
import { shouldDetectRegions } from "./model-state.mjs";
import { IconButton } from "../components/IconButton.jsx";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import {
  toggleRegion,
  editTargets,
  needsRegionName,
} from "../../shared/image-editor.mjs";
import { RegionLabel } from "./RegionLabel.jsx";
import { RegionNaming } from "./RegionNaming.jsx";
import { Variations, VariationDetails } from "./Variations.jsx";
import { InlineComments, commentAnchor } from "./InlineComments.jsx";
import { AssetLineagePanel } from "../panels/AssetLineagePanel.jsx";
import { updateViewerTarget, viewerParams } from "../studio/navigation.mjs";
import "./image-editor.css";
const colors = [
  "#b8b5ff",
  "#91ddcc",
  "#eabb91",
  "#dba4d6",
  "#a9c9ef",
  "#d2d5a2",
];
const request = (url, body, method = "POST") =>
  jsonRequest(url, { method, body: JSON.stringify(body) });
export function ImageEditor({
  image,
  onClose,
  onOpenWorkflow,
  onEditVariation,
  providers = [],
  onAgentHost,
  onAgentContext,
}) {
  const [editor, setEditor] = useState(null),
    [model, setModel] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState([]),
    [hover, setHover] = useState(null),
    [showMasks, setShowMasks] = useState(false),
    [mode, setMode] = useState("select"),
    [tab, setTab] = useState("layers"),
    [annotation, setAnnotation] = useState(null),
    [preview, setPreview] = useState(null),
    [namingOptions, setNamingOptions] = useState({
      providerId: "codex-text",
      model: "default",
    }),
    [autoNames, setAutoNames] = useState(true),
    [clock, setClock] = useState(Date.now()),
    [instructions, setInstructions] = useState(""),
    [editMode, setEditMode] = useState("whole"),
    [recolor, setRecolor] = useState("#ec4899"),
    [strength, setStrength] = useState(1),
    [provider, setProvider] = useState("codex"),
    [count, setCount] = useState("1");
  const dialog = useRef(null),
    svg = useRef(null),
    artboard = useRef(null),
    operation = useRef(false),
    prepared = useRef(null),
    following = useRef(null),
    autoDetection = useRef(null);
  const current = useRef(null);
  const trapRef = useRef(null);
  const bindDialog = useCallback(
    (element) => {
      dialog.current = element;
      onAgentHost?.(element);
    },
    [onAgentHost],
  );
  useEffect(() => {
    if (editor)
      onAgentContext?.({
        editorId: editor.id,
        projectId: editor.projectId ?? editor.source.projectId,
        regionIds: selected,
      });
  }, [editor?.id, selected.join(","), onAgentContext]);
  useEffect(() => () => onAgentContext?.(null), [onAgentContext]);
  current.current = editor;
  const accept = (next) =>
    setEditor((old) =>
      !old || next.id !== old.id || next.revision >= old.revision ? next : old,
    );
  const openDocument = () =>
    image.editorId
      ? jsonRequest(`/api/image-editors/${image.editorId}`)
      : request("/api/image-editors", {
          source: image.output,
          ...(image.runId && {
            runId: image.runId,
            ...(image.id && { jobId: image.id }),
          }),
          ...(image.projectId && { projectId: image.projectId }),
        });
  const load = async () => {
    if (current.current)
      accept(await jsonRequest(`/api/image-editors/${current.current.id}`));
    else accept(await openDocument());
    setModel(await jsonRequest("/api/image-editors/status"));
  };
  useEffect(() => {
    let live = true;
    following.current = null;
    autoDetection.current = null;
    prepared.current = null;
    setEditor(null);
    current.current = null;
    setSelected([]);
    setAnnotation(null);
    setPreview(null);
    setError("");
    const previous = document.activeElement;
    Promise.all([openDocument(), jsonRequest("/api/image-editors/status")])
      .then(async ([doc, status]) => {
        if (!live) return;
        accept(doc);
        setSelected(doc.inheritedSelection || []);
        if (image.editorDraft) {
          const carried = image.editorDraft;
          if (
            carried.regionIds.every((id) =>
              doc.regions.some((r) => r.id === id),
            )
          )
            setAnnotation(carried);
        }
        setModel(status);
        if (doc.naming?.providerId)
          setNamingOptions({
            providerId: doc.naming.providerId,
            model: doc.naming.model || "default",
          });
        updateViewerTarget({ editor: doc.id }, { replace: true });
        if (
          autoNames &&
          !doc.naming &&
          !["queued", "running"].includes(doc.segmentation.status) &&
          doc.regions.some(needsRegionName)
        )
          accept(
            await request(`/api/image-editors/${doc.id}/names`, namingOptions),
          );
      })
      .catch((err) => live && setError(err.message));
    dialog.current?.focus();
    return () => {
      live = false;
      previous?.focus?.();
      if (viewerParams(window.location).get("editor") === current.current?.id)
        updateViewerTarget({ editor: null }, { replace: true });
    };
  }, [image.editorId, image.output]);
  const analyzing = ["queued", "running"].includes(editor?.segmentation.status);
  const naming = ["queued", "running"].includes(editor?.naming?.status);
  useEffect(() => {
    if (!analyzing) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [analyzing]);
  useEffect(() => {
    if (!analyzing && !naming && model?.ready) return;
    let live = true;
    const timer = setInterval(async () => {
      try {
        const [doc, status] = await Promise.all([
          editor
            ? jsonRequest(`/api/image-editors/${editor.id}`)
            : Promise.resolve(null),
          jsonRequest("/api/image-editors/status"),
        ]);
        if (live) {
          if (doc) accept(doc);
          setModel(status);
        }
      } catch (err) {
        if (live) setError(err.message);
      }
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [analyzing, naming, model?.status, editor?.id]);
  useEffect(() => {
    if (!shouldDetectRegions(editor, model)) return;
    const key = `${editor.id}:${model.model}`;
    if (autoDetection.current === key) return;
    autoDetection.current = key;
    let live = true;
    request(`/api/image-editors/${editor.id}/segments`, {
      names: autoNames ? namingOptions : false,
    })
      .then((doc) => {
        if (live) accept(doc);
      })
      .catch((error) => {
        if (live) setError(error.message);
      });
    return () => {
      live = false;
    };
  }, [editor?.id, editor?.segmentation.status, model?.ready, model?.model]);
  const act = async (callback) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      return await callback();
    } catch (err) {
      setError(err.message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
      operation.current = false;
    }
  };
  const patch = (change) =>
    act(async () => {
      const next = await request(
        `/api/image-editors/${editor.id}`,
        { revision: current.current.revision, ...change },
        "PATCH",
      );
      accept(next);
      return next;
    });
  const select = (id, shift, anchor) => {
    const ids = !shift && id ? [id] : toggleRegion(selected, id, shift);
    setSelected(ids);
    if (!ids.length) {
      setAnnotation(null);
      return;
    }
    const region =
      editor.regions.find((r) => r.id === id) ||
      editor.regions.find((r) => r.id === ids[0]);
    setAnnotation({
      regionIds: ids,
      anchor: anchor ||
        region.anchor || {
          x: (region.bbox[0] + region.bbox[2] / 2) / editor.width,
          y: (region.bbox[1] + region.bbox[3] / 2) / editor.height,
        },
      text: annotation && !annotation.commentId ? annotation.text || "" : "",
    });
  };
  const move = (id, direction) => {
    const order = editor.regions.map((r) => r.id),
      from = order.indexOf(id),
      to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    patch({ order });
  };
  const segment = (point) =>
    act(async () => {
      accept(
        await request(`/api/image-editors/${editor.id}/segments`, {
          ...(point ? { point } : {}),
          names: autoNames ? namingOptions : false,
        }),
      );
      setMode("select");
    });
  const highlighted = editor?.regions.find((r) => r.id === hover);
  const comments =
    editor?.comments.filter(
      (c) =>
        !selected.length || c.regionIds.some((id) => selected.includes(id)),
    ) || [];
  const draft = annotation && !annotation.commentId ? annotation : null;
  const targets = editor
    ? editMode === "recolor"
      ? selected
      : editTargets(editor, selected, draft)
    : [];
  const openComments = editor?.comments.filter((c) => !c.resolved) || [];
  const actionReady =
    !!editor &&
    (editMode === "whole" ||
      (targets.length > 0 &&
        (editMode === "recolor" ||
          instructions.trim() ||
          openComments.length ||
          draft?.text?.trim())));
  const blocked =
    busy || !actionReady || (editMode !== "whole" && analyzing) || !!preview;
  const openVersion = (job, carryDraft = false) => {
    following.current = null;
    setAnnotation(null);
    onEditVariation(
      carryDraft && draft?.text?.trim() ? { ...job, editorDraft: draft } : job,
    );
  };
  const openOriginal = () => {
    following.current = null;
    setPreview(null);
    if (editor?.original?.editorId && editor.original.editorId !== editor.id)
      onEditVariation({
        editorId: editor.original.editorId,
        output: editor.original.url,
        projectId: editor.projectId ?? editor.source.projectId,
      });
  };
  const followCompleted = (groups) => {
    const pending = following.current;
    if (!pending || current.current?.id !== pending.editorId) return;
    const group = groups.find((entry) => entry.requestId === pending.requestId);
    if (!group) return;
    const output = group.jobs.find((job) => job.output);
    if (output) openVersion(output, pending.mode === "recolor");
    else if (
      ["failed", "cancelled", "interrupted", "paused"].includes(group.status)
    )
      following.current = null;
  };
  const layerToggle = (region, field) => {
    patch({ layer: { id: region.id, [field]: !region[field] } }).then(
      (result) => {
        if (result) setSelected((ids) => ids.filter((id) => id !== region.id));
      },
    );
  };
  const pinAt = (event, region) => {
    const bounds = svg.current.getBoundingClientRect();
    const ids = selected.includes(region.id) ? selected : [region.id];
    setSelected(ids);
    setAnnotation({
      regionIds: ids,
      anchor: {
        x: Math.max(
          0,
          Math.min(1, (event.clientX - bounds.left) / bounds.width),
        ),
        y: Math.max(
          0,
          Math.min(1, (event.clientY - bounds.top) / bounds.height),
        ),
      },
    });
    setMode("select");
  };
  const submitEdit = (send, requestedMode = editMode) =>
    act(async () => {
      let doc = current.current;
      if (requestedMode !== "recolor" && draft?.text?.trim()) {
        doc = await request(
          `/api/image-editors/${doc.id}`,
          {
            revision: doc.revision,
            comment: {
              regionIds: draft.regionIds,
              anchor: draft.anchor,
              text: draft.text,
            },
          },
          "PATCH",
        );
        accept(doc);
        setAnnotation({ ...draft, commentId: doc.comments.at(-1).id });
      }
      const payload = {
        revision: doc.revision,
        regionIds:
          requestedMode === "recolor" ? selected : editTargets(doc, selected),
        mode: requestedMode,
        ...(requestedMode === "recolor" && { color: recolor, strength }),
        instructions,
        providerId: provider,
        count: requestedMode === "recolor" ? 1 : Number(count),
      };
      const fingerprint = JSON.stringify({ ...payload, revision: undefined });
      // Keep a successful prepare if dispatch fails; retry sends that same request.
      let result =
        prepared.current?.fingerprint === fingerprint &&
        prepared.current.revision === payload.revision
          ? prepared.current.result
          : null;
      if (!result) {
        result = await request(
          `/api/image-editors/${editor.id}/requests`,
          payload,
        );
        accept(result.editor);
        prepared.current = {
          fingerprint,
          revision: result.editor.revision,
          result,
        };
      }
      if (send) {
        const receipt = await request(
          `/api/image-editors/${editor.id}/requests/${result.request.id}/send`,
          {},
        );
        accept(receipt.editor);
        if (requestedMode !== "whole" && payload.count === 1)
          following.current = {
            editorId: editor.id,
            requestId: result.request.id,
            mode: requestedMode,
          };
        if (requestedMode !== "recolor") setAnnotation(null);
        setSelected([]);
        setInstructions("");
        setPreview(null);
        prepared.current = null;
      }
    });
  const trap = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (annotation) setAnnotation(null);
      else if (mode !== "select") setMode("select");
      else if (selected.length) setSelected([]);
      else onClose();
    }
    if (event.key === "Tab") {
      const items = [
        ...dialog.current.querySelectorAll(
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ].filter(
        (el) =>
          el.getClientRects().length &&
          !el.closest("[inert], [aria-hidden='true']"),
      );
      const index = items.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && index === items.length - 1) {
        event.preventDefault();
        items[0]?.focus();
      }
    }
  };
  trapRef.current = trap;
  useEffect(() => {
    const element = dialog.current;
    const hostedTab = (event) => {
      if (event.key === "Tab" && event.target.closest(".agent-dock"))
        trapRef.current(event);
    };
    element.addEventListener("keydown", hostedTab);
    return () => element.removeEventListener("keydown", hostedTab);
  }, []);
  return (
    <div
      className="image-editor"
      ref={bindDialog}
      role="dialog"
      aria-modal="true"
      aria-label="Image region editor"
      tabIndex={-1}
      onKeyDown={trap}
    >
      <header className="editor-header">
        <div>
          <Scan size={20} />
          <div>
            <h1>Image editor</h1>
            <span>
              {editor
                ? `${editor.width} × ${editor.height} · ${editor.regions.length} regions`
                : "Opening image…"}
            </span>
          </div>
        </div>
        <div className="editor-header-actions">
          <span className="editor-engine">
            SAM 2.1 · local
            {editor?.segmentation.device
              ? ` · ${editor.segmentation.device.toUpperCase()}`
              : ""}
          </span>
          <IconButton
            label="Reload editor"
            onClick={() => act(load)}
            disabled={busy}
          >
            <RefreshCw size={16} />
          </IconButton>
          <IconButton label="Close image editor" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
      </header>
      {error && (
        <div className="editor-error" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <div className="editor-layout">
        <section className="editor-workspace" aria-label="Image regions">
          {preview ? (
            <nav
              className="editor-toolbar editor-preview-tools"
              aria-label="Variation tools"
            >
              <strong>Generated variation</strong>
              <button onClick={() => setPreview(null)}>
                Back to original & comments
              </button>
              <a href={preview.output} download="image-variation.png">
                <Download size={14} /> Download
              </a>
              <button onClick={() => openVersion(preview)}>
                <Scan size={14} /> Continue editing
              </button>
            </nav>
          ) : (
            <nav className="editor-toolbar" aria-label="Region tools">
              <button
                className={mode === "select" ? "is-active" : ""}
                onClick={() => setMode("select")}
              >
                <MousePointer2 size={15} /> Select
              </button>
              <button
                className={mode === "point" ? "is-active" : ""}
                disabled={!model?.ready || analyzing || busy}
                onClick={() => setMode(mode === "point" ? "select" : "point")}
              >
                <Scan size={15} /> Pick missing region
              </button>
              <button
                className={mode === "comment" ? "is-active" : ""}
                disabled={!editor?.regions.length || busy}
                onClick={() => {
                  if (selected.length) {
                    const region = editor.regions.find((r) =>
                      selected.includes(r.id),
                    );
                    setAnnotation({
                      regionIds: selected,
                      anchor: commentAnchor(editor, { regionIds: selected }),
                      text: draft?.text || "",
                    });
                  } else setMode(mode === "comment" ? "select" : "comment");
                }}
              >
                <MessageSquare size={15} /> Comment
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={showMasks}
                  onChange={(e) => setShowMasks(e.target.checked)}
                />{" "}
                Show all masks
              </label>
              <button
                disabled={!selected.length}
                onClick={() => {
                  setSelected([]);
                  setAnnotation(null);
                }}
              >
                Clear selection
              </button>
            </nav>
          )}
          {editor && model && !model.ready && (
            <SamSetup
              model={model}
              busy={busy}
              editor
              onSetup={() =>
                act(async () =>
                  setModel(await request("/api/image-editors/setup", {})),
                )
              }
            />
          )}
          {editor?.segmentation.inheritedFrom && (
            <div className="editor-inherited-regions" role="status">
              <div>
                <strong>Regions carried forward</strong>
                <span>
                  {editor.segmentation.needsReview
                    ? "Names and comments are retained. Review boundaries if the object changed shape."
                    : "Your selections, region names and comments are ready to use."}
                </span>
              </div>
              <button
                disabled={busy || analyzing || !model?.ready}
                onClick={() => setMode("point")}
                title="Click an object in the image to detect a fresh mask. Existing layers and comments stay available."
              >
                <Scan size={14} /> Pick a new region
              </button>
            </div>
          )}
          <div className="editor-stage">
            <div
              ref={artboard}
              className={`editor-artboard ${mode !== "select" ? "is-picking" : ""}`}
            >
              <img
                src={preview?.output || editor?.source.url || image.output}
                alt={
                  preview
                    ? "Generated image variation"
                    : "Image version to edit"
                }
                draggable={false}
              />
              {editor && !preview && (
                <svg
                  ref={svg}
                  viewBox={`0 0 ${editor.width} ${editor.height}`}
                  aria-label="Selectable image regions"
                  onPointerLeave={() => setHover(null)}
                  onClick={(event) => {
                    if (mode === "point") {
                      const bounds = svg.current.getBoundingClientRect();
                      segment({
                        x: (event.clientX - bounds.left) / bounds.width,
                        y: (event.clientY - bounds.top) / bounds.height,
                      });
                    } else if (event.target === svg.current)
                      select(null, event.shiftKey);
                  }}
                >
                  {editor.regions
                    .filter((r) => r.visible)
                    .map((r, i) => (
                      <path
                        key={r.id}
                        role="button"
                        aria-label={`Comment on ${r.label}`}
                        tabIndex={r.locked ? -1 : 0}
                        aria-disabled={r.locked}
                        onKeyDown={(event) => {
                          if (!r.locked && ["Enter", " "].includes(event.key)) {
                            event.preventDefault();
                            select(r.id, event.shiftKey);
                          }
                        }}
                        d={r.path}
                        fillRule="evenodd"
                        fill={colors[i % colors.length]}
                        fillOpacity={
                          selected.includes(r.id)
                            ? 0.34
                            : hover === r.id
                              ? 0.22
                              : showMasks
                                ? 0.12
                                : 0
                        }
                        stroke={
                          selected.includes(r.id) || hover === r.id
                            ? colors[i % colors.length]
                            : "none"
                        }
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        style={{
                          pointerEvents:
                            r.locked || mode === "point" ? "none" : "fill",
                        }}
                        onPointerEnter={() => setHover(r.id)}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (mode === "comment" && !event.shiftKey)
                            pinAt(event, r);
                          else {
                            const bounds = svg.current.getBoundingClientRect();
                            select(r.id, event.shiftKey, {
                              x: (event.clientX - bounds.left) / bounds.width,
                              y: (event.clientY - bounds.top) / bounds.height,
                            });
                          }
                        }}
                      >
                        <title>{r.label} · Shift-click to add or remove</title>
                      </path>
                    ))}
                </svg>
              )}
              {editor && !preview && (
                <InlineComments
                  editor={editor}
                  annotation={annotation}
                  setAnnotation={setAnnotation}
                  artboard={artboard}
                  dialog={dialog}
                  busy={busy}
                  onSelect={setSelected}
                  onPatch={patch}
                  onSend={() => {
                    setEditMode("whole");
                    submitEdit(true, "whole");
                  }}
                />
              )}
            </div>
            {(!editor || analyzing) && (
              <div className="editor-processing" role="status">
                <LoaderCircle className="spin" size={18} />
                <div>
                  <strong>
                    {!editor
                      ? "Opening editor…"
                      : editor.segmentation.status === "queued"
                        ? "Waiting for local segmentation…"
                        : editor.segmentation.progress?.message ||
                          "Finding regions with SAM 2.1…"}
                  </strong>
                  {editor?.segmentation.progress?.total > 0 && (
                    <>
                      <progress
                        aria-label={`${editor.segmentation.progress.stage} progress`}
                        value={editor.segmentation.progress.completed}
                        max={editor.segmentation.progress.total}
                      />
                      <small>
                        {editor.segmentation.progress.completed} /{" "}
                        {editor.segmentation.progress.total}{" "}
                        {editor.segmentation.progress.stage === "sampling"
                          ? "prompt batches"
                          : "mask proposals"}
                      </small>
                    </>
                  )}
                  {editor?.segmentation.startedAt && (
                    <small>
                      {Math.max(
                        0,
                        Math.floor(
                          (clock - Date.parse(editor.segmentation.startedAt)) /
                            1000,
                        ),
                      )}
                      s elapsed · {editor.segmentation.model}
                    </small>
                  )}
                </div>
              </div>
            )}
          </div>
          <footer className="editor-canvas-footer">
            <span>
              {preview
                ? "Review your variation · Original and comments are preserved"
                : mode === "point"
                  ? "Click an object to add a SAM selection."
                  : mode === "comment"
                    ? "Click a region to pin a comment · Shift-click to add regions first"
                    : highlighted
                      ? highlighted.label
                      : "Click a region to comment · Shift-click to select several"}
            </span>
            <span>{selected.length} selected</span>
          </footer>
          {editor &&
            model?.ready &&
            !analyzing &&
            (!editor.regions.length ||
              editor.segmentation.status === "failed") && (
              <div className="editor-model-message">
                <p>
                  {editor.segmentation.error ||
                    "Find objects and scene details as selectable masks."}
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    segment(
                      editor.segmentation.status === "failed"
                        ? editor.segmentation.point
                        : undefined,
                    )
                  }
                >
                  Detect regions
                </button>
              </div>
            )}
          {editor && (
            <Variations
              editor={editor}
              preview={preview}
              onOriginal={openOriginal}
              onOpenVersion={openVersion}
              onGroups={followCompleted}
              onPreview={(job) => {
                following.current = null;
                setPreview(job);
                setAnnotation(null);
              }}
              busy={busy}
              onOpenWorkflow={onOpenWorkflow}
              onSend={(requestId, ownerId = editor.id, group) =>
                act(async () => {
                  const receipt = await request(
                    `/api/image-editors/${ownerId}/requests/${requestId}/send`,
                    {},
                  );
                  if (receipt.editor.id === current.current?.id) {
                    accept(receipt.editor);
                    if (group.mode !== "whole" && group.count === 1)
                      following.current = {
                        editorId: editor.id,
                        requestId,
                        mode: group.mode,
                      };
                  }
                })
              }
            />
          )}
        </section>
        <aside
          className="editor-sidebar"
          aria-label="Layers and region comments"
        >
          {preview ? (
            <VariationDetails
              image={preview}
              editor={editor}
              providers={providers}
              onOriginal={openOriginal}
              onEdit={() => openVersion(preview)}
            />
          ) : (
            <>
              <div className="editor-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={tab === "lineage"}
                  onClick={() => setTab("lineage")}
                >
                  <GitBranch size={15} />
                  Lineage
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "layers"}
                  onClick={() => setTab("layers")}
                >
                  <Layers size={15} /> Layers{" "}
                  <span>{editor?.regions.length || 0}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "comments"}
                  onClick={() => setTab("comments")}
                >
                  <MessageSquare size={15} /> Comments{" "}
                  <span>
                    {editor?.comments.filter((c) => !c.resolved).length || 0}
                  </span>
                </button>
              </div>
              <div className="editor-inspector-scroll">
                {tab === "lineage" ? (
                  <AssetLineagePanel
                    key={editor?.source.url || image.output}
                    image={{
                      output: editor?.source.url || image.output,
                      projectId: editor?.projectId ?? image.projectId,
                    }}
                  />
                ) : tab === "layers" ? (
                  <div
                    className="editor-layers"
                    role="tabpanel"
                    aria-label="Mask layers"
                  >
                    {editor && (
                      <RegionNaming
                        editor={editor}
                        providers={providers}
                        options={namingOptions}
                        onOptions={setNamingOptions}
                        auto={autoNames}
                        onAuto={setAutoNames}
                        disabled={busy || analyzing}
                        onName={() =>
                          act(async () =>
                            accept(
                              await request(
                                `/api/image-editors/${editor.id}/names`,
                                namingOptions,
                              ),
                            ),
                          )
                        }
                        onCancel={() =>
                          act(async () =>
                            accept(
                              await request(
                                `/api/image-editors/${editor.id}/names/cancel`,
                                {},
                              ),
                            ),
                          )
                        }
                      />
                    )}
                    {editor?.regions
                      .slice()
                      .reverse()
                      .map((r, i) => (
                        <article
                          key={r.id}
                          className={
                            selected.includes(r.id) ? "is-selected" : ""
                          }
                          onPointerEnter={() => setHover(r.id)}
                          onPointerLeave={() => setHover(null)}
                        >
                          <div className="editor-layer-name">
                            <button
                              aria-label={`Select ${r.label}`}
                              aria-pressed={selected.includes(r.id)}
                              disabled={r.locked || !r.visible}
                              onClick={(e) => select(r.id, e.shiftKey)}
                            >
                              <span
                                style={{
                                  borderColor:
                                    colors[
                                      (editor.regions.length - 1 - i) %
                                        colors.length
                                    ],
                                }}
                              >
                                {selected.includes(r.id) ? (
                                  <Check size={13} />
                                ) : (
                                  <Layers size={13} />
                                )}
                              </span>
                            </button>
                            <RegionLabel
                              region={r}
                              busy={busy}
                              onRename={(label) =>
                                patch({ layer: { id: r.id, label } })
                              }
                            />
                          </div>
                          <div className="editor-layer-actions">
                            <IconButton
                              label={`${r.visible ? "Hide" : "Show"} ${r.label}`}
                              disabled={busy || r.locked}
                              onClick={() => layerToggle(r, "visible")}
                            >
                              {r.visible ? (
                                <Eye size={14} />
                              ) : (
                                <EyeOff size={14} />
                              )}
                            </IconButton>
                            <IconButton
                              label={`${r.locked ? "Unlock" : "Lock"} ${r.label}`}
                              disabled={busy}
                              onClick={() => layerToggle(r, "locked")}
                            >
                              {r.locked ? (
                                <LockKeyhole size={13} />
                              ) : (
                                <LockKeyholeOpen size={13} />
                              )}
                            </IconButton>
                            <IconButton
                              label={`Raise ${r.label}`}
                              disabled={busy || i === 0}
                              onClick={() => move(r.id, 1)}
                            >
                              <ChevronUp size={14} />
                            </IconButton>
                            <IconButton
                              label={`Lower ${r.label}`}
                              disabled={busy || i === editor.regions.length - 1}
                              onClick={() => move(r.id, -1)}
                            >
                              <ChevronDown size={14} />
                            </IconButton>
                            <a
                              aria-label={`Download ${r.label} mask`}
                              href={r.mask}
                              download={`${r.label}-mask.png`}
                            >
                              <Download size={13} />
                            </a>
                          </div>
                        </article>
                      ))}
                    {!editor?.regions.length && (
                      <div className="editor-no-regions">
                        Your detected objects will appear here.
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="editor-comments"
                    role="tabpanel"
                    aria-label="Region comments"
                  >
                    <p>
                      {selected.length
                        ? `Comments for ${selected.length} selected regions`
                        : "All image comments. Select regions to leave a precise instruction."}
                    </p>
                    {editor?.comments.some((c) => !c.resolved) && (
                      <button
                        className="editor-select-comments"
                        onClick={() => {
                          const ids = new Set(
                            editor.comments
                              .filter((c) => !c.resolved)
                              .flatMap((c) => c.regionIds),
                          );
                          setSelected(
                            editor.regions
                              .filter(
                                (r) => ids.has(r.id) && r.visible && !r.locked,
                              )
                              .map((r) => r.id),
                          );
                          setAnnotation(null);
                        }}
                      >
                        Select all commented regions
                      </button>
                    )}
                    {comments.map((c) => (
                      <article
                        key={c.id}
                        className={c.resolved ? "is-resolved" : ""}
                      >
                        <button
                          className="editor-comment-target"
                          onClick={() => {
                            setSelected(c.regionIds);
                            setAnnotation({
                              commentId: c.id,
                              regionIds: c.regionIds,
                              anchor: commentAnchor(editor, c),
                            });
                          }}
                        >
                          {c.regionIds
                            .map(
                              (id) =>
                                editor.regions.find((r) => r.id === id)
                                  ?.label || id,
                            )
                            .join(" + ")}
                        </button>
                        <p>{c.text}</p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            patch({
                              resolve: { id: c.id, resolved: !c.resolved },
                            })
                          }
                        >
                          {c.resolved ? "Reopen" : "Resolve"}
                        </button>
                      </article>
                    ))}
                    {!comments.length && (
                      <div className="editor-no-regions">No comments yet.</div>
                    )}
                  </div>
                )}
                <div className="editor-comment-form">
                  <button
                    disabled={!editor?.regions.length || busy}
                    onClick={() => {
                      setMode("comment");
                      setAnnotation(null);
                      setTab("comments");
                    }}
                  >
                    <MessageSquare size={14} /> Pin a comment on the image
                  </button>
                </div>
              </div>
              <form
                className="editor-edit-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitEdit(true);
                }}
              >
                <div className="editor-send-summary">
                  <strong>Edit this version</strong>
                  <span>
                    {targets.length} regions ·{" "}
                    {openComments.length + (draft?.text?.trim() ? 1 : 0)} open
                    comments
                  </span>
                </div>
                <Autocomplete
                  label="Image editing mode"
                  value={editMode}
                  onChange={setEditMode}
                  options={[
                    { value: "whole", label: "Regenerate whole image" },
                    { value: "recolor", label: "Recolor regions" },
                  ]}
                />
                <p className="editor-mode-description">
                  {editMode === "whole"
                    ? "Renders the complete image using your region comments as guidance. No cutout compositing; the entire image may change."
                    : editMode === "recolor"
                      ? "Local recolor preserves texture and pixels outside the selection."
                      : "Edits selected regions using your comments. Outside pixels stay unchanged."}
                </p>
                {editMode === "recolor" ? (
                  <div className="editor-recolor-controls">
                    <label htmlFor="region-recolor">Region color</label>
                    <div>
                      <input
                        id="region-recolor"
                        type="color"
                        value={recolor}
                        onChange={(event) => setRecolor(event.target.value)}
                      />
                      <span>{recolor.toUpperCase()}</span>
                    </div>
                    <label htmlFor="region-recolor-strength">
                      Color strength <span>{Math.round(strength * 100)}%</span>
                    </label>
                    <input
                      id="region-recolor-strength"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={strength}
                      onChange={(event) =>
                        setStrength(Number(event.target.value))
                      }
                    />
                  </div>
                ) : (
                  <>
                    <label htmlFor="region-edit-instructions">
                      {editMode === "whole"
                        ? "New direction"
                        : "Overall direction"}{" "}
                      <small>optional</small>
                    </label>
                    <textarea
                      id="region-edit-instructions"
                      value={instructions}
                      onChange={(event) => setInstructions(event.target.value)}
                      placeholder={
                        editMode === "whole"
                          ? "Use your region comments, or describe a new direction. Leave blank for a fresh take."
                          : "Use your region comments, or describe what should change here."
                      }
                      maxLength={8000}
                    />
                    <div className="editor-provider-row">
                      <Autocomplete
                        label="Image edit provider"
                        value={provider}
                        onChange={setProvider}
                        options={providers
                          .filter(
                            (p) =>
                              p.capabilities?.includes("image") &&
                              p.id !== "local-recolor",
                          )
                          .map((p) => ({
                            value: p.id,
                            label: p.name,
                            icon: <HarnessLogo id={p.id} size={17} />,
                          }))}
                      />
                      <Autocomplete
                        label="Edit variations"
                        value={count}
                        onChange={setCount}
                        options={[1, 4, 8, 16].map((n) => ({
                          value: String(n),
                          label: `${n} ${n === 1 ? "image" : "images"}`,
                        }))}
                      />
                    </div>
                  </>
                )}
                <button className="editor-create" disabled={blocked}>
                  {busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <ArrowUpRight size={15} />
                  )}{" "}
                  {busy
                    ? editMode === "recolor"
                      ? "Preparing recolor…"
                      : "Preparing edit…"
                    : editMode === "recolor"
                      ? "Apply recolor"
                      : editMode === "whole"
                        ? "Regenerate image"
                        : "Send to agent"}
                </button>
                <button
                  type="button"
                  className="editor-prepare-only"
                  disabled={blocked}
                  onClick={() => submitEdit(false)}
                >
                  Prepare workflow only
                </button>
                <small>
                  {editMode === "recolor"
                    ? "No model or API usage. Saved as a new version."
                    : editMode === "whole"
                      ? "Original preserved. Detect regions again for the new scene."
                      : "New version with reusable regions. Review boundaries after shape changes."}
                </small>
              </form>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
