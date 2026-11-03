import React, { useEffect, useState } from "react";
import { HarnessLogo, UsageBadge } from "../harnesses/HarnessLogo.jsx";
import {
  Search,
  Terminal,
  Sparkles,
  Globe,
  Check,
  ArrowUpRight,
} from "lucide-react";
const kindLabel = {
  ollama: "LOCAL TEXT MODEL",
  comfyui: "LOCAL MEDIA MODEL",
  grok: "XAI MEDIA API",
  fal: "FAL MEDIA API",
  "gemini-video": "GOOGLE VIDEO API",
  codex: "CODEX CLI",
  command: "LOCAL COMMAND",
  "image-api": "IMAGES API",
  harness: "PROMPT HARNESS",
  compatible: "OPENAI COMPATIBLE",
};
const kindIcon = {
  ollama: Terminal,
  comfyui: Terminal,
  grok: Globe,
  fal: Globe,
  "gemini-video": Globe,
  codex: Sparkles,
  command: Terminal,
  "image-api": Globe,
  harness: Terminal,
  compatible: Globe,
};
export const modelsFor = (p, kind) =>
  p?.modelDetails
    ? p.modelDetails
        .filter((m) => m.capabilities.includes(kind))
        .map((m) => m.id)
    : p?.models || [];
export const nodeForProvider = (p) =>
  p.capabilities?.includes("video")
    ? "video-generate"
    : p.capabilities?.includes("image")
      ? "generate"
      : "prompt-generate";
export function ProviderPicker({
  usage,
  providers,
  current,
  onChoose,
  operation = "image",
}) {
  useEffect(() => {
    usage?.load();
  }, [usage?.load]);
  const [query, setQuery] = useState("");
  const filtered = providers
    .filter(
      (p) =>
        modelsFor(p, operation).length ||
        (["ollama", "comfyui"].includes(p.kind) &&
          p.capabilities?.includes(operation)),
    )
    .filter((p) =>
      `${p.name} ${p.description} ${p.models.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  return (
    <>
      <span className="eyebrow">ONE CANVAS. YOUR CHOICE OF ENGINE.</span>
      <h2>Choose what runs this node.</h2>
      <p>
        Branch the same seed across different providers. Each node keeps its own
        model and settings.
      </p>
      <label className="search-field provider-search">
        <Search size={15} />
        <input
          autoFocus
          placeholder="Search providers or models…"
          aria-label="Search providers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="provider-list">
        {filtered.map((p) => {
          const Icon = kindIcon[p.kind] || Globe;
          return (
            <button
              key={p.id}
              disabled={
                !p.ready &&
                !["grok", "fal", "ollama", "comfyui"].includes(p.kind)
              }
              className={`provider-choice ${current === p.id ? "chosen" : ""}`}
              onClick={() => onChoose(p)}
            >
              <span className="provider-choice-icon">
                {p.kind === "command" ? (
                  <Icon size={21} />
                ) : (
                  <HarnessLogo id={p.id} />
                )}
              </span>
              <span className="provider-choice-copy">
                <small>{kindLabel[p.kind]}</small>
                <strong>{p.name}</strong>
                <span>{p.description}</span>
                <footer>
                  <span className={`status-dot ${p.ready ? "ready" : ""}`} />
                  {p.status}
                  <b>
                    {operation === "video"
                      ? ["command", "comfyui"].includes(p.kind)
                        ? "Video generation · local execution"
                        : "Video generation · API billing"
                      : operation === "text"
                        ? "Prompt generation"
                        : p.seeded
                          ? "Seeded"
                          : "Variation labels"}
                  </b>
                </footer>
              </span>
              <UsageBadge report={usage?.report} providerId={p.id} />
              {current === p.id ? (
                <Check size={17} />
              ) : (
                <ArrowUpRight size={16} />
              )}
            </button>
          );
        })}
        {!filtered.length && (
          <p className="setting-note" role="status">
            No matching {operation === "text" ? "prompt" : operation} providers.
            Try another search or add a compatible API in Settings.
          </p>
        )}
      </div>
      <div className="provider-picker-note">
        <Terminal size={14} />
        <span>
          <a href="/settings/local-models">Set up local models ↗</a>, add a
          compatible API in Settings, or a custom local harness in{" "}
          <code>.flow/providers.json</code>, then reload providers in settings.
        </span>
      </div>
    </>
  );
}
