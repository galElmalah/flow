import React, { useContext, useState, useEffect } from "react";
import { Shuffle } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
import { Header, Socket } from "./NodeChrome.jsx";
export function FilterNode({ id, data, selected }) {
  const { editNode, plan, readOnly } = useContext(StudioContext);
  const [values, setValues] = useState((data.filterValues || []).join(", "));
  useEffect(
    () => setValues((data.filterValues || []).join(", ")),
    [data.filterValues],
  );
  return (
    <div
      className={cls("studio-node filter-node", selected && "is-selected")}
      style={{ "--accent": accents.filter }}
    >
      <Header id={id} type="filter" label={data.label} />
      <div className="filter-form nodrag">
        <label>
          Keep records where
          <input
            readOnly={readOnly}
            aria-label={`${data.label} field`}
            value={data.filterField || ""}
            placeholder="role"
            onChange={(e) => editNode(id, { filterField: e.target.value })}
          />
        </label>
        <label>
          is one of
          <input
            readOnly={readOnly}
            aria-label={`${data.label} values`}
            value={values}
            placeholder="category, journey"
            onChange={(e) => setValues(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) =>
              editNode(id, {
                filterValues: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </div>
      <div className="node-foot">
        <span>
          <Shuffle size={11} /> Route by field
        </span>
        <span>{plan?.contexts?.[id] ?? "—"} records</span>
      </div>
      <Socket type="text" top={98} label="Records" />
      <Socket type="text" kind="source" top={98} label="Matched" />
    </div>
  );
}
