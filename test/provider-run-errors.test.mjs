import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { registerRunRoutes } from "../server/routes/runs.mjs";
import {
  providerFailureFields,
  PROVIDER_NOT_READY,
} from "../shared/provider-errors.mjs";
import { WeftClient, createImageWorkflow } from "../client/index.mjs";
import { jsonRequest } from "../src/studio/ui.mjs";

async function fixture(t) {
  const graph = createImageWorkflow({
    id: "comparison",
    projectId: "sports",
    prompt: "A runner",
    providerId: "codex",
    modes: [
      {
        id: "codex",
        label: "Codex",
        providerId: "codex",
        model: "native",
        count: 1,
      },
      {
        id: "grok",
        label: "Grok",
        providerId: "grok-image",
        model: "fixture",
        count: 1,
      },
    ],
  });
  const prompt = graph.nodes.find((n) => n.type === "prompt");
  graph.nodes.push(
    {
      id: "video",
      type: "video-generate",
      position: { x: 0, y: 0 },
      data: {
        label: "Video",
        providerId: "gemini-video",
        model: "fixture",
        ratio: "16:9",
        video: { resolution: "720p" },
      },
    },
    {
      id: "video-output",
      type: "video-output",
      position: { x: 0, y: 0 },
      data: { label: "Clips" },
    },
  );
  graph.edges.push(
    {
      id: "to-video",
      source: prompt.id,
      target: "video",
      targetHandle: "text",
    },
    {
      id: "to-clips",
      source: "video",
      target: "video-output",
      targetHandle: "video",
    },
  );
  const definitions = new Map([
    [
      "codex",
      { id: "codex", name: "Codex Image", kind: "codex", models: ["native"] },
    ],
    [
      "grok-image",
      {
        id: "grok-image",
        name: "Grok Image",
        kind: "grok",
        models: ["fixture"],
      },
    ],
    [
      "gemini-video",
      {
        id: "gemini-video",
        name: "Gemini Video",
        kind: "gemini-video",
        models: ["fixture"],
        capabilities: ["video"],
        ratios: ["16:9"],
      },
    ],
  ]);
  const registry = Object.create(ProviderRegistry.prototype);
  registry.definitions = definitions;
  const ready = new Set(["codex"]);
  registry.status = async (p) => ({
    ready: ready.has(p.id),
    status:
      p.id === "grok-image"
        ? "xAI API key required. Configure it in Settings → Providers."
        : "Add a Gemini API key.",
  });
  registry.grok = { preflight() {} };
  let starts = 0;
  const queue = {
    concurrency: 4,
    create: async () => {
      starts++;
      return { id: "run", status: "queued" };
    },
  };
  const app = express();
  app.use(express.json());
  registerRunRoutes(app, {
    store: { workflows: new Map([[graph.id, graph]]) },
    projects: { assertWorkflow() {}, assertActive() {} },
    queue,
    providers: registry,
    assetPath() {
      throw new Error("No seed file should be read");
    },
  });
  app.use((error, req, res, next) =>
    res
      .status(error.status || 400)
      .json({ error: error.message, ...providerFailureFields(error) }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    graph,
    ready,
    queue,
    starts: () => starts,
  };
}

test("a multi-provider run reports every missing credential before creating any jobs or changing concurrency", async (t) => {
  const f = await fixture(t);
  const response = await fetch(f.url + "/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowId: f.graph.id, concurrency: 16 }),
  });
  assert.equal(response.status, 412);
  const failure = await response.json();
  assert.equal(failure.code, PROVIDER_NOT_READY);
  assert.deepEqual(
    failure.blockers.map((b) => b.providerId),
    ["grok-image", "gemini-video"],
  );
  assert.match(failure.error, /Grok Image.*API key.*Gemini Video.*API key/);
  assert.deepEqual(
    failure.blockers.find((b) => b.providerId === "gemini-video").nodeIds,
    ["video"],
  );
  assert.equal(f.starts(), 0);
  assert.equal(f.queue.concurrency, 4);
});

test("scoping a run excludes unrelated blockers and a configured branch can start normally", async (t) => {
  const f = await fixture(t);
  const output = f.graph.nodes.find((n) => n.type === "output").id;
  const request = () =>
    fetch(f.url + "/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId: f.graph.id,
        options: { nodeId: output },
        concurrency: 8,
      }),
    });
  const blocked = await request();
  assert.equal(blocked.status, 412);
  assert.deepEqual(
    (await blocked.json()).blockers.map((b) => b.providerId),
    ["grok-image"],
  );
  f.ready.add("grok-image");
  const started = await request();
  assert.equal(started.status, 201, JSON.stringify(await started.json()));
  assert.equal(f.starts(), 1);
  assert.equal(f.queue.concurrency, 8);
});

test("browser and agent clients preserve actionable provider errors and reject arbitrary settings links", async (t) => {
  const f = await fixture(t);
  const client = new WeftClient({ url: f.url });
  await assert.rejects(
    client.post("/api/runs", { workflowId: f.graph.id }),
    (error) => {
      assert.equal(error.status, 412);
      assert.equal(error.blockers.length, 2);
      assert.equal(error.code, PROVIDER_NOT_READY);
      return true;
    },
  );
  await assert.rejects(
    jsonRequest(f.url + "/api/runs", {
      method: "POST",
      body: JSON.stringify({ workflowId: f.graph.id }),
    }),
    (error) => {
      assert.equal(error.status, 412);
      assert.equal(error.blockers.length, 2);
      return true;
    },
  );
  assert.equal(
    providerFailureFields({
      code: PROVIDER_NOT_READY,
      blockers: [
        {
          providerId: "x",
          name: "X",
          message: "Setup",
          setupPath: "https://untrusted.example",
        },
      ],
    }).blockers[0].setupPath,
    "/settings/providers",
  );
  assert.deepEqual(
    providerFailureFields({ code: PROVIDER_NOT_READY, blockers: [null, {}] }),
    {},
  );
  assert.equal(f.starts(), 0);
});
