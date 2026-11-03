import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

// Read-only control messages; no user prompt is submitted.
export async function requestClaudeControl({
  executable,
  timeoutMs = 10000,
  request,
  prefix = "flow-control",
}) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "flow-claude-control-"),
  );
  let child;
  try {
    return await new Promise((resolve, reject) => {
      child = spawn(
        executable,
        [
          "-p",
          "--safe-mode",
          "--tools",
          "",
          "--strict-mcp-config",
          "--mcp-config",
          '{"mcpServers":{}}',
          "--no-session-persistence",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
        ],
        {
          cwd: directory,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, NO_COLOR: "1" },
        },
      );
      let settled = false,
        buffer = "",
        bytes = 0;
      const timer = setTimeout(
        () => finish(new Error("Claude control request timed out.")),
        timeoutMs,
      );
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdin.end();
        child.kill("SIGTERM");
        const force = setTimeout(() => child.kill("SIGKILL"), 1000);
        force.unref();
        child.once("close", () => clearTimeout(force));
        if (error) reject(error);
        else resolve(value);
      };
      const send = (id, request) =>
        child.stdin.write(
          JSON.stringify({
            type: "control_request",
            request_id: id,
            request,
          }) + "\n",
        );
      child.once("error", () =>
        finish(new Error("Claude CLI could not start.")),
      );
      child.once("close", () =>
        finish(new Error("Claude CLI returned no control response.")),
      );
      child.stdin.on("error", () =>
        finish(new Error("Claude control control closed.")),
      );
      child.stderr.resume();
      child.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024)
          return finish(new Error("Claude control output was too large."));
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event?.type !== "control_response") continue;
          const response = event.response;
          if (response?.request_id === `${prefix}-init`) {
            if (response.subtype !== "success")
              return finish(new Error("Claude control initialization failed."));
            if (!request) return finish(null, response.response);
            send(`${prefix}-read`, request);
          } else if (response?.request_id === `${prefix}-read`) {
            if (response.subtype !== "success")
              return finish(
                new Error("Claude control control is unavailable."),
              );
            finish(null, response.response);
          }
        }
      });
      send(`${prefix}-init`, {
        subtype: "initialize",
        hooks: {},
        mcpServers: {},
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
