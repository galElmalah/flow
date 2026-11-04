import React, { useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import { MoreHorizontal } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { icons, nodeNames, nodeDescriptions } from "./catalog.mjs";
import { Tooltip } from "../components/Tooltip.jsx";
export function Socket({ type, kind = "target", top, label }) {
  return (
    <Handle
      type={kind}
      position={kind === "target" ? Position.Left : Position.Right}
      id={type}
      style={{ top }}
      aria-label={`${label || type} ${kind}`}
    >
      <span className={cls("socket-label", kind)}>{label || type}</span>
    </Handle>
  );
}
export function Header({ id, type, label }) {
  const { menu, setMenu, readOnly, ruleCounts, inspectNode } =
    useContext(StudioContext);
  const Icon = icons[type];
  return (
    <div className="node-head">
      <Tooltip label={nodeDescriptions[type]}>
        <button
          className="node-type-icon node-type-help nodrag"
          aria-label={`About ${nodeNames[type]}: ${label || nodeNames[type]}`}
          onClick={(event) => {
            event.stopPropagation();
            inspectNode(id, { showHelp: true });
          }}
        >
          <Icon size={15} />
        </button>
      </Tooltip>
      <span className="node-title">{label || nodeNames[type]}</span>
      {ruleCounts?.get(id) > 0 && (
        <button
          className="node-rule-count nodrag"
          aria-label={`Inspect rules for ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            inspectNode(id);
          }}
        >
          {ruleCounts.get(id)} rules
        </button>
      )}
      <Tooltip label={`Options for ${label}`}>
        <button
          className="node-menu nodrag"
          disabled={readOnly}
          aria-label={`Options for ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenu(menu === id ? null : id);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </Tooltip>
    </div>
  );
}
