import React from "react";
import { cls } from "../studio/ui.mjs";
import { Tooltip } from "./Tooltip.jsx";
export function IconButton({
  label,
  children,
  active = false,
  className,
  ...props
}) {
  return (
    <Tooltip label={label}>
      <button
        className={cls("icon-button", active && "active", className)}
        aria-label={label}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}
