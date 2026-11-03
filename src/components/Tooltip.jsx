import React, {
  cloneElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { tooltipPosition } from "./tooltip-position.mjs";
import "./tooltip.css";

export function Tooltip({ label, children, side }) {
  const id = useId();
  const [anchor, setAnchor] = useState(null);
  const [position, setPosition] = useState(null);
  const bubble = useRef(null);
  const hide = () => {
    setAnchor(null);
    setPosition(null);
  };
  const show = (event) => {
    setAnchor(event.currentTarget);
    setPosition(null);
  };
  useLayoutEffect(() => {
    if (!anchor || !bubble.current) return;
    const preferred =
      side ||
      (anchor.closest(".rail, .rail-restore")
        ? "right"
        : anchor.closest(".topbar")
          ? "bottom"
          : "top");
    setPosition(
      tooltipPosition(
        anchor.getBoundingClientRect(),
        bubble.current.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        preferred,
      ),
    );
    const dismiss = () => hide();
    const keydown = (event) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    document.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("keydown", keydown);
    };
  }, [anchor, label, side]);
  const handler = (name, action) => (event) => {
    children.props[name]?.(event);
    action(event);
  };
  return (
    <>
      {cloneElement(children, {
        title: undefined,
        "aria-describedby":
          [children.props["aria-describedby"], anchor ? id : null]
            .filter(Boolean)
            .join(" ") || undefined,
        onPointerEnter: handler("onPointerEnter", show),
        onPointerLeave: handler("onPointerLeave", hide),
        onFocus: handler("onFocus", show),
        onBlur: handler("onBlur", hide),
        onClick: handler("onClick", hide),
      })}
      {anchor &&
        createPortal(
          <span
            ref={bubble}
            id={id}
            role="tooltip"
            className="flow-tooltip"
            data-side={position?.side}
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}
