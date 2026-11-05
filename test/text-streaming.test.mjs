import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { capture } from "../harness-integrations/shared/process.mjs";
import { runTextHarness } from "../harness-integrations/shared/text.mjs";
import * as claude from "../harness-integrations/claude-code/index.mjs";
import * as gemini from "../harness-integrations/gemini/index.mjs";
import * as pi from "../harness-integrations/pi/index.mjs";
import { runTextApi } from "../harness-integrations/openai-compatible/text.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flow-text-stream-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function feed(adapter, records) {
  const seen = [];
  const decoder = adapter.stream((value) => seen.push(value));
  const wire = records.map((event) => JSON.stringify(event)).join("\r\n");
  for (const character of wire) decoder.write(character);
  decoder.end();
  return { seen, wire };
}
const delta = (text) => ({
  type: "stream_event",
  event: { type: "content_block_delta", delta: { type: "text_delta", text } },
});

test("Claude previews only main conversation text, with final result reconciliation", () => {
  const { seen, wire } = feed(claude, [
    { type: "system", secret: "SYSTEM PRIVATE" },
    {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "REASONING PRIVATE" },
      },
    },
    { ...delta("SUBAGENT PRIVATE"), parent_tool_use_id: "tool-1" },
    delta("Hello "),
    delta("世界"),
    {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "TOOL PRIVATE" },
      },
    },
    { type: "result", result: "Hello 世界!" },
  ]);
  assert.deepEqual(seen, ["Hello ", "Hello 世界", "Hello 世界!"]);
  assert.equal(claude.parse(wire), "Hello 世界!");
  assert.ok(
    claude
      .invocation({ job: {}, onText() {} })
      .args.includes("--include-partial-messages"),
  );
  assert.ok(
    !claude.invocation({ job: {} }).args.includes("--include-partial-messages"),
  );
});

test("Gemini JSONL previews only assistant messages and requires successful final result", () => {
  const { seen, wire } = feed(gemini, [
    { type: "init", model: "PRIVATE MODEL ENVELOPE" },
    { type: "message", role: "user", content: "USER PRIVATE" },
    { type: "message", role: "assistant", content: "A\u2028", delta: true },
    { type: "tool_result", output: "TOOL PRIVATE" },
    { type: "message", role: "assistant", content: "🙂", delta: true },
    { type: "result", status: "success", stats: { secret: "USAGE PRIVATE" } },
  ]);
  assert.deepEqual(seen, ["A\u2028", "A\u2028🙂"]);
  assert.equal(gemini.parse(wire, { streaming: true }), "A\u2028🙂");
  assert.throws(
    () =>
      gemini.parse(
        JSON.stringify({
          type: "result",
          status: "error",
          error: { message: "PRIVATE" },
        }),
        { streaming: true },
      ),
    /did not complete/,
  );
  assert.equal(
    gemini.invocation({ job: {}, onText() {} }).args[3],
    "stream-json",
  );
  assert.ok(gemini.invocation({ job: {}, onText() {} }).args.includes("plan"));
});

test("Pi reconstructs text blocks, ignores reasoning/tools, and trusts completed assistant content", () => {
  const { seen, wire } = feed(pi, [
    { type: "message_start", message: { role: "assistant", content: [] } },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "REASONING PRIVATE",
      },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Hello ",
      },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 1,
        delta: "TOOL PRIVATE",
      },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 2,
        delta: "world",
      },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [
          { type: "thinking", thinking: "PRIVATE" },
          { type: "text", text: "Hello world!" },
        ],
      },
    },
  ]);
  assert.deepEqual(seen, ["Hello ", "Hello world", "Hello world!"]);
  assert.equal(pi.parse(wire, { streaming: true }), "Hello world!");
  const args = pi.invocation({ job: {}, imagePaths: [], onText() {} }).args;
  for (const flag of [
    "--no-tools",
    "--no-mcp",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
  ])
    assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf("--mode") + 1], "json");
});

test("Pi rejects truncated, filtered, tool and failed completions", () => {
  for (const stopReason of [
    "length",
    "toolUse",
    "error",
    "aborted",
    undefined,
  ]) {
    const wire = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason,
        content: [{ type: "text", text: "partial" }],
      },
    });
    assert.throws(
      () => pi.parse(wire, { streaming: true }),
      /did not complete/,
    );
  }
});

test("capture decodes split UTF-8 and callback failures reject without uncaught event errors", async () => {
  const seen = [];
  const source = `const b=Buffer.from('🙂é'); for (let i=0;i<b.length;i++){process.stdout.write(b.subarray(i,i+1)); await new Promise(r=>setTimeout(r,5));}`;
  const { stdout } = await capture(
    process.execPath,
    ["--input-type=module", "-e", source],
    { onStdout: (s) => seen.push(s), timeoutMs: 2000 },
  );
  assert.equal(stdout, "🙂é");
  assert.equal(seen.join(""), stdout);
  await assert.rejects(
    capture(
      process.execPath,
      ["-e", "process.stdout.write('hello');setInterval(()=>{},1000)"],
      {
        onStdout() {
          throw new Error("Consumer rejected preview");
        },
        timeoutMs: 2000,
      },
    ),
    /Consumer rejected preview/,
  );
});

test(
  "capture kills a descendant that ignores SIGTERM after its leader exits",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const controller = new AbortController();
    let descendant;
    const source = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"], {stdio:['ignore','ignore','ignore','ipc']});
    child.on('message',()=>process.stdout.write(String(child.pid)+'\\n'));
    setInterval(()=>{},1000);
  `;
    const alive = () => {
      try {
        process.kill(descendant, 0);
        return true;
      } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
      }
    };
    try {
      await assert.rejects(
        capture(process.execPath, ["-e", source], {
          signal: controller.signal,
          timeoutMs: 5000,
          onStdout(text) {
            descendant = Number(text.trim());
            controller.abort();
          },
        }),
        /Cancelled/,
      );
      assert.ok(Number.isInteger(descendant) && descendant > 0);
      assert.equal(
        alive(),
        true,
        "descendant must outlive the leader before forced escalation",
      );
      const deadline = Date.now() + 3500;
      while (alive() && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(
        alive(),
        false,
        "SIGKILL must still target the group after leader close",
      );
    } finally {
      if (descendant)
        try {
          process.kill(descendant, "SIGKILL");
        } catch {}
    }
  },
);

test("runTextHarness exposes growing text before CLI process completion", async (t) => {
  const directory = await temporary(t);
  const executable = path.join(directory, "fixture.mjs");
  await writeFile(
    executable,
    `#!${process.execPath}
let input=''; for await (const c of process.stdin) input+=c;
process.stdout.write(${JSON.stringify(JSON.stringify(delta("Early preview")) + "\n")});
await new Promise(r=>setTimeout(r,200));
process.stdout.write(${JSON.stringify(JSON.stringify({ type: "result", result: "Early preview done" }) + "\n")});
`,
  );
  await chmod(executable, 0o700);
  const first = deferred();
  let finished = false;
  const running = runTextHarness(
    { ...claude.provider, executable, timeoutMs: 30000 },
    {
      job: { prompt: "fixture" },
      directory,
      imagePaths: [],
      onText: (s) => first.resolve(s),
    },
    claude,
  ).then((text) => {
    finished = true;
    return text;
  });
  assert.equal(await first.promise, "Early preview");
  assert.equal(finished, false);
  assert.equal(await running, "Early preview done");
});

async function endpoint(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return {
    name: "Fixture API",
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    timeoutMs: 2000,
  };
}
const context = (extra = {}) => ({
  job: { prompt: "hello", model: "fixture" },
  imagePaths: [],
  ...extra,
});
const sse = (event) => `data: ${JSON.stringify(event)}\r\n\r\n`;

test("compatible API emits bounded SSE content before completion without exposing reasoning or tools", async (t) => {
  const first = deferred();
  const release = deferred();
  let requests = 0;
  const provider = await endpoint(t, async (req, res) => {
    requests++;
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).stream, true);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const prefix = sse({
      choices: [
        {
          index: 0,
          delta: {
            content: "Hi 🙂",
            reasoning_content: "PRIVATE",
            tool_calls: [{ name: "PRIVATE" }],
          },
        },
      ],
    });
    for (const byte of Buffer.from(prefix)) res.write(Buffer.from([byte]));
    await release.promise;
    res.end(
      sse({
        choices: [
          { index: 0, delta: { content: " done" }, finish_reason: "stop" },
        ],
      }) + "data: [DONE]\r\n\r\n",
    );
  });
  const snapshots = [];
  let finished = false;
  const running = runTextApi(
    provider,
    context({
      onText(text) {
        snapshots.push(text);
        first.resolve(text);
      },
    }),
  ).then((text) => {
    finished = true;
    return text;
  });
  assert.equal(await first.promise, "Hi 🙂");
  assert.equal(finished, false);
  release.resolve();
  assert.equal(await running, "Hi 🙂 done");
  assert.deepEqual(snapshots, ["Hi 🙂", "Hi 🙂 done"]);
  assert.equal(requests, 1);
});

test("compatible endpoints returning JSON to a streaming request are completed without a retry", async (t) => {
  let requests = 0;
  const provider = await endpoint(t, async (req, res) => {
    requests++;
    for await (const chunk of req) {
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ choices: [{ message: { content: "JSON answer" } }] }),
    );
  });
  const seen = [];
  assert.equal(
    await runTextApi(provider, context({ onText: (text) => seen.push(text) })),
    "JSON answer",
  );
  assert.deepEqual(seen, ["JSON answer"]);
  assert.equal(requests, 1);
});

test("compatible SSE accepts MIME casing and CR, LF, or split CRLF line endings", async (t) => {
  const event = JSON.stringify({
    choices: [
      { index: 0, delta: { content: "Valid stream" }, finish_reason: "stop" },
    ],
  });
  const variants = [
    [`data: ${event}\r\r`, "data: [DONE]\r\r"],
    [`data: ${event}\n\n`, "data: [DONE]\n\n"],
    [`data: ${event}\r`, "\n\r", "\ndata: [DONE]\r", "\n\r", "\n"],
  ];
  for (const chunks of variants) {
    const provider = await endpoint(t, async (req, res) => {
      for await (const chunk of req) {
      }
      res.writeHead(200, {
        "Content-Type": "Text/Event-Stream; charset=UTF-8",
      });
      for (const chunk of chunks) {
        res.write(chunk);
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      res.end();
    });
    const seen = [];
    assert.equal(
      await runTextApi(
        provider,
        context({ onText: (text) => seen.push(text) }),
      ),
      "Valid stream",
    );
    assert.deepEqual(seen, ["Valid stream"]);
  }
});

test("compatible streams reject truncation, provider errors and oversized previews", async (t) => {
  for (const [events, pattern] of [
    [
      sse({ choices: [{ index: 0, delta: { content: "partial" } }] }),
      /before the answer completed/,
    ],
    [sse({ error: { message: "failed" } }), /streaming request failed/],
    [
      sse({
        choices: [{ index: 0, delta: { content: "x".repeat(128 * 1024 + 1) } }],
      }),
      /128 KB/,
    ],
  ]) {
    const provider = await endpoint(t, async (req, res) => {
      for await (const chunk of req) {
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(events);
    });
    await assert.rejects(
      runTextApi(provider, context({ onText() {} })),
      pattern,
    );
  }
});

test("compatible streams reject explicit non-stop finish reasons even before DONE", async (t) => {
  for (const reason of [
    "length",
    "content_filter",
    "tool_calls",
    "function_call",
    "unknown",
  ]) {
    const provider = await endpoint(t, async (req, res) => {
      for await (const chunk of req) {
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        sse({
          choices: [
            { index: 0, delta: { content: "partial" }, finish_reason: reason },
          ],
        }) + "data: [DONE]\n\n",
      );
    });
    await assert.rejects(
      runTextApi(provider, context({ onText() {} })),
      /truncated|content filter|tool request|completion reason/,
    );
  }
});

test("cancelling an API stream rejects after partial output without further callbacks", async (t) => {
  const controller = new AbortController();
  const first = deferred();
  const provider = await endpoint(t, async (req, res) => {
    for await (const chunk of req) {
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(sse({ choices: [{ index: 0, delta: { content: "partial" } }] }));
  });
  const seen = [];
  const running = runTextApi(
    provider,
    context({
      signal: controller.signal,
      onText(text) {
        seen.push(text);
        first.resolve();
      },
    }),
  );
  await first.promise;
  controller.abort();
  await assert.rejects(running, /abort/i);
  assert.deepEqual(seen, ["partial"]);
});
