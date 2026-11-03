import React, { useContext } from "react";
import { Maximize } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
export function SectionNode({ id, data }) {
  const { focusNodes } = useContext(StudioContext);
  return (
    <div
      className={cls("flow-section", `flow-section-${data.tone || "neutral"}`)}
      style={{
        width: data.width || 1200,
        height: data.height || 650,
        "--accent":
          data.tone === "quote"
            ? accents.dataset
            : data.tone === "cover"
              ? accents.filter
              : accents.section,
      }}
    >
      <header className="nodrag">
        <div>
          <strong>{data.label}</strong>
          <p>{data.subtitle}</p>
        </div>
        <button
          className="nodrag"
          aria-label={`Focus ${data.label}`}
          onClick={() => focusNodes([id, ...(data.members || [])])}
        >
          <Maximize size={14} />
          Focus flow
        </button>
      </header>
    </div>
  );
}
