import React, { useEffect, useState } from "react";
import { Search, Plus, RefreshCw, ChevronRight } from "lucide-react";
import { HarnessLogo, UsageBadge } from "../harnesses/HarnessLogo.jsx";
import { usageIsStale } from "../../shared/harness-usage.mjs";
import { ConnectionForm } from "./ConnectionForm.jsx";
import { OllamaSettings } from "./OllamaSettings.jsx";
import { CodexSettings } from "./CodexSettings.jsx";
import { FalSettings } from "./FalSettings.jsx";
import { GrokSettings } from "./GrokSettings.jsx";
import { GeminiVideoSettings } from "./GeminiVideoSettings.jsx";

const families = [
  { id: "codex", name: "Codex", ids: ["codex-text", "codex"] },
  { id: "claude-code", name: "Claude Code", ids: ["claude-code"] },
  { id: "gemini-cli", name: "Gemini", ids: ["gemini-cli", "gemini-video"] },
  { id: "fal-image", name: "fal", ids: ["fal-image", "fal-video"] },
  { id: "grok-image", name: "Grok", ids: ["grok-image", "grok-video"] },
  { id: "pi", name: "Pi", ids: ["pi"] },
  { id: "ollama", name: "Ollama", ids: ["ollama"] },
  {
    id: "comfyui-image",
    name: "ComfyUI",
    ids: ["comfyui-image", "comfyui-video"],
  },
  {
    id: "local-color",
    name: "Local tools",
    ids: ["local-color", "local-recolor"],
  },
];
async function request(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Provider request failed.");
  return value;
}

export function ProvidersSettings({
  providers,
  usage,
  onReload,
  onChange,
  configPath,
  onExample,
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    usage?.load();
  }, [usage?.load]);
  const known = new Set(families.flatMap((family) => family.ids));
  const groups = [
    ...families,
    ...providers
      .filter((p) => !known.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, ids: [p.id] })),
  ]
    .map((group) => ({
      ...group,
      entries: group.ids.flatMap((id) => providers.filter((p) => p.id === id)),
    }))
    .filter((group) => group.entries.length)
    .filter((group) =>
      `${group.name} ${group.entries.map((p) => `${p.name} ${p.models.join(" ")} ${p.kind}`).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const reload = async () => {
    setBusy(true);
    setError("");
    try {
      await onReload();
      await usage?.load(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (editing)
    return (
      <div className="providers-settings">
        <h2>{editing.id ? "Edit connection" : "Add connection"}</h2>
        <ConnectionForm
          key={editing.id || "new"}
          provider={editing}
          onCancel={() => setEditing(null)}
          onSave={async (body) => {
            onChange(
              await request(
                `/api/providers/connections${editing.id ? `/${editing.id}` : ""}`,
                editing.id ? "PUT" : "POST",
                body,
              ),
            );
            setEditing(null);
            setMessage("Connection saved.");
          }}
        />
      </div>
    );
  return (
    <div className="providers-settings">
      <header className="providers-heading">
        <div>
          <h2>Providers</h2>
        </div>
        <div className="providers-heading-actions">
          <button
            className="icon-button"
            aria-label="Refresh providers"
            title="Refresh providers"
            disabled={busy}
            onClick={reload}
          >
            <RefreshCw size={15} className={busy ? "spin" : ""} />
          </button>
          <button
            className="settings-button"
            onClick={() => {
              setEditing({});
              setError("");
              setMessage("");
            }}
          >
            <Plus size={14} /> Add API
          </button>
        </div>
      </header>
      <label className="providers-search">
        <Search size={15} />
        <input
          aria-label="Search providers and models"
          placeholder="Search providers or models"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="providers-list">
        {groups.map((group) => {
          const primary = group.entries[0];
          const open = expanded === group.id;
          const account = usage?.report?.accounts.find((a) =>
            a.providerIds.some((id) => group.ids.includes(id)),
          );
          const ready = group.entries.filter((p) => p.ready).length;
          return (
            <section
              className={`provider-row ${open ? "is-open" : ""}`}
              key={group.id}
            >
              <button
                className="provider-row-toggle"
                aria-expanded={open}
                aria-controls={`provider-details-${group.id}`}
                onClick={() => {
                  setExpanded(open ? null : group.id);
                  setError("");
                }}
              >
                <HarnessLogo id={group.id} size={24} />
                <span className="provider-row-name">
                  <strong>{group.name}</strong>
                  <small>
                    {primary.managed
                      ? primary.baseUrl
                      : group.id === "codex"
                        ? primary.authMethod === "api-key"
                          ? "API key"
                          : "Codex CLI"
                        : group.entries.some((p) => p.kind === "harness")
                          ? "Local harness"
                          : group.entries.some((p) =>
                                ["ollama", "comfyui", "command"].includes(
                                  p.kind,
                                ),
                              )
                            ? "Local"
                            : "API"}
                  </small>
                </span>
                <span className="provider-row-status">
                  {ready ? "Connected" : "Set up"}
                </span>
                {account?.windows?.length > 0 && (
                  <UsageBadge report={usage.report} providerId={primary.id} />
                )}
                <ChevronRight size={14} />
              </button>
              {open && (
                <div
                  className="provider-row-details"
                  id={`provider-details-${group.id}`}
                >
                  {group.id === "codex" ? (
                    <CodexSettings onReload={reload} />
                  ) : group.id === "fal-image" ? (
                    <FalSettings onReload={reload} />
                  ) : group.id === "grok-image" ? (
                    <GrokSettings onReload={reload} />
                  ) : group.id === "gemini-cli" ? (
                    <>
                      <p>
                        {
                          group.entries.find((p) => p.id === "gemini-cli")
                            ?.status
                        }
                      </p>
                      <GeminiVideoSettings onReload={reload} />
                    </>
                  ) : group.id === "ollama" ? (
                    <OllamaSettings provider={primary} />
                  ) : primary.managed ? (
                    <>
                      <p>
                        {primary.hasApiKey ? "API key saved" : "No API key"} ·{" "}
                        {primary.models.join(", ")}
                      </p>
                      <div className="provider-inline-actions">
                        <button onClick={() => setEditing(primary)}>
                          Edit connection
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const result = await request(
                                `/api/providers/connections/${primary.id}/test`,
                                "POST",
                                {},
                              );
                              setMessage(result.message);
                              setError("");
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                        >
                          Test
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              onChange(
                                await request(
                                  `/api/providers/connections/${primary.id}`,
                                  "DELETE",
                                ),
                              );
                              setExpanded(null);
                              setMessage("Connection removed.");
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {group.entries.map((p) => (
                        <p key={p.id}>
                          {p.name} · {p.status}
                        </p>
                      ))}
                      {group.entries.some((p) => p.local) && (
                        <a href="/settings/local-models">
                          Manage local models ↗
                        </a>
                      )}
                    </>
                  )}
                  {account?.windows?.length > 0 && (
                    <div
                      className="provider-compact-usage"
                      aria-label={`${group.name} account usage`}
                    >
                      {account.windows.map((w) => (
                        <p key={w.id}>
                          {w.label}{" "}
                          <span>
                            {Math.round(w.usedPercent)}% used
                            {usageIsStale(account) ? " · last reported" : ""}
                            {w.resetAt
                              ? ` · resets ${new Date(w.resetAt).toLocaleString()}`
                              : ""}
                          </span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {!groups.length && <p role="status">No matching providers.</p>}
      </div>
      <details className="providers-advanced">
        <summary>Custom harness</summary>
        <p>
          Add a command provider in <code>{configPath}</code>, then refresh.
        </p>
        <button onClick={onExample}>Connector example ↗</button>
      </details>
    </div>
  );
}
