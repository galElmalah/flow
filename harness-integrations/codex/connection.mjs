import { spawn } from "node:child_process";
import {
  mkdir,
  chmod,
  readFile,
  writeFile,
  rename,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { codexBin, codexStatus } from "./status.mjs";
import {
  codexAuthMode,
  codexConnectionSchema,
} from "../../shared/codex-connection.mjs";

const conflict = (message) =>
  Object.assign(new Error(message), { status: 409 });
const storageArgs = ["-c", 'cli_auth_credentials_store="file"'];

// Codex owns authentication/refresh. Flow owns only the selected source and isolated homes.
export class CodexConnection {
  constructor({ dataRoot, executable = codexBin } = {}) {
    this.directory = path.join(dataRoot, "private", "codex");
    this.file = path.join(this.directory, "connection.json");
    this.executable = executable;
    this.pending = Promise.resolve();
    this.login = null;
    this.child = null;
  }
  async mode() {
    try {
      return codexAuthMode.parse(
        JSON.parse(await readFile(this.file, "utf8")).mode,
      );
    } catch (error) {
      if (error.code === "ENOENT") return "harness";
      throw new Error("Could not read the private Codex connection.");
    }
  }
  async execution(mode) {
    mode ||= await this.mode();
    if (mode === "harness") return { mode, args: [], env: { ...process.env } };
    const directory = path.join(this.directory, mode);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const env = { ...process.env, CODEX_HOME: directory };
    for (const key of [
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "CODEX_ACCESS_TOKEN",
      "OPENAI_BASE_URL",
      "CODEX_AUTH_JSON",
    ])
      delete env[key];
    return {
      mode,
      env,
      args: [
        ...storageArgs,
        "-c",
        `forced_login_method="${mode === "oauth" ? "chatgpt" : "api"}"`,
      ],
    };
  }
  async status() {
    const execution = await this.execution();
    const health = await codexStatus({
      ...execution,
      executable: this.executable,
    });
    const hasApiKey = await stat(
      path.join(this.directory, "api-key", "auth.json"),
    ).then(
      () => true,
      () => false,
    );
    return {
      mode: execution.mode,
      hasApiKey,
      ...health,
      login: this.login ? { ...this.login } : null,
    };
  }
  mutate(operation) {
    const task = this.pending.catch(() => {}).then(operation);
    this.pending = task;
    return task;
  }
  configure(raw) {
    const input = codexConnectionSchema.parse(raw);
    return this.mutate(async () => {
      if (this.child)
        throw conflict("Finish or cancel the current Codex sign-in first.");
      if (input.mode === "api-key" && input.apiKey) {
        const execution = await this.execution("api-key");
        await this.command(
          [...execution.args, "login", "--with-api-key"],
          execution.env,
          input.apiKey,
        );
        await chmod(path.join(execution.env.CODEX_HOME, "auth.json"), 0o600);
      }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      await writeFile(
        this.file + ".tmp",
        JSON.stringify({ mode: input.mode }),
        { mode: 0o600 },
      );
      await chmod(this.file + ".tmp", 0o600);
      await rename(this.file + ".tmp", this.file);
      this.login = null;
      return this.status();
    });
  }
  command(args, env, key) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, {
        env,
        stdio: ["pipe", "ignore", "ignore"],
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Codex sign-in timed out."));
      }, 15000);
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not start the Codex CLI."));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(
              new Error(
                "Codex could not save this API key. Check your CLI setup.",
              ),
            );
      });
      child.stdin.on("error", () => {});
      child.stdin.end(key + "\n");
    });
  }
  startLogin() {
    return this.mutate(async () => {
      if ((await this.mode()) !== "oauth")
        throw conflict("Select ChatGPT OAuth before signing in.");
      if (this.child) return this.status();
      const execution = await this.execution("oauth");
      this.login = {
        status: "starting",
        message: "Requesting a sign-in code…",
      };
      const child = spawn(
        this.executable,
        [...execution.args, "login", "--device-auth"],
        {
          env: { ...execution.env, NO_COLOR: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      this.child = child;
      let output = "";
      const receive = (chunk) => {
        if (this.child !== child) return;
        output = (output + chunk.toString())
          .slice(-16000)
          .replace(/\x1b\[[0-9;]*m/g, "");
        const url = output.match(
          /https:\/\/auth\.openai\.com\/[a-zA-Z0-9/_-]+/,
        )?.[0];
        const code = output.match(
          /(?:^|\n)[ \t]*([A-Z0-9]{4,5}-[A-Z0-9]{4,5})[ \t]*(?=\r?\n|$)/,
        )?.[1];
        if (url && code)
          this.login = {
            status: "pending",
            url,
            code,
            message: "Open the sign-in link and enter this code.",
          };
      };
      child.stdout.on("data", receive);
      child.stderr.on("data", receive);
      const timer = setTimeout(
        () => {
          if (this.child !== child) return;
          this.child = null;
          this.login = {
            status: "expired",
            message: "Sign-in expired. Try again.",
          };
          child.kill("SIGTERM");
        },
        15 * 60 * 1000,
      );
      timer.unref();
      child.once("error", () => {
        clearTimeout(timer);
        if (this.child !== child) return;
        this.child = null;
        this.login = {
          status: "failed",
          message: "Could not start Codex. Check that the CLI is installed.",
        };
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (this.child !== child) return;
        this.child = null;
        this.login = {
          status: code === 0 ? "completed" : "failed",
          message:
            code === 0
              ? "Signed in with ChatGPT."
              : "Sign-in failed. Enable device-code login in ChatGPT security settings, then retry.",
        };
      });
      return this.status();
    });
  }
  cancelLogin() {
    return this.mutate(async () => {
      const child = this.child;
      this.child = null;
      child?.kill("SIGTERM");
      this.login = { status: "cancelled", message: "Sign-in cancelled." };
      return this.status();
    });
  }
  close() {
    const child = this.child;
    this.child = null;
    child?.kill("SIGTERM");
  }
}
