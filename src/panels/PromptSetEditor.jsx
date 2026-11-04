import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Copy, Upload, Play, RotateCcw } from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { Tooltip } from "../components/Tooltip.jsx";
import { jsonRequest } from "../studio/ui.mjs";
import {
  defaultPromptTemplate,
  promptItemsSchema,
  promptItemJobs,
  promptItemStatus,
} from "../../shared/prompt-sets.mjs";
import { ratioSchema } from "../../shared/generation-modes.mjs";
import "../prompt-sets.css";

export function PromptSetEditor({
  node,
  graph,
  jobs,
  itemId,
  readOnly,
  starting,
  onChange,
  onRun,
  onOpenImage,
}) {
  const items = node.data.prompts || [];
  const [chosen, setChosen] = useState(itemId || items[0]?.id),
    [tab, setTab] = useState("scene"),
    [preview, setPreview] = useState(null),
    [error, setError] = useState("");
  const file = useRef(null),
    list = useRef(null);
  const item = items.find((item) => item.id === chosen) || items[0];
  useEffect(() => {
    if (itemId) {
      setChosen(itemId);
      setTab("scene");
    }
  }, [itemId]);
  useEffect(() => {
    const container = list.current;
    const row = container?.querySelector('[aria-pressed="true"]');
    if (!row) return;
    const bounds = container.getBoundingClientRect();
    const selected = row.getBoundingClientRect();
    if (selected.top < bounds.top)
      container.scrollTop += selected.top - bounds.top;
    else if (selected.bottom > bounds.bottom)
      container.scrollTop += selected.bottom - bounds.bottom;
  }, [item?.id]);
  const itemJobs = item ? promptItemJobs(jobs, node.id, item.id) : [];
  const outputs = itemJobs.filter(
    (job) => job.status === "completed" && job.output && job.kind !== "text",
  );
  const enabled = items.filter((item) => item.enabled !== false);
  const failed = enabled.filter((item) =>
    promptItemJobs(jobs, node.id, item.id).some(
      (job) => job.status === "failed",
    ),
  );
  const run = (ids) =>
    onRun(undefined, { promptSet: { nodeId: node.id, itemIds: ids } });
  const changeItem = (patch) =>
    onChange({
      prompts: items.map((row) =>
        row.id === item.id ? { ...row, ...patch } : row,
      ),
    });
  const numeric = (event, target, key) =>
    target({
      [key]: event.target.value === "" ? undefined : Number(event.target.value),
    });
  useEffect(() => {
    setPreview(null);
    setError("");
    if (tab !== "resolved" || !item || readOnly) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const value = await jsonRequest("/api/prompt-sets/preview", {
          method: "POST",
          body: JSON.stringify({
            workflow: graph,
            nodeId: node.id,
            itemId: item.id,
          }),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setPreview(value);
      } catch (error) {
        if (!controller.signal.aborted) setError(error.message);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tab, graph.nodes, graph.edges, node.id, item?.id, readOnly]);
  const settings = (data, change, inherited) => (
    <div className="prompt-set-settings">
      <label>
        Copies
        <input
          aria-label={`${inherited ? "Scene" : "Shared"} copies`}
          type="number"
          min="1"
          max="500"
          step="1"
          readOnly={readOnly}
          placeholder={
            inherited
              ? `Shared · ${node.data.count ?? "generator"}`
              : "Generator"
          }
          value={data.count ?? ""}
          onChange={(e) => numeric(e, change, "count")}
        />
      </label>
      <label>
        Seed label
        <input
          aria-label={`${inherited ? "Scene" : "Shared"} seed`}
          type="number"
          min="0"
          max="2147483647"
          step="1"
          readOnly={readOnly}
          placeholder="Inherited"
          value={data.seed ?? ""}
          onChange={(e) => numeric(e, change, "seed")}
        />
      </label>
      <label>
        Aspect ratio
        <Autocomplete
          label={`${inherited ? "Scene" : "Shared"} aspect ratio`}
          value={data.ratio || "inherit"}
          disabled={readOnly}
          options={[
            {
              value: "inherit",
              label: inherited
                ? `Shared · ${node.data.ratio || "generator"}`
                : "Use generator",
            },
            ...ratioSchema.options.map((value) => ({ value, label: value })),
          ]}
          onChange={(value) =>
            change({ ratio: value === "inherit" ? undefined : value })
          }
        />
      </label>
    </div>
  );
  const add = (duplicate) => {
    const next = duplicate
      ? {
          ...structuredClone(item),
          id: crypto.randomUUID(),
          label: `${item.label.slice(0, 110)} · copy`,
        }
      : { id: crypto.randomUUID(), label: "New scene", scene: "", concept: "" };
    onChange({ prompts: [...items, next] });
    setChosen(next.id);
    setTab("scene");
  };
  return (
    <section className="prompt-set-editor" aria-label="Prompt Set editor">
      <div className="prompt-set-toolbar">
        <strong>{items.length} scenes</strong>
        <Tooltip label="Add scene">
          <button
            aria-label="Add scene"
            disabled={readOnly || items.length >= 500}
            onClick={() => add(false)}
          >
            <Plus size={14} />
          </button>
        </Tooltip>
        <Tooltip label="Import scene JSON">
          <button
            aria-label="Import scene JSON"
            disabled={readOnly}
            onClick={() => file.current.click()}
          >
            <Upload size={14} />
          </button>
        </Tooltip>
      </div>
      <input
        hidden
        ref={file}
        type="file"
        accept=".json"
        onChange={async (event) => {
          try {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 3 * 1024 * 1024)
              throw new Error("Import a JSON file under 3 MB.");
            const prompts = promptItemsSchema.parse(
              JSON.parse(await file.text()),
            );
            onChange({ prompts });
            setChosen(prompts[0]?.id);
            setError("");
          } catch (error) {
            setError(error.message);
          } finally {
            event.target.value = "";
          }
        }}
      />
      <div
        ref={list}
        className="prompt-set-editor-list"
        aria-label="Scene list"
      >
        {items.map((row) => (
          <div className="prompt-set-editor-row" key={row.id}>
            <input
              type="checkbox"
              aria-label={`Include ${row.label} in batch`}
              disabled={readOnly}
              checked={row.enabled !== false}
              onChange={(e) =>
                onChange({
                  prompts: items.map((item) =>
                    item.id === row.id
                      ? { ...item, enabled: e.target.checked }
                      : item,
                  ),
                })
              }
            />
            <button
              aria-pressed={item?.id === row.id}
              onClick={() => {
                setChosen(row.id);
                setTab("scene");
              }}
            >
              <strong>{row.label}</strong>
              <small>
                {promptItemStatus(promptItemJobs(jobs, node.id, row.id))}
              </small>
            </button>
          </div>
        ))}
      </div>
      <div
        className="prompt-set-tabs"
        role="tablist"
        aria-label="Prompt Set details"
      >
        {[
          ["scene", "Scene"],
          ["shared", "Shared"],
          ["resolved", "Final prompt"],
          ["results", "Results"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="prompt-set-error" role="alert">
          {error}
        </p>
      )}
      {tab === "shared" ? (
        <>
          <label>
            Shared scene template
            <textarea
              aria-label="Shared scene template"
              rows="7"
              readOnly={readOnly}
              value={node.data.text ?? defaultPromptTemplate}
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </label>
          <p className="prompt-set-help">
            Use {"{{scene}}"}, {"{{concept}}"}, {"{{title}}"} or {"{{input}}"}.
            Connected shared direction is included once per scene.
          </p>
          {settings(node.data, onChange, false)}
          <p className="prompt-set-help">
            Blank settings inherit from the generator. Scene overrides take
            precedence. Seed behavior depends on the provider.
          </p>
        </>
      ) : item ? (
        <>
          {tab === "scene" && (
            <>
              <div className="prompt-set-item-heading">
                <code>{item.id}</code>
                <Tooltip label="Duplicate scene">
                  <button
                    aria-label="Duplicate scene"
                    disabled={readOnly || items.length >= 500}
                    onClick={() => add(true)}
                  >
                    <Copy size={13} />
                  </button>
                </Tooltip>
                <Tooltip label="Remove scene">
                  <button
                    aria-label="Remove scene"
                    disabled={readOnly}
                    onClick={() =>
                      onChange({
                        prompts: items.filter((row) => row.id !== item.id),
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </Tooltip>
              </div>
              <label>
                Scene name
                <input
                  aria-label="Scene name"
                  readOnly={readOnly}
                  value={item.label}
                  onChange={(e) => changeItem({ label: e.target.value })}
                />
              </label>
              <label>
                Scene prompt
                <textarea
                  aria-label="Scene prompt"
                  readOnly={readOnly}
                  rows="6"
                  value={item.scene}
                  onChange={(e) => changeItem({ scene: e.target.value })}
                />
              </label>
              <label>
                Concept
                <textarea
                  aria-label="Scene concept"
                  readOnly={readOnly}
                  rows="3"
                  value={item.concept || ""}
                  onChange={(e) => changeItem({ concept: e.target.value })}
                />
              </label>
              {settings(item, changeItem, true)}
              <p className="prompt-set-help">
                Clear an override to inherit shared settings.
              </p>
            </>
          )}
          {tab === "resolved" &&
            (error ? null : (readOnly
                ? itemJobs.map((job) => ({ ...job, count: 1 }))
                : preview?.variants
              )?.length ? (
              (readOnly ? itemJobs : preview.variants).map((variant, i) => (
                <section key={i} className="prompt-set-preview">
                  <h4>
                    {variant.label} · {variant.providerId}
                  </h4>
                  <small>
                    {variant.model || "Provider default"} · {variant.ratio} ·
                    first seed #{variant.seed} · {variant.count ?? 1} copies
                  </small>
                  <p className="prompt-set-resolved">
                    {variant.prompt ||
                      "Prompt depends on an upstream AI writer."}
                  </p>
                  {variant.promptParts?.some((part) => part.jobId) && (
                    <p className="prompt-set-help">
                      The upstream AI writer will supply additional text at run
                      time.
                    </p>
                  )}
                  <div className="prompt-set-references">
                    {variant.images
                      ?.filter((ref) => ref.asset)
                      .map((ref) => (
                        <a
                          key={ref.asset}
                          href={ref.asset}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img src={ref.asset} alt="Scene reference" />
                        </a>
                      ))}
                  </div>
                </section>
              ))
            ) : (
              <p className="prompt-set-help">Preparing prompt preview…</p>
            ))}
          {tab === "results" && (
            <>
              <p className="prompt-set-help">
                Results retain their recorded prompt, settings and lineage.
                Editing this scene does not change existing images.
              </p>
              {outputs.length ? (
                <div className="prompt-set-results">
                  {outputs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() =>
                        onOpenImage({ ...job, collection: outputs })
                      }
                    >
                      {job.kind === "video" ? (
                        <video src={job.output} muted />
                      ) : (
                        <img src={job.output} alt={item.label} />
                      )}
                      <span>
                        {job.providerId} · #{job.seed}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="prompt-set-help">
                  No generated images for this scene yet.
                </p>
              )}
              {itemJobs
                .filter((job) => job.error)
                .map((job) => (
                  <p key={job.id} className="prompt-set-error">
                    {job.error}
                  </p>
                ))}
            </>
          )}
        </>
      ) : (
        <p className="prompt-set-help">Add a scene to start your collection.</p>
      )}
      <div className="prompt-set-run-actions">
        <button
          disabled={readOnly || starting || !item || item.enabled === false}
          onClick={() => run([item.id])}
        >
          <Play size={12} />
          Run this scene
        </button>
        <button
          disabled={readOnly || starting || !enabled.length}
          onClick={() => run(enabled.map((item) => item.id))}
        >
          <Play size={12} />
          Run enabled ({enabled.length})
        </button>
        {failed.length > 0 && (
          <button
            disabled={readOnly || starting}
            onClick={() => run(failed.map((item) => item.id))}
          >
            <RotateCcw size={12} />
            Rerun failed scenes ({failed.length})
          </button>
        )}
      </div>
    </section>
  );
}
