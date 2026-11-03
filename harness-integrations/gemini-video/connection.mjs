import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";
import { geminiVideoConnectionSchema } from "../../shared/gemini-video.mjs";

export class GeminiVideoConnectionError extends Error {}

export const GEMINI_INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language.retriever",
];

export class GeminiVideoConnection {
  constructor({ dataRoot, env = process.env, googleAuth } = {}) {
    if (!dataRoot)
      throw new GeminiVideoConnectionError(
        "Gemini video requires a local data directory.",
      );
    this.filename = path.join(dataRoot, "gemini-video.json");
    this.env = env;
    this.googleAuth = googleAuth;
    this.writer = Promise.resolve();
    this.secrets = new Set();
  }

  async read() {
    try {
      const parsed = geminiVideoConnectionSchema.safeParse(
        JSON.parse(await readFile(this.filename, "utf8")),
      );
      if (!parsed.success) throw new GeminiVideoConnectionError("invalid");
      return { authMode: "api-key", ...parsed.data };
    } catch (error) {
      if (error.code === "ENOENT") return { authMode: "api-key" };
      throw new GeminiVideoConnectionError(
        "The saved Gemini video connection is invalid. Save its settings again.",
      );
    }
  }

  key(config) {
    const key =
      config.apiKey || this.env.GEMINI_API_KEY || this.env.GOOGLE_API_KEY || "";
    if (key) this.secrets.add(key);
    if (this.env.GEMINI_ACCESS_TOKEN)
      this.secrets.add(this.env.GEMINI_ACCESS_TOKEN);
    return key;
  }

  containsSecret(value) {
    return [...this.secrets].some(
      (secret) => secret.length >= 4 && String(value).includes(secret),
    );
  }

  async hasAdc() {
    if (this.googleAuth) return true;
    const filename =
      this.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.join(
        this.env.CLOUDSDK_CONFIG ||
          path.join(this.env.HOME || os.homedir(), ".config", "gcloud"),
        "application_default_credentials.json",
      );
    try {
      return (await stat(filename)).isFile();
    } catch {
      return false;
    }
  }

  async status() {
    const config = await this.read();
    const hasApiKey = !!this.key(config);
    const hasCredentials =
      config.authMode === "api-key"
        ? hasApiKey
        : config.authMode === "oauth-token"
          ? !!this.env.GEMINI_ACCESS_TOKEN
          : await this.hasAdc();
    const needsProject = config.authMode !== "api-key" && !config.quotaProject;
    const ready = hasCredentials && !needsProject;
    return {
      authMode: config.authMode,
      configured: ready,
      ready,
      authenticated: null,
      hasApiKey,
      quotaProject: this.containsSecret(config.quotaProject)
        ? null
        : config.quotaProject || null,
      reason: ready
        ? "Credentials configured; Google access and billing are checked when a video runs."
        : needsProject
          ? "Set a Google Cloud quota project for OAuth video requests."
          : config.authMode === "oauth-adc"
            ? "Set up Google Application Default Credentials for the public Gemini API."
            : config.authMode === "oauth-token"
              ? "Set GEMINI_ACCESS_TOKEN in the server environment."
              : "Add a Gemini API key or set GEMINI_API_KEY in the server environment.",
    };
  }

  async configure(patch) {
    const checked = geminiVideoConnectionSchema.safeParse(patch);
    if (!checked.success)
      throw new GeminiVideoConnectionError(
        "Invalid Gemini video connection settings.",
      );
    const update = async () => {
      let current;
      try {
        current = await this.read();
      } catch {
        current = { authMode: "api-key" };
      }
      const next = { ...current, ...checked.data };
      if (next.apiKey === null) delete next.apiKey;
      if (next.quotaProject === null) delete next.quotaProject;
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await mkdir(path.dirname(this.filename), { recursive: true });
        await writeFile(temporary, JSON.stringify(next), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, this.filename);
      } catch {
        throw new GeminiVideoConnectionError(
          "Gemini video connection settings could not be saved locally.",
        );
      } finally {
        await unlink(temporary).catch(() => {});
      }
      this.adcClient = null;
      return this.status();
    };
    const pending = this.writer.then(update, update);
    this.writer = pending.catch(() => {});
    return pending;
  }

  async headers() {
    const config = await this.read();
    this.key(config);
    if (config.authMode === "api-key") {
      const key = this.key(config);
      if (!key)
        throw new GeminiVideoConnectionError(
          "Gemini video needs an API key. Configure it in Settings → Providers.",
        );
      return { "x-goog-api-key": key };
    }
    if (!config.quotaProject)
      throw new GeminiVideoConnectionError(
        "Gemini video OAuth needs an explicit Google Cloud quota project.",
      );
    if (config.authMode === "oauth-token") {
      if (!this.env.GEMINI_ACCESS_TOKEN)
        throw new GeminiVideoConnectionError(
          "Gemini video needs GEMINI_ACCESS_TOKEN in the server environment.",
        );
      return {
        Authorization: `Bearer ${this.env.GEMINI_ACCESS_TOKEN}`,
        "x-goog-user-project": config.quotaProject,
      };
    }
    try {
      if (!this.adcClient) {
        const auth =
          this.googleAuth ||
          new GoogleAuth({
            scopes: SCOPES,
            quotaProjectId: config.quotaProject,
          });
        this.adcClient = await auth.getClient();
      }
      const result = await this.adcClient.getRequestHeaders(
        GEMINI_INTERACTIONS_URL,
      );
      const authorization =
        typeof result.get === "function"
          ? result.get("authorization")
          : result.Authorization || result.authorization;
      if (!authorization) throw new GeminiVideoConnectionError("missing");
      this.secrets.add(authorization.replace(/^Bearer\s+/i, ""));
      return {
        Authorization: authorization,
        "x-goog-user-project": config.quotaProject,
      };
    } catch {
      throw new GeminiVideoConnectionError(
        "Gemini video could not obtain Google OAuth credentials. Set up or renew Application Default Credentials.",
      );
    }
  }
}
