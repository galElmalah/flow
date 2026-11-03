import React from "react";

export function RecordInputs({ records, onChange, readOnly }) {
  const priority = ["brief", "prompt", "scene", "meaning", "quote"];
  return (
    <section className="record-inputs" aria-label="Record inputs">
      <h3>{records.length} source records</h3>
      <p>Each row becomes its own prompt. Edit its brief or scene here.</p>
      {records.map((record, index) => (
        <details key={record.id} open={index === 0}>
          <summary>
            {record.fields.author || record.fields.title || record.id}
            <small>{record.id}</small>
          </summary>
          {Object.entries(record.fields)
            .sort(
              ([a], [b]) =>
                (priority.includes(a) ? priority.indexOf(a) : 99) -
                (priority.includes(b) ? priority.indexOf(b) : 99),
            )
            .map(([key, value]) => (
              <label key={key}>
                {key}
                <textarea
                  rows={priority.includes(key) ? 5 : 2}
                  aria-label={`Record ${record.id} ${key}`}
                  value={String(value ?? "")}
                  readOnly={readOnly}
                  onChange={(event) =>
                    onChange(
                      records.map((r, i) =>
                        i === index
                          ? {
                              ...r,
                              fields: {
                                ...r.fields,
                                [key]: event.target.value,
                              },
                            }
                          : r,
                      ),
                    )
                  }
                />
              </label>
            ))}
        </details>
      ))}
    </section>
  );
}
