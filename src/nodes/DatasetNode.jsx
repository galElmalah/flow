import React, { useContext, useState, useRef } from "react";
import { ChevronDown, Upload, Trash2, FileJson } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
import { Header, Socket } from "./NodeChrome.jsx";
import { parseRecords } from "../../shared/records.mjs";
export function DatasetNode({ id, data, selected }) {
  const { editNode, promptOrigins, readOnly } = useContext(StudioContext),
    file = useRef(null),
    [error, setError] = useState("");
  const records = data.records || [];
  const editField = (index, key, value) =>
    editNode(id, {
      records: records.map((r, i) =>
        i === index ? { ...r, fields: { ...r.fields, [key]: value } } : r,
      ),
    });
  return (
    <div
      className={cls("studio-node dataset-node", selected && "is-selected")}
      style={{ "--accent": accents.dataset }}
    >
      <Header id={id} type="dataset" label={data.label} />
      {promptOrigins?.has(id) && (
        <div className="node-purpose">
          <strong>START HERE · PER-RECORD PROMPTS</strong>
          <br />
          Open a row to edit its brief or prompt.
        </div>
      )}
      <div className="dataset-heading">
        <FileJson size={17} />
        <div>
          <strong>{records.length} records</strong>
        </div>
        <button
          className="nodrag"
          disabled={readOnly}
          title="Import records"
          onClick={() => file.current.click()}
        >
          <Upload size={14} />
        </button>
      </div>
      <input
        ref={file}
        disabled={readOnly}
        type="file"
        accept=".csv,.json"
        hidden
        onChange={async (e) => {
          try {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 3 * 1024 * 1024)
              throw new Error("Import a file under 3 MB.");
            editNode(id, { records: parseRecords(await f.text()) });
            setError("");
          } catch (err) {
            setError(err.message);
          }
          e.target.value = "";
        }}
      />
      <div className="dataset-rows nodrag nowheel">
        {records.length ? (
          records.map((r, i) => (
            <details className="dataset-row" key={r.id}>
              <summary>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{r.fields.author || r.fields.title || r.id}</strong>
                  <p>
                    {r.fields.quote ||
                      r.fields.scene ||
                      Object.values(r.fields)[0]}
                  </p>
                </div>
                <ChevronDown size={11} />
              </summary>
              <div className="dataset-fields">
                <code>{r.fields.readingID || r.id}</code>
                {Object.entries(r.fields)
                  .filter(([key]) => key !== "readingID")
                  .map(([key, value]) => (
                    <label key={key}>
                      {key}
                      <textarea
                        aria-label={`${r.id} ${key}`}
                        readOnly={readOnly}
                        value={value}
                        onChange={(e) => editField(i, key, e.target.value)}
                      />
                    </label>
                  ))}
                <button
                  disabled={readOnly}
                  className="dataset-remove"
                  onClick={() =>
                    editNode(id, {
                      records: records.filter((_, index) => index !== i),
                    })
                  }
                >
                  <Trash2 size={11} />
                  Remove row
                </button>
              </div>
            </details>
          ))
        ) : (
          <div className="dataset-empty">
            Import a CSV or JSON file.
            <br />
            Columns become template fields.
          </div>
        )}
      </div>
      {error && <p className="dataset-error">{error}</p>}
      <button
        disabled={readOnly}
        className="replace-image nodrag"
        onClick={() => file.current.click()}
      >
        <Upload size={12} />
        Import CSV / JSON<span>↥</span>
      </button>
      <Socket type="text" kind="source" top={140} label="Records" />
    </div>
  );
}
