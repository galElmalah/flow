import React, { useEffect, useRef, useState } from "react";
import "./workspace-notch.css";

export function WorkspaceNotch({ children, holdOpen = false, status, busy }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null),
    timer = useRef(null),
    trigger = useRef(null);
  const expanded = open || holdOpen;
  const cancelClose = () => clearTimeout(timer.current);
  const reveal = (event) => {
    if (event.pointerType === "touch") return;
    cancelClose();
    setOpen(true);
  };
  const close = () => {
    cancelClose();
    setOpen(false);
  };
  const leave = () => {
    cancelClose();
    timer.current = setTimeout(() => {
      const focused = document.activeElement;
      if (
        root.current?.contains(focused) &&
        (focused.matches(":focus-visible") ||
          focused.getAttribute("aria-expanded") === "true")
      )
        return;
      setOpen(false);
    }, 240);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event) => {
      if (
        !root.current?.contains(event.target) &&
        !event.target.closest(".autocomplete-popup, #workflow-menu")
      )
        close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);
  return (
    <section
      ref={root}
      className={`workspace-notch${expanded ? " is-open" : ""}`}
      aria-label="Workspace controls"
      onPointerLeave={leave}
      onFocusCapture={() => {
        cancelClose();
        setOpen(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) leave();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close();
          trigger.current?.focus();
          // Focusing the trigger must not reopen the panel on Escape.
          setOpen(false);
        }
        if (event.key === "ArrowDown" && event.target === trigger.current) {
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() =>
            root.current
              ?.querySelector(
                ".workspace-notch-content button:not(:disabled), .workspace-notch-content input:not(:disabled)",
              )
              ?.focus(),
          );
        }
      }}
    >
      <div className="workspace-notch-proximity" onPointerEnter={reveal} />
      <button
        ref={trigger}
        className="workspace-notch-handle"
        aria-label={`Workspace menu${status ? ` · ${status}` : ""}`}
        aria-expanded={expanded}
        aria-controls="workspace-notch-content"
        onClick={() => setOpen(true)}
      >
        <span className="workspace-notch-grip" />
        {status && (
          <span
            className={`workspace-notch-status${busy ? " is-busy" : ""}`}
            aria-hidden="true"
          />
        )}
      </button>
      <div className="workspace-notch-reveal" onPointerEnter={reveal}>
        <div
          className="workspace-notch-content"
          id="workspace-notch-content"
          inert={!expanded}
          aria-hidden={!expanded}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
