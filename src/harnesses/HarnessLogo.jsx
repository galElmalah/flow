import React from "react";
import { Cpu, Globe } from "lucide-react";
import { usageIsStale } from "../../shared/harness-usage.mjs";

const brands = {
  ollama: { asset: "ollama-light", color: "#F1F0E8" },
  fal: { asset: "fal-color", color: "#EC0648" },
  bytedance: { asset: "bytedance-color", color: "#3C8CFF" },
  flux: { asset: "flux-light", color: "#F1F0E8" },
  grok: { asset: "grok-light", color: "#F1F0E8" },
  codex: { asset: "codex-color", color: "#7A9DFF" },
  claudecode: { asset: "claudecode-color", color: "#D97757" },
  claude: { asset: "claude-color", color: "#D97757" },
  geminicli: { asset: "geminicli-color", color: "#3186FF" },
  gemini: { asset: "gemini-color", color: "#3186FF" },
  pi: { asset: "pi-color", color: "#F09082" },
  openai: { asset: "openai-light", color: "#F1F0E8" },
};

export function harnessBrand(id, { model = false, modelId = "" } = {}) {
  const harness = {
    codex: "codex",
    "codex-text": "codex",
    "claude-code": "claudecode",
    "gemini-cli": "geminicli",
    "gemini-video": "gemini",
    "fal-image": "fal",
    "fal-video": "fal",
    "grok-image": "grok",
    "grok-video": "grok",
    pi: "pi",
    ollama: "ollama",
    "ollama-text": "ollama",
  }[id];
  const family = /bytedance\/(seedance|seedream)/i.test(modelId)
    ? "bytedance"
    : /flux/i.test(modelId)
      ? "flux"
      : /^grok/i.test(modelId)
        ? "grok"
        : /^claude/i.test(modelId)
          ? "claude"
          : /^gemini/i.test(modelId)
            ? "gemini"
            : /^(gpt|o[134]|codex)/i.test(modelId)
              ? "openai"
              : null;
  const mark = model
    ? family ||
      {
        codex: "openai",
        claudecode: "claude",
        geminicli: "gemini",
        gemini: "gemini",
        grok: "grok",
        fal: "fal",
        pi: "pi",
        ollama: "ollama",
      }[harness]
    : harness;
  return brands[mark];
}

export function HarnessLogo({ id, size = 22, model = false, modelId = "" }) {
  const brand = harnessBrand(id, { model, modelId });
  if (["comfyui-image", "comfyui-video"].includes(id))
    return <Cpu aria-hidden="true" size={size} />;
  if (!brand) return <Globe aria-hidden="true" size={size} />;
  return (
    <img
      className="harness-brand-mark"
      src={`/harnesses/${brand.asset}.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size,
        height: size,
        objectFit: "contain",
      }}
    />
  );
}

export function UsageBadge({ report, providerId }) {
  const account = report?.accounts.find((account) =>
    account.providerIds.includes(providerId),
  );
  const window = account?.windows[0];
  if (!account) return null;
  const stale = usageIsStale(account);
  const label = window
    ? `${Math.round(window.usedPercent)}% used · ${window.label}${stale ? " · last reported" : ""}`
    : account.message;
  return (
    <span
      className={`harness-usage-badge ${stale ? "is-stale" : ""}`}
      title={label}
      aria-label={label}
    >
      {window ? `${stale ? "~" : ""}${Math.round(window.usedPercent)}%` : "—"}
    </span>
  );
}
