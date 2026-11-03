import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { promptBrief } from "../shared/text.mjs";
import { startSpan, mark } from "../../observability/tracing.mjs";

const disabledFeatures = [
  "shell_tool",
  "unified_exec",
  "image_generation",
  "plugins",
  "apps",
  "browser_use",
  "computer_use",
  "multi_agent",
  "hooks",
  "skill_search",
];

export function invocation({ job }) {
  return {
    args: [
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      'approval_policy="never"',
      "-c",
      'sandbox_mode="read-only"',
      "-c",
      "mcp_servers={}",
      "-c",
      'web_search="disabled"',
      "-c",
      "project_doc_max_bytes=0",
      ...disabledFeatures.flatMap((name) => ["--disable", name]),
    ],
    input: promptBrief(job),
  };
}

// This process owns one ephemeral turn. Provider events never escape this adapter.
export async function runCodexText(provider, context) {
  const {
    directory,
    job,
    imagePaths = [],
    signal,
    onText,
    onProgress,
    onTiming,
  } = context;
  if (signal?.aborted) throw new Error("Cancelled");
  await mkdir(directory, { recursive: true });
  const command = invocation(context);
  const sessionSpan = startSpan("codex.session", {
    "weft.provider_id": provider.id,
  });
  onProgress?.(`Writing with ${provider.name}…`);
  return new Promise((resolve, reject) => {
    let child,
      timer,
      settled = false,
      bytes = 0,
      buffer = "";
    let threadId, turnId, selectedId, reasoningEffort;
    let waitSpan, streamSpan;
    let disabledMcpServers = {};
    const items = new Map();
    const rpc = new Map();
    const observed = new Set();
    const phase = (name) => {
      if (observed.has(name)) return;
      observed.add(name);
      mark(sessionSpan, name);
      onTiming?.(name);
    };
    const decoder = new StringDecoder("utf8");
    const kill = (force = false) => {
      if (!child) return;
      try {
        if (process.platform === "win32")
          child.kill(force ? "SIGKILL" : "SIGTERM");
        else process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
      } catch {}
    };
    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      for (const pending of [waitSpan, streamSpan])
        if (pending) {
          if (error) pending.setStatus({ code: 2 });
          pending.end();
        }
      for (const pending of rpc.values()) {
        if (error) pending.setStatus({ code: 2 });
        pending.end();
      }
      rpc.clear();
      if (error) sessionSpan.setStatus({ code: 2 });
      sessionSpan.end();
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      child?.stdin.end();
      kill();
      const killTimer = setTimeout(() => kill(true), 1000);
      killTimer.unref();
      if (error) reject(error);
      else resolve(text);
    };
    const send = (message) => {
      if (
        message.id !== undefined &&
        ["initialize", "config/read", "thread/start", "turn/start"].includes(
          message.method,
        )
      )
        rpc.set(
          message.id,
          startSpan(
            `codex.${message.method.replaceAll("/", ".")}`,
            {},
            sessionSpan,
          ),
        );
      if (!settled && !child.stdin.destroyed)
        child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const abort = () => {
      if (threadId && turnId)
        send({ id: 4, method: "turn/interrupt", params: { threadId, turnId } });
      finish(new Error("Cancelled"));
    };
    const acceptable = (item) =>
      item && item.phase !== "commentary" && item.phase !== "partial_answer";
    const emit = (id) => {
      const item = items.get(id);
      if (!acceptable(item)) return;
      if (Buffer.byteLength(item.text) > 128 * 1024)
        throw new Error("Codex text output exceeded 128 KB.");
      // Legacy models sometimes omit phase. For app assistant turns, publish
      // only a structured answer candidate, which the registry projects safely.
      if (
        !item.phase &&
        job.purpose === "app-assistant" &&
        !/^(?:```(?:json)?\s*)?\{/.test(item.text.trimStart())
      )
        return;
      selectedId = id;
      onText?.(item.text);
    };
    const completeItem = (item) => {
      if (item?.type !== "agentMessage" || !acceptable(item)) return;
      items.set(item.id, {
        phase: item.phase,
        text: item.text || "",
        complete: true,
      });
      emit(item.id);
    };
    const receive = (message) => {
      if (message.id !== undefined && !message.method && rpc.has(message.id)) {
        const pending = rpc.get(message.id);
        if (message.error) pending.setStatus({ code: 2 });
        pending.end();
        rpc.delete(message.id);
      }
      if (message.method && message.id !== undefined) {
        // No approvals, dynamic tools, credential refresh or user elicitation.
        send({
          id: message.id,
          error: {
            code: -32601,
            message:
              "Tools and approvals are disabled for this text-only turn.",
          },
        });
        throw new Error(
          "Codex requested a tool or approval during a text-only turn.",
        );
      }
      if (message.id === 1) {
        if (message.error)
          throw new Error("Codex app-server could not initialize.");
        phase("initialized");
        send({ method: "initialized" });
        send({
          id: 5,
          method: "config/read",
          params: { cwd: directory, includeLayers: false },
        });
        return;
      }
      if (message.id === 5) {
        if (message.error || !message.result?.config)
          throw new Error(
            "Codex could not verify isolated tool configuration.",
          );
        const model =
          job.model && job.model !== "default"
            ? job.model
            : message.result.config.model;
        const effort =
          (job.reasoningEffort !== "inherit" && job.reasoningEffort) ||
          message.result.config.model_reasoning_effort;
        if (typeof model === "string" && model.length < 120)
          sessionSpan.setAttribute("gen_ai.request.model", model);
        if (
          [
            "none",
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
            "ultra",
          ].includes(effort)
        ) {
          sessionSpan.setAttribute("gen_ai.request.reasoning_effort", effort);
          reasoningEffort = effort;
        }
        disabledMcpServers = Object.fromEntries(
          Object.entries(message.result.config.mcp_servers || {}).map(
            ([name, settings]) => [
              name,
              {
                ...Object.fromEntries(
                  Object.entries(settings).filter(
                    ([, value]) => value !== null,
                  ),
                ),
                enabled: false,
              },
            ],
          ),
        );
        phase("configured");
        send({
          id: 2,
          method: "thread/start",
          params: {
            cwd: directory,
            ephemeral: true,
            approvalPolicy: "never",
            sandbox: "read-only",
            ...(job.model && job.model !== "default"
              ? { model: job.model }
              : {}),
            config: {
              mcp_servers: disabledMcpServers,
              web_search: "disabled",
              project_doc_max_bytes: 0,
              features: Object.fromEntries(
                disabledFeatures.map((name) => [name, false]),
              ),
            },
          },
        });
        return;
      }
      if (message.id === 2) {
        if (message.error || !message.result?.thread?.id)
          throw new Error("Codex could not create an isolated text session.");
        if (
          message.result.approvalPolicy !== "never" ||
          message.result.sandbox?.type !== "readOnly"
        )
          throw new Error("Codex did not honor the read-only text sandbox.");
        threadId = message.result.thread.id;
        phase("threadStarted");
        phase("turnRequested");
        waitSpan = startSpan("codex.wait_first_delta", {}, sessionSpan);
        send({
          id: 3,
          method: "turn/start",
          params: {
            threadId,
            cwd: directory,
            ...(job.reasoningEffort &&
              job.reasoningEffort !== "inherit" && {
                effort: job.reasoningEffort,
              }),
            approvalPolicy: "never",
            input: [
              { type: "text", text: command.input, text_elements: [] },
              ...imagePaths.map((file) => ({ type: "localImage", path: file })),
            ],
          },
        });
        return;
      }
      if (message.id === 3) {
        if (message.error || !message.result?.turn?.id)
          throw new Error("Codex could not start the text turn.");
        if (turnId && turnId !== message.result.turn.id)
          throw new Error("Codex returned an inconsistent turn ID.");
        turnId = message.result.turn.id;
        phase("turnAccepted");
        return;
      }
      const params = message.params;
      if (!threadId || params?.threadId !== threadId) return;
      if (message.method === "turn/started" && !turnId) {
        turnId = params.turn?.id;
        phase("turnAccepted");
        return;
      }
      if (message.method === "turn/completed") {
        if (!turnId || params.turn?.id !== turnId) return;
        if (params.turn.status !== "completed")
          throw new Error(
            params.turn.status === "interrupted"
              ? "Codex turn interrupted."
              : "Codex turn failed.",
          );
        for (const item of params.turn.items || []) completeItem(item);
        const final = items.get(selectedId);
        if (!final?.complete || !final.text.trim())
          throw new Error("Codex completed without a final text answer.");
        phase("providerCompleted");
        finish(null, final.text);
        return;
      }
      if (!turnId || params.turnId !== turnId) return;
      if (message.method === "item/started") {
        phase("firstActivity");
        if (params.item?.type === "reasoning")
          onProgress?.(
            reasoningEffort
              ? `Codex · ${reasoningEffort} reasoning…`
              : "Codex is preparing the reply…",
          );
      }
      if (
        message.method === "item/started" &&
        params.item?.type === "agentMessage"
      )
        items.set(params.item.id, {
          phase: params.item.phase,
          text: params.item.text || "",
          complete: false,
        });
      if (message.method === "item/agentMessage/delta") {
        const item = items.get(params.itemId);
        if (!item || item.complete || typeof params.delta !== "string") return;
        if (acceptable(item) && !observed.has("firstDelta")) {
          waitSpan?.end();
          waitSpan = undefined;
          streamSpan = startSpan("codex.stream_answer", {}, sessionSpan);
        }
        if (acceptable(item)) phase("firstDelta");
        item.text += params.delta;
        emit(params.itemId);
      }
      if (message.method === "item/completed") completeItem(params.item);
    };
    try {
      child = spawn(
        provider.executable,
        [...(context.codexExecution?.args || []), ...command.args],
        {
          cwd: directory,
          detached: process.platform !== "win32",
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...(context.codexExecution?.env || process.env),
            NO_COLOR: "1",
          },
        },
      );
      child.once("spawn", () => phase("spawned"));
    } catch {
      finish(new Error("Cannot start Codex app-server."));
      return;
    }
    timer = setTimeout(
      () => finish(new Error("Codex text harness timed out.")),
      provider.timeoutMs || 600000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    child.once("error", () =>
      finish(new Error("Cannot start Codex app-server.")),
    );
    child.stdin.on("error", () =>
      finish(new Error("Codex app-server connection closed.")),
    );
    child.once("close", () => {
      if (!settled)
        finish(new Error("Codex app-server closed before the turn completed."));
      // Keep group escalation alive: descendants may outlive the leader.
    });
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024)
        finish(new Error("Codex protocol output exceeded 2 MB."));
    });
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        finish(new Error("Codex protocol output exceeded 2 MB."));
        return;
      }
      buffer += decoder.write(chunk);
      try {
        let newline;
        while (!settled && (newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim()) receive(JSON.parse(line));
        }
      } catch (error) {
        finish(
          error instanceof SyntaxError
            ? new Error("Codex returned malformed protocol JSON.")
            : error,
        );
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "weft_text",
          title: "Flow text harness",
          version: "0.1.0",
        },
      },
    });
  });
}
