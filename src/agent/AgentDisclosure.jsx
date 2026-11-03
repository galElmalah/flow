import React, { useId } from "react";

export function AgentDisclosure({
  open,
  onToggle,
  summary,
  children,
  className = "",
  ...props
}) {
  const panelId = useId();
  return (
    <div
      className={`agent-disclosure ${className}`}
      data-open={open}
      {...props}
    >
      <button
        type="button"
        className="agent-disclosure-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {summary}
      </button>
      <div
        className="agent-disclosure-reveal"
        id={panelId}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="agent-disclosure-inner">{children}</div>
      </div>
    </div>
  );
}
