import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  ExternalLink,
  Download,
  GitBranch,
} from "lucide-react";
import { fitImage, zoomImage } from "./image-view-state.mjs";
import "./image-lightbox.css";

export function ImageLightbox({
  image,
  title,
  collection,
  onSelect,
  onClose,
  onInspect,
}) {
  const dialog = useRef(null),
    stage = useRef(null),
    close = useRef(null),
    drag = useRef(null);
  const dimensions = useRef(null),
    fitted = useRef(true),
    viewRef = useRef({ zoom: 1, x: 0, y: 0 });
  const [view, setView] = useState(viewRef.current),
    [size, setSize] = useState(null),
    [failed, setFailed] = useState(false),
    [dragging, setDragging] = useState(false);
  const index = collection.findIndex(
    (item) => item.id === image.id && item.output === image.output,
  );
  const previous = index > 0 ? collection[index - 1] : null;
  const next = index >= 0 ? collection[index + 1] : null;
  const update = (value) => {
    viewRef.current = value;
    setView(value);
  };
  const viewport = () => {
    const box = stage.current.getBoundingClientRect();
    return {
      width: Math.max(1, box.width - 48),
      height: Math.max(1, box.height - 48),
    };
  };
  const fit = () => {
    fitted.current = true;
    update(fitImage(dimensions.current || {}, viewport()));
  };
  const changeZoom = (target, point) => {
    fitted.current = false;
    const minimum = Math.min(
      0.05,
      fitImage(dimensions.current || {}, viewport()).zoom,
    );
    update(zoomImage(viewRef.current, target, point, minimum));
  };
  useEffect(() => {
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = stage.current;
    const observer = new ResizeObserver(() => {
      if (fitted.current && dimensions.current) fit();
    });
    observer.observe(element);
    const wheel = (event) => {
      event.preventDefault();
      if (!dimensions.current) return;
      const box = element.getBoundingClientRect();
      changeZoom(
        viewRef.current.zoom *
          Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.008),
        {
          x: event.clientX - box.left - box.width / 2,
          y: event.clientY - box.top - box.height / 2,
        },
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
      document.body.style.overflow = overflow;
    };
  }, []);
  const select = (item) => {
    if (item) onSelect(item);
  };
  const onKeyDown = (event) => {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      select(previous);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      select(next);
    } else if (["+", "="].includes(event.key)) {
      event.preventDefault();
      changeZoom(viewRef.current.zoom * 1.25);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(viewRef.current.zoom / 1.25);
    } else if (event.key === "0") {
      event.preventDefault();
      fit();
    } else if (event.key === "1") {
      event.preventDefault();
      fitted.current = false;
      update({ zoom: 1, x: 0, y: 0 });
    } else if (event.key === "Tab") {
      const controls = [
        ...dialog.current.querySelectorAll("button:not(:disabled), a[href]"),
      ];
      const at = controls.indexOf(document.activeElement);
      if (event.shiftKey && at <= 0) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && (at < 0 || at === controls.length - 1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    }
  };
  return createPortal(
    <section
      ref={dialog}
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Full-size image: ${title}`}
      onKeyDown={onKeyDown}
    >
      <header>
        <div className="image-lightbox-title">
          <strong>{title}</strong>
          <span>
            {size ? `${size.width} × ${size.height}` : "Loading image…"}
            {index >= 0 && collection.length > 1
              ? ` · ${index + 1} / ${collection.length}`
              : ""}
          </span>
        </div>
        <div className="image-lightbox-actions">
          {onInspect && (
            <button
              type="button"
              aria-label="View image lineage"
              title="View image lineage"
              onClick={onInspect}
            >
              <GitBranch size={17} />
            </button>
          )}
          {collection.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous full-size image"
                title="Previous image (←)"
                disabled={!previous}
                onClick={() => select(previous)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                aria-label="Next full-size image"
                title="Next image (→)"
                disabled={!next}
                onClick={() => select(next)}
              >
                <ChevronRight size={18} />
              </button>
              <span className="image-lightbox-divider" />
            </>
          )}
          <button
            type="button"
            aria-label="Zoom image out"
            title="Zoom out (−)"
            disabled={!size}
            onClick={() => changeZoom(view.zoom / 1.25)}
          >
            <ZoomOut size={17} />
          </button>
          <span className="image-lightbox-zoom" aria-live="polite">
            {Math.round(view.zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom image in"
            title="Zoom in (+)"
            disabled={!size}
            onClick={() => changeZoom(view.zoom * 1.25)}
          >
            <ZoomIn size={17} />
          </button>
          <button
            type="button"
            aria-label="Fit image to screen"
            title="Fit to screen (0)"
            disabled={!size}
            onClick={fit}
          >
            <Maximize size={17} />
          </button>
          <button
            type="button"
            aria-label="View image at actual size"
            title="Actual size (1)"
            disabled={!size}
            onClick={() => {
              fitted.current = false;
              update({ zoom: 1, x: 0, y: 0 });
            }}
          >
            1:1
          </button>
          <a
            href={image.output}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original image"
            title="Open original image"
          >
            <ExternalLink size={17} />
          </a>
          <a
            href={image.output}
            download
            aria-label="Download full-size image"
            title="Download image"
          >
            <Download size={17} />
          </a>
          <button
            type="button"
            ref={close}
            aria-label="Close full-size image"
            title="Close (Esc)"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div
        ref={stage}
        className={`image-lightbox-stage ${dragging ? "is-dragging" : ""}`}
        onDoubleClick={() => {
          if (fitted.current) {
            fitted.current = false;
            update({ zoom: 1, x: 0, y: 0 });
          } else fit();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !dimensions.current) return;
          event.preventDefault();
          stage.current.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            view: viewRef.current,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          fitted.current = false;
          update({
            ...drag.current.view,
            x: drag.current.view.x + event.clientX - drag.current.x,
            y: drag.current.view.y + event.clientY - drag.current.y,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        {failed ? (
          <p role="alert">
            Couldn’t load this image. Try opening the original or close and
            reopen the viewer.
          </p>
        ) : (
          <img
            src={image.output}
            alt={title}
            draggable={false}
            onLoad={(event) => {
              const imageSize = {
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              };
              dimensions.current = imageSize;
              setSize(imageSize);
              fit();
            }}
            onError={() => setFailed(true)}
            style={{
              width: size?.width,
              height: size?.height,
              opacity: size ? 1 : 0,
              transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            }}
          />
        )}
      </div>
      <footer>
        Scroll to zoom<span>Drag to pan</span>
        <span>← → Browse</span>
        <span>Esc to close</span>
      </footer>
    </section>,
    document.body,
  );
}
