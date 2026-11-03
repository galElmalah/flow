import React, { useContext } from "react";
import { Layers } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
import { Header, Socket } from "./NodeChrome.jsx";
export function VariationsNode({ id, data, selected }) {
  const { editNode, readOnly } = useContext(StudioContext);
  const lines = (data.lines || "").split("\n").filter((x) => x.trim());
  return (
    <div
      className={cls("studio-node variation-node", selected && "is-selected")}
      style={{ "--accent": accents.variations }}
    >
      <Header id={id} type="variations" label={data.label} />
      <div className="variant-editor">
        <div className="line-numbers">
          {(data.lines || "").split("\n").map((_, i) => (
            <span key={i}>{String(i + 1).padStart(2, "0")}</span>
          ))}
        </div>
        <textarea
          readOnly={readOnly}
          className="nodrag nowheel"
          aria-label={`${data.label} variations`}
          placeholder={"Warm amber + soft violet\nDeep blue + pale peach"}
          value={data.lines || ""}
          onChange={(e) => editNode(id, { lines: e.target.value })}
        />
      </div>
      <div className="node-foot">
        <span>
          <Layers size={12} />
          {lines.length} variations
        </span>
        <span>One per line</span>
      </div>
      <Socket type="text" top={116} label="Prompt" />
      <Socket type="text" kind="source" top={116} label="Variants" />
    </div>
  );
}
