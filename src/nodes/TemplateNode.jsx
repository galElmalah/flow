import React, { useContext } from "react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
import { Header, Socket } from "./NodeChrome.jsx";
import { templateParameters } from "../../shared/inspection.mjs";
export function TemplateNode({ id, data, selected }) {
  const { editNode, readOnly } = useContext(StudioContext);
  const fields = templateParameters(data.text);
  return (
    <div
      className={cls("studio-node template-node", selected && "is-selected")}
      style={{ "--accent": accents.template }}
    >
      <Header id={id} type="template" label={data.label} />
      <textarea
        readOnly={readOnly}
        className="prompt-text nodrag nowheel"
        aria-label={`${data.label} template`}
        placeholder="Scene: {{scene}}"
        value={data.text || ""}
        onChange={(e) => editNode(id, { text: e.target.value })}
      />
      <div className="template-fields">
        {fields.map((field) => (
          <span key={field}>{"{{" + field + "}}"}</span>
        ))}
      </div>
      <div className="node-foot">
        <span>Fields fill from each record</span>
        <span>{fields.length} fields</span>
      </div>
      <Socket type="text" top={105} label="Records / text" />
      <Socket type="image" top={145} label="Reference" />
      <Socket type="text" kind="source" top={125} label="Prompt" />
    </div>
  );
}
