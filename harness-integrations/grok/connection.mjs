import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { grokConnectionSchema } from "../../shared/grok.mjs";

export class GrokError extends Error {}
export class GrokConnection {
  constructor({ dataRoot, env = process.env } = {}) {
    if (!dataRoot) throw new GrokError("Grok requires a local data directory.");
    this.filename = path.join(dataRoot, "grok.json");
    this.env = env;
    this.writer = Promise.resolve();
    this.secrets = new Set();
  }
  async read() {
    try {
      return grokConnectionSchema.parse(
        JSON.parse(await readFile(this.filename, "utf8")),
      );
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw new GrokError(
        "The saved Grok connection is invalid. Save its settings again.",
      );
    }
  }
  async key() {
    const config = await this.read();
    const key = config.apiKey || this.env.XAI_API_KEY;
    if (key) this.secrets.add(key);
    return key;
  }
  containsSecret(value) {
    return [...this.secrets].some(
      (key) => key.length >= 4 && String(value).includes(key),
    );
  }
  async status() {
    const ready = Boolean(await this.key());
    return {
      ready,
      configured: ready,
      hasApiKey: ready,
      authenticated: null,
      reason: ready
        ? "API key configured; xAI access and billing are checked when generation runs."
        : "xAI API key required. Configure it in Settings → Providers.",
    };
  }
  configure(patch) {
    const checked = grokConnectionSchema.safeParse(patch);
    if (!checked.success)
      throw new GrokError("Invalid Grok connection settings.");
    const update = async () => {
      let current;
      try {
        current = await this.read();
      } catch {
        current = {};
      }
      const next = { ...current, ...checked.data };
      if (next.apiKey === null) delete next.apiKey;
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await mkdir(path.dirname(this.filename), { recursive: true });
        await writeFile(temporary, JSON.stringify(next), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, this.filename);
      } catch {
        throw new GrokError(
          "Grok connection settings could not be saved locally.",
        );
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return this.status();
    };
    const pending = this.writer.then(update, update);
    this.writer = pending.catch(() => {});
    return pending;
  }
  async headers() {
    const key = await this.key();
    if (!key)
      throw new GrokError(
        "Grok needs an xAI API key. Configure it in Settings → Providers.",
      );
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }
}
