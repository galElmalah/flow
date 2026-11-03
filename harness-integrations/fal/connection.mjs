import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { falConnectionSchema } from "../../shared/fal.mjs";

export class FalError extends Error {}
export class FalConnection {
  constructor({ dataRoot, env = process.env } = {}) {
    if (!dataRoot) throw new FalError("Fal requires a local data directory.");
    this.filename = path.join(dataRoot, "fal.json");
    this.env = env;
    this.writer = Promise.resolve();
    this.secrets = new Set();
  }
  async read() {
    try {
      return falConnectionSchema.parse(
        JSON.parse(await readFile(this.filename, "utf8")),
      );
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw new FalError(
        "The saved Fal connection is invalid. Save its settings again.",
      );
    }
  }
  async key() {
    const config = await this.read();
    const key = config.apiKey || this.env.FAL_KEY;
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
        ? "API key configured; fal access and billing are checked when generation runs."
        : "fal API key required. Configure it in Settings → Providers.",
    };
  }
  configure(patch) {
    const checked = falConnectionSchema.safeParse(patch);
    if (!checked.success)
      throw new FalError("Invalid Fal connection settings.");
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
        throw new FalError(
          "Fal connection settings could not be saved locally.",
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
      throw new FalError(
        "Fal needs an fal API key. Configure it in Settings → Providers.",
      );
    return {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    };
  }
}
