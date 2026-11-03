import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, MessageSquare, ArrowUpRight, LoaderCircle } from "lucide-react";
import { IconButton } from "../components/IconButton.jsx";

export function commentAnchor(editor, comment) {
  if (comment.anchor) return comment.anchor;
  const region = editor.regions.find((r) => comment.regionIds.includes(r.id));
  return (
    region?.anchor ||
    (region
      ? {
          x: (region.bbox[0] + region.bbox[2] / 2) / editor.width,
          y: (region.bbox[1] + region.bbox[3] / 2) / editor.height,
        }
      : { x: 0.5, y: 0.5 })
  );
}

export function InlineComments({
  editor,
  annotation,
  setAnnotation,
  artboard,
  dialog,
  busy,
  onSelect,
  onPatch,
  onSend,
}) {
  const [position, setPosition] = useState(null);
  const popup = useRef(null);
  const saved = editor.comments.find((c) => c.id === annotation?.commentId);
  useLayoutEffect(() => {
    if (!annotation) {
      setPosition(null);
      return;
    }
    const place = () => {
      const box = artboard.current?.getBoundingClientRect();
      const stage = artboard.current?.parentElement.getBoundingClientRect();
      if (!box || !stage) return;
      const width = Math.min(285, stage.width - 24);
      const height = popup.current?.offsetHeight || 250;
      const x = box.left + annotation.anchor.x * box.width;
      const y = box.top + annotation.anchor.y * box.height;
      setPosition({
        width,
        left: Math.max(
          stage.left + 12,
          Math.min(x + 18, stage.right - width - 12),
        ),
        top: Math.max(
          stage.top + 12,
          Math.min(y - 16, stage.bottom - height - 12),
        ),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (popup.current) observer.observe(popup.current);
    observer.observe(artboard.current);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    popup.current?.querySelector("textarea")?.focus();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [
    annotation?.anchor.x,
    annotation?.anchor.y,
    annotation?.commentId,
    artboard,
  ]);
  const names = (ids) =>
    ids
      .map((id) => editor.regions.find((r) => r.id === id)?.label || id)
      .join(" + ");
  return (
    <>
      <div className="editor-comment-pins" aria-label="Inline image comments">
        {editor.comments
          .filter((c) => !c.resolved || annotation?.commentId === c.id)
          .map((c) => {
            const i = editor.comments.indexOf(c);
            const anchor = commentAnchor(editor, c);
            return (
              <button
                key={c.id}
                className={`editor-comment-pin ${c.resolved ? "is-resolved" : ""} ${annotation?.commentId === c.id ? "is-active" : ""}`}
                style={{
                  left: `${anchor.x * 100}%`,
                  top: `${anchor.y * 100}%`,
                }}
                aria-label={`Comment ${i + 1}: ${c.text}`}
                aria-expanded={annotation?.commentId === c.id}
                onClick={() => {
                  onSelect(c.regionIds);
                  setAnnotation({
                    anchor,
                    regionIds: c.regionIds,
                    commentId: c.id,
                  });
                }}
              >
                <span>{i + 1}</span>
                <span className="editor-pin-preview" aria-hidden="true">
                  {c.text}
                </span>
              </button>
            );
          })}
        {annotation && !saved && (
          <span
            className="editor-draft-pin"
            style={{
              left: `${annotation.anchor.x * 100}%`,
              top: `${annotation.anchor.y * 100}%`,
            }}
          >
            <MessageSquare size={15} />
          </span>
        )}
      </div>
      {annotation &&
        dialog.current &&
        createPortal(
          <section
            ref={popup}
            className="editor-inline-comment"
            style={{ ...position, visibility: position ? "visible" : "hidden" }}
            aria-label={saved ? "Inline comment" : "New inline comment"}
          >
            <header>
              <strong>
                {saved
                  ? `Comment ${editor.comments.indexOf(saved) + 1}`
                  : "Comment on region"}
              </strong>
              <IconButton
                label="Close inline comment"
                onClick={() => setAnnotation(null)}
              >
                <X size={15} />
              </IconButton>
            </header>
            <div className="editor-inline-target">
              {names(annotation.regionIds)}
            </div>
            {saved ? (
              <>
                <p>{saved.text}</p>
                <button
                  className="editor-comment-submit"
                  disabled={busy}
                  onClick={() =>
                    onPatch({
                      resolve: { id: saved.id, resolved: !saved.resolved },
                    })
                  }
                >
                  {saved.resolved ? "Reopen comment" : "Resolve comment"}
                </button>
                {!saved.resolved && (
                  <button
                    className="editor-inline-send"
                    disabled={busy}
                    onClick={onSend}
                  >
                    <ArrowUpRight size={13} /> Send to agent
                  </button>
                )}
              </>
            ) : (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const next = await onPatch({
                    comment: {
                      regionIds: annotation.regionIds,
                      anchor: annotation.anchor,
                      text: annotation.text,
                    },
                  });
                  if (next)
                    setAnnotation({
                      ...annotation,
                      commentId: next.comments.at(-1).id,
                    });
                }}
              >
                <textarea
                  aria-label="Inline comment text"
                  autoFocus
                  value={annotation.text || ""}
                  onChange={(event) =>
                    setAnnotation({ ...annotation, text: event.target.value })
                  }
                  placeholder="Tell your agent what to change here…"
                  maxLength={4000}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter" &&
                      annotation.text?.trim() &&
                      !busy
                    ) {
                      event.preventDefault();
                      onSend();
                    }
                  }}
                />
                <div className="editor-inline-actions">
                  <button
                    className="editor-comment-submit"
                    disabled={busy || !annotation.text?.trim()}
                  >
                    Save comment
                  </button>
                  <button
                    type="button"
                    className="editor-inline-send"
                    disabled={busy || !annotation.text?.trim()}
                    onClick={onSend}
                  >
                    {busy ? (
                      <LoaderCircle size={13} className="spin" />
                    ) : (
                      <ArrowUpRight size={13} />
                    )}{" "}
                    Send to agent
                  </button>
                </div>
                <small className="editor-inline-hint">
                  Creates a new variation · ⌘ / Ctrl + Enter to send
                </small>
              </form>
            )}
          </section>,
          dialog.current,
        )}
    </>
  );
}
