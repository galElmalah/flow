import { readCodexUsage } from "./codex/usage.mjs";
import { readClaudeUsage } from "./claude-code/usage.mjs";
import { readGeminiUsage } from "./gemini/usage.mjs";
import { readPiUsage } from "./pi/usage.mjs";
import { fileURLToPath } from "node:url";
import { usageIsStale } from "../shared/harness-usage.mjs";

const claudeStatusline = fileURLToPath(
  new URL("./claude-code/usage-statusline.mjs", import.meta.url),
);
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const accounts = [
  {
    id: "codex",
    name: "Codex",
    providerIds: ["codex", "codex-text"],
    billing: "subscription",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    providerIds: ["claude-code"],
    billing: "subscription",
    setup: {
      statusLine: {
        type: "command",
        command: `${shellQuote(process.execPath)} ${shellQuote(claudeStatusline)}`,
      },
    },
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    providerIds: ["gemini-cli"],
    billing: "subscription",
  },
  { id: "pi", name: "Pi", providerIds: ["pi"], billing: "provider" },
];
const readers = {
  codex: readCodexUsage,
  "claude-code": readClaudeUsage,
  "gemini-cli": readGeminiUsage,
  pi: readPiUsage,
};
const safeText = (value, fallback = "") =>
  typeof value === "string" ? value.slice(0, 500) : fallback;
const present = (account, value, now) => ({
  ...account,
  ...value,
  stale: usageIsStale(value, now),
});

// The public response is allowlisted. Raw CLI payloads and credentials never leave adapters.
export function publicUsage(value) {
  const windows = (Array.isArray(value?.windows) ? value.windows : []).flatMap(
    (window) => {
      if (
        typeof window.usedPercent !== "number" ||
        !Number.isFinite(window.usedPercent) ||
        window.usedPercent < 0 ||
        window.usedPercent > 100
      )
        return [];
      const reset =
        typeof window.resetAt === "string" ? Date.parse(window.resetAt) : NaN;
      return [
        {
          id: safeText(window.id),
          label: safeText(window.label),
          usedPercent: window.usedPercent,
          ...(Number.isFinite(reset)
            ? { resetAt: new Date(reset).toISOString() }
            : {}),
          ...(Number.isFinite(window.windowMinutes) && window.windowMinutes > 0
            ? { windowMinutes: window.windowMinutes }
            : {}),
        },
      ];
    },
  );
  const status = ["available", "unavailable", "error"].includes(value?.status)
    ? value.status
    : "error";
  return {
    status: status === "available" && !windows.length ? "unavailable" : status,
    source: safeText(value?.source),
    message: safeText(value?.message),
    windows,
    ...(value?.plan ? { plan: safeText(value.plan) } : {}),
    ...(["api", "subscription"].includes(value?.billing)
      ? { billing: value.billing }
      : {}),
    ...(Number.isFinite(Date.parse(value?.fetchedAt))
      ? { reportedAt: new Date(value.fetchedAt).toISOString() }
      : {}),
  };
}

export class HarnessUsage {
  constructor({
    adapters = readers,
    codex,
    now = Date.now,
    ttlMs = 60000,
    minimumRefreshMs = 10000,
  } = {}) {
    this.adapters = { ...adapters, ...(codex && { codex }) };
    this.now = now;
    this.ttlMs = ttlMs;
    this.minimumRefreshMs = minimumRefreshMs;
    this.cache = new Map();
    this.pending = new Map();
    this.versions = new Map();
  }
  invalidate(id) {
    this.versions.set(id, (this.versions.get(id) || 0) + 1);
    this.cache.delete(id);
    this.pending.delete(id);
  }
  async account(account, refresh) {
    const version = this.versions.get(account.id);
    const cached = this.cache.get(account.id);
    if (
      cached &&
      this.now() - cached.at < (refresh ? this.minimumRefreshMs : this.ttlMs)
    )
      return present(account, cached.value, this.now());
    if (this.pending.has(account.id)) return this.pending.get(account.id);
    const pending = (async () => {
      let result;
      try {
        result = publicUsage(await this.adapters[account.id]());
      } catch {
        result = {
          status: "error",
          source: account.name,
          message: "Usage could not be read. Try refreshing shortly.",
          windows: [],
        };
      }
      if (this.versions.get(account.id) !== version)
        return this.account(account, true);
      const checkedAt = new Date(this.now()).toISOString();
      const previous = cached?.value;
      const value =
        result.status === "error" && previous?.windows.length
          ? {
              ...result,
              windows: previous.windows,
              plan: previous.plan,
              reportedAt: previous.reportedAt,
              checkedAt: previous.checkedAt,
              attemptedAt: checkedAt,
              stale: true,
            }
          : { ...result, checkedAt, stale: false };
      this.cache.set(account.id, { at: this.now(), value });
      return present(account, value, this.now());
    })();
    this.pending.set(account.id, pending);
    try {
      return await pending;
    } finally {
      if (this.pending.get(account.id) === pending)
        this.pending.delete(account.id);
    }
  }
  async read(providers, { refresh = false } = {}) {
    const subscriptions = await Promise.all(
      accounts.map((account) => this.account(account, refresh)),
    );
    const known = new Set(accounts.flatMap((account) => account.providerIds));
    const connections = providers
      .filter(
        (provider) => !known.has(provider.id) && provider.id !== "local-color",
      )
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        providerIds: [provider.id],
        billing: ["compatible", "image-api", "gemini-video", "grok"].includes(
          provider.kind,
        )
          ? "api"
          : "local",
        status: "unavailable",
        source: ["ollama", "comfyui"].includes(provider.kind)
          ? "Local model"
          : provider.kind === "command"
            ? "Local command"
            : "Provider API",
        message: ["ollama", "comfyui"].includes(provider.kind)
          ? "Runs on this computer. No subscription quota or API billing. Manage models in Settings → Local models."
          : provider.kind === "command"
            ? "Local harnesses do not expose subscription quotas."
            : "This API does not expose subscription quota here. Check the provider’s API billing dashboard.",
        windows: [],
        stale: false,
      }));
    return {
      accounts: [...subscriptions, ...connections],
      fetchedAt: new Date(this.now()).toISOString(),
      cacheSeconds: this.ttlMs / 1000,
    };
  }
}
