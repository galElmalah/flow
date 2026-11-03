import React, { useContext } from "react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
import { Header, Socket } from "./NodeChrome.jsx";
export function PromptNode({ id, data, selected }) {
  const { editNode, promptOrigins, readOnly } = useContext(StudioContext);
  return (
    <div
      className={cls("studio-node prompt-node", selected && "is-selected")}
      style={{ "--accent": accents.prompt }}
    >
      <Header id={id} type="prompt" label={data.label} />
      {(promptOrigins?.has(id) || !data.text?.trim()) && (
        <div className="node-purpose">
          {promptOrigins?.has(id) ? (
            <>
              <strong>START HERE · BASE PROMPT</strong>
              <br />
              Shared direction for connected flows
            </>
          ) : (
            "Optional direction · empty, adds no text"
          )}
        </div>
      )}
      <textarea
        className="prompt-text nodrag nowheel"
        readOnly={readOnly}
        aria-label={`${data.label} prompt`}
        placeholder="Enter a prompt…"
        value={data.text || ""}
        onChange={(e) => editNode(id, { text: e.target.value })}
      />
      <Socket type="image" top={82} label="Reference" />
      <Socket type="text" top={120} label="Text" />
      <Socket type="text" kind="source" top={106} label="Prompt" />
    </div>
  );
}
