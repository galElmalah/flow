import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  createImageWorkflow,
  createVideoWorkflow,
  WeftClient,
} from "../client/index.mjs";
import { validateGraph } from "../shared/graph.mjs";
import { generationKind, mediaArtifact } from "../shared/media.mjs";
import { planWorkflow } from "../server/graph.mjs";
import { Store, summarize } from "../server/store.mjs";
import { Queue } from "../server/queue.mjs";
import { AgentConversations } from "../server/agent/service.mjs";
import { ProjectService } from "../server/projects.mjs";
import { applyAgentEdits } from "../shared/agent.mjs";
import { galleryItems } from "../server/search/documents.mjs";
import { nodeInterfaces } from "../shared/inspection.mjs";
import { promptGuide } from "../shared/prompt-guide.mjs";

// A real 32x32 H.264 MP4, generated once with ffmpeg from a black color source.
const mp4 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAOMbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAARgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAArd0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAARgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAEYAAAEAAABAAAAAAIvbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAADgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAB2m1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAZpzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAIABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2UlsBEAAAAMAQAAADIPEiWWAAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAFhkAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAHAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAASGN0dHMAAAAAAAAABwAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAGAAAAAAEAAAIAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAHAAAAAQAAADBzdHN6AAAAAAAAAAAAAAAHAAACygAAAAwAAAAMAAAADAAAAAwAAAASAAAADAAAABRzdGNvAAAAAAAAAAEAAAO8AAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMgAAAAhmcmVlAAADIG1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAUZYiEADf//vbw/gU2VgRQlns/U+EAAAAIQZokbEM//qcAAAAIQZ5CeIX/VcEAAAAIAZ5hdEK/WsAAAAAIAZ5jakK/WsEAAAAOQZpmSahBaJlMFPCv/lcAAAAIAZ6FakK/WsE=",
  "base64",
);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for queue");
    await sleep(5);
  }
}

test("video recipe preserves records, optional prompt writers, typed counts and video-only sockets", () => {
  const graph = createVideoWorkflow({
    id: "motion",
    projectId: "sports",
    prompt: "Film grain and motion blur",
    images: ["/assets/seed.png"],
    count: 2,
    records: [
      { id: "cycling", fields: { scene: "A cyclist accelerates" } },
      { id: "running", fields: { scene: "A runner sprints" } },
    ],
    template: "Scene: {{scene}}",
    promptProviderId: "codex-text",
  });
  validateGraph(graph);
  const plan = planWorkflow(graph);
  assert.equal(plan.textJobs, 2);
  assert.equal(plan.imageJobs, 0);
  assert.equal(plan.videoJobs, 4);
  const videos = plan.jobs.filter((job) => job.kind === "video");
  assert.deepEqual(
    videos.map((job) => job.records[0].id),
    ["cycling", "cycling", "running", "running"],
  );
  assert.ok(
    videos.every(
      (job) =>
        job.providerId === "gemini-video" &&
        job.model === "gemini-omni-1.1-flash",
    ),
  );
  assert.ok(
    videos.every(
      (job) =>
        job.ratio === "16:9" &&
        job.video.resolution === "720p" &&
        job.dependencies.length === 1,
    ),
  );
  assert.ok(videos.every((job) => job.images[0].asset === "/assets/seed.png"));
  assert.equal(generationKind("video-generate"), "video");
  assert.equal(generationKind("video-output"), null);
  assert.equal(nodeInterfaces["video-generate"].outputs[0].type, "video");
  const guide = promptGuide(graph, {
    nodes: Object.fromEntries(
      graph.nodes.map((node) => [
        node.id,
        plan.jobs.filter((job) => job.nodeId === node.id).length,
      ]),
    ),
  });
  assert.equal(guide.flows[0].videoJobs, 4);
  assert.equal(guide.starts[0].id, "prompt");

  const bad = structuredClone(graph);
  bad.edges.push({
    id: "bad",
    source: "generate",
    target: "prompt",
    sourceHandle: "video",
    targetHandle: "image",
  });
  assert.throws(() => validateGraph(bad), /Cannot connect/);
  const terminal = structuredClone(graph);
  terminal.edges.push({
    id: "bad",
    source: "output",
    target: "prompt",
    targetHandle: "text",
  });
  assert.throws(() => validateGraph(terminal), /Cannot connect/);
  const unsupported = structuredClone(graph);
  unsupported.nodes.find(
    (node) => node.type === "video-generate",
  ).data.video.durationSeconds = 31;
  assert.throws(() => validateGraph(unsupported));
  const image = createImageWorkflow({ prompt: "A still image" });
  assert.equal(planWorkflow(image).imageJobs, 1);
  assert.equal(planWorkflow(image).videoJobs, 0);
});

test("accepted video receipt survives shutdown and resume saves the MP4 in normal gallery/history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "weft-video-queue-"));
  const store = new Store(root);
  await store.init();
  const receipt = {
    state: "accepted",
    providerId: "gemini-video",
    id: "v1_fixture",
    requestHash: "a".repeat(64),
  };
  let submitted = 0;
  const queue = new Queue(store, {
    adapter: async ({ checkpoint, signal }) => {
      submitted++;
      await checkpoint({
        providerOperation: receipt,
        message: "Rendering remotely",
      });
      await new Promise((done) => {
        if (signal.aborted) done();
        else signal.addEventListener("abort", done, { once: true });
      });
    },
    resolveAsset: (url) => url,
  });
  t.after(async () => {
    await queue.stop();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const run = await queue.create(
    createVideoWorkflow({ id: "motion", prompt: "A runner sprints" }),
  );
  await waitFor(() => run.jobs[0].providerOperation?.id === receipt.id);
  await queue.stop();
  await waitFor(() => queue.active.size === 0);
  const restored = new Store(root);
  await restored.init();
  t.after(() => restored.close());
  const resumed = restored.runs.get(run.id);
  assert.equal(resumed.jobs[0].message, "Rendering remotely");
  assert.deepEqual(resumed.jobs[0].providerOperation, receipt);
  assert.equal(resumed.status, "interrupted");
  const restarted = new Queue(restored, {
    adapter: async ({ job, directory }) => {
      assert.deepEqual(job.providerOperation, receipt); // Resume known interaction, never submit.
      await writeFile(join(directory, "output.mp4"), mp4);
      return {
        kind: "video",
        metadata: { mimeType: "video/mp4", width: 32, height: 32 },
      };
    },
    resolveAsset: (url) => url,
  });
  restarted.action(run.id, "resume");
  await waitFor(
    () => resumed.status === "completed" && restarted.active.size === 0,
  );
  assert.equal(submitted, 1);
  const job = resumed.jobs[0];
  assert.match(job.output, /\/output\.mp4$/);
  assert.deepEqual(
    await readFile(
      join(root, "runs", run.id, job.id, mediaArtifact(job.kind).basename),
    ),
    mp4,
  );
  assert.equal(summarize(resumed).videoJobs, 1);
  assert.equal(summarize(resumed).imageJobs, 0);
  assert.equal(galleryItems([resumed])[0].kind, "video");
});

test("CLI and MCP create the same video graphs and expose private configuration without exporting keys", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "weft-video-agents-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const api = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method: request.method, url: request.url, body });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/projects/qa")
      return response.end(
        JSON.stringify({ id: "qa", name: "QA", root: directory }),
      );
    if (request.url === "/api/workflows" && request.method === "POST") {
      validateGraph(body);
      return response.end(JSON.stringify(body));
    }
    if (request.url === "/api/providers/gemini-video")
      return response.end(
        JSON.stringify({
          authMode: body?.authMode || "api-key",
          hasApiKey: true,
          ready: true,
        }),
      );
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Unknown fixture route" }));
  });
  await new Promise((done) => api.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => api.close(done)));
  const url = `http://localhost:${api.address().port}`;
  const cli = resolve(import.meta.dirname, "../cli/weft.mjs");
  const command = async (...args) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [cli, ...args, "--url", url, "--project", "qa", "--json"],
          { cwd: directory },
        )
      ).stdout,
    );
  const modes = [
    {
      id: "google",
      label: "Gemini",
      providerId: "gemini-video",
      model: "gemini-omni-1.1-flash",
      count: 1,
    },
    {
      id: "grok",
      label: "Grok",
      providerId: "grok-video",
      model: "grok-imagine-video-1.5",
      count: 1,
    },
  ];
  const modesFile = join(directory, "modes.json");
  await writeFile(modesFile, JSON.stringify(modes));
  const cliGraph = await command(
    "workflow",
    "create",
    "--id",
    "cli-motion",
    "--modes",
    modesFile,
    "--name",
    "Motion",
    "--media",
    "video",
    "--prompt",
    "A runner sprints",
    "--resolution",
    "1080p",
    "--count",
    "2",
  );
  assert.equal(cliGraph.projectId, "qa");
  assert.equal(
    cliGraph.nodes.find((node) => node.type === "video-generate").data.video
      .resolution,
    "1080p",
  );
  assert.equal(planWorkflow(cliGraph).videoJobs, 2);
  const key = "fixture-private-key";
  const file = join(directory, "private.json");
  await writeFile(file, JSON.stringify({ authMode: "api-key", apiKey: key }));
  const configured = await command(
    "providers",
    "configure-video",
    "--from",
    file,
  );
  assert.ok(!JSON.stringify(configured).includes(key));
  assert.equal((await command("providers", "gemini-video")).hasApiKey, true);
  const client = new WeftClient({ url });
  assert.equal((await client.geminiVideoConnection()).hasApiKey, true);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dirname, "../mcp/server.mjs")],
    env: { ...process.env, WEFT_URL: url, WEFT_PROJECT: "qa" },
    stderr: "pipe",
  });
  const mcp = new Client({ name: "video-agent-test", version: "1" });
  await mcp.connect(transport);
  t.after(() => mcp.close());
  const tools = (await mcp.listTools()).tools.map((tool) => tool.name);
  for (const name of [
    "create_video_workflow",
    "read_gemini_video_connection",
    "configure_gemini_video",
  ])
    assert.ok(tools.includes(name));
  const created = await mcp.callTool({
    name: "create_video_workflow",
    arguments: {
      id: "mcp-motion",
      name: "Motion",
      prompt: "A runner sprints",
      video: { resolution: "1080p" },
      modes,
      count: 2,
    },
  });
  assert.ok(!created.isError, JSON.stringify(created));
  const mcpGraph = created.structuredContent.data;
  assert.equal(mcpGraph.projectId, "qa");
  assert.equal(planWorkflow(mcpGraph).videoJobs, 2);
  assert.deepEqual(mcpGraph.nodes, cliGraph.nodes);
  assert.deepEqual(mcpGraph.edges, cliGraph.edges);
  const saved = await mcp.callTool({
    name: "configure_gemini_video",
    arguments: { connection: { authMode: "api-key", apiKey: key } },
  });
  assert.ok(!saved.isError);
  assert.ok(!JSON.stringify(saved).includes(key));
  assert.equal(
    requests.filter((request) => request.method === "PUT").at(-1).body.apiKey,
    key,
  );
  assert.ok(!JSON.stringify(mcpGraph).includes(key));
});

test("page-aware agent sees video counts and can edit the same video node without inference", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "weft-video-context-"));
  const store = new Store(root);
  await store.init();
  const agent = new AgentConversations({
    store,
    projects: new ProjectService(store),
    dataRoot: root,
  });
  t.after(async () => {
    await agent.close();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  await store.saveWorkflow(
    createVideoWorkflow({ id: "motion", prompt: "A road cyclist", count: 2 }),
  );
  const context = agent.resolve(
    {},
    {
      page: "canvas",
      workflowId: "motion",
      selectedNodeIds: ["generate"],
      regionIds: [],
    },
  );
  assert.deepEqual(context.plan, {
    total: 2,
    textJobs: 0,
    imageJobs: 0,
    videoJobs: 2,
  });
  const { graph: edited } = applyAgentEdits(context.workflow, [
    {
      op: "update-node",
      nodeId: "generate",
      data: { video: { resolution: "1080p" }, count: 3 },
    },
  ]);
  assert.equal(planWorkflow(edited).videoJobs, 3);
  assert.equal(
    edited.nodes.find((n) => n.id === "generate").data.video.resolution,
    "1080p",
  );
  assert.equal(store.runs.size, 0);
});
