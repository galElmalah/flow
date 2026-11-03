import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerLocalModelRoutes } from "../server/routes/local-models.mjs";
import { FlowClient } from "../client/index.mjs";
import { localModelPreset } from "../shared/local-model-presets.mjs";

test("local lifecycle API protects active jobs and reports only completed inference at the current endpoint", async (t) => {
  const jobs = [
    {
      id: "earlier",
      providerId: "ollama",
      model: "small",
      status: "completed",
      finishedAt: "2026-10-31",
      metadata: { effectiveSettings: { endpoint: "http://127.0.0.1:11434" } },
    },
    {
      id: "other-endpoint",
      providerId: "ollama",
      model: "large",
      status: "completed",
      finishedAt: "2026-11-02",
      metadata: { effectiveSettings: { endpoint: "http://127.0.0.1:11435" } },
    },
    { id: "active", providerId: "ollama", status: "running" },
  ];
  const store = { runs: new Map([["run", { id: "run", jobs }]]) };
  const queue = { active: new Map([["active", { runId: "run" }]]) };
  let stops = 0;
  const runtime = (id) => ({
    id,
    running: true,
    baseUrl: `http://127.0.0.1:${id === "ollama" ? 11434 : 8188}`,
    models: [],
    verifiedInference: false,
  });
  const runtimes = {
    status: async (id) =>
      id
        ? runtime(id)
        : { hardware: {}, runtimes: [runtime("ollama"), runtime("comfyui")] },
    stop: async (id) => {
      stops++;
      return runtime(id);
    },
    configure: async (id, body) => ({ ...runtime(id), ...body }),
  };
  const providers = {
    runtimes,
    comfy: { profiles: async () => [] },
    reload: async () => [],
    statusCache: new Map(),
  };
  const app = express();
  app.use(express.json());
  registerLocalModelRoutes(app, { store, queue, providers });
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new FlowClient({
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await assert.rejects(
    client.localModelAction("ollama", "stop"),
    (error) => error.status === 409,
  );
  assert.equal(stops, 0);
  const status = await client.localModels("ollama");
  assert.equal(status.lastGeneration.model, "small");
  assert.equal(status.verifiedInference, true);
  assert.equal((await client.localModels("comfyui")).verifiedInference, false);
  const facts = localModelPreset("moss-image-sft-int8").weights.map(
    (weight) => ({
      ...weight,
      present: true,
      hashVerified: false,
    }),
  );
  jobs.push({
    id: "moss",
    providerId: "comfyui-image",
    model: "custom-moss-profile",
    status: "completed",
    finishedAt: "2026-11-02",
    metadata: {
      width: 512,
      height: 512,
      modelFacts: facts,
      effectiveSettings: { endpoint: "http://127.0.0.1:8188" },
    },
  });
  assert.deepEqual((await client.localModels("comfyui")).presetGenerations, {});
  for (const fact of facts) fact.hashVerified = true;
  jobs.push({
    id: "newer-sd",
    providerId: "comfyui-image",
    model: "sd15",
    status: "completed",
    finishedAt: "2026-11-03",
    metadata: { effectiveSettings: { endpoint: "http://127.0.0.1:8188" } },
  });
  const proven = await client.localModels("comfyui");
  assert.equal(proven.lastGeneration.model, "sd15");
  assert.equal(proven.presetGenerations["moss-image-sft-int8"].jobId, "moss");
  assert.equal(proven.presetGenerations["moss-image-sft-int8"].width, 512);
  await assert.rejects(
    client.configureLocalRuntime("comfyui", { baseUrl: "https://example.com" }),
    (error) => error.status === 400,
  );
  queue.active.clear();
  await client.localModelAction("ollama", "stop");
  assert.equal(stops, 1);
});

test("MOSS preset install is exposed through the public client and preserves an existing profile", async (t) => {
  const profiles = [];
  let installs = 0,
    reloads = 0;
  const providers = {
    runtimes: {
      installPreset: async (id, onInstalled) => {
        installs++;
        await onInstalled();
        return { id: "comfyui", task: { presetId: id, status: "completed" } };
      },
    },
    comfy: {
      profiles: async () => profiles,
      saveProfile: async (profile) => profiles.push(profile),
    },
    reload: async () => reloads++,
  };
  const queue = { active: new Map() };
  const store = {
    runs: new Map([
      ["run", { jobs: [{ id: "job", providerId: "comfyui-image" }] }],
    ]),
  };
  const app = express();
  app.use(express.json());
  registerLocalModelRoutes(app, { providers, queue, store });
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new FlowClient({
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await assert.rejects(
    client.installLocalModel("unknown-model"),
    (error) => error.status === 400,
  );
  assert.equal(installs, 0);
  await client.installLocalModel("moss-image-sft");
  assert.equal(profiles[0].id, "moss-image-sft");
  assert.equal(profiles[0].requiredModels.length, 3);
  profiles[0].graph["7"].inputs.steps = 40;
  await client.installLocalModel("moss-image-sft");
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].graph["7"].inputs.steps, 40);
  assert.equal(reloads, 2);
  queue.active.set("job", { runId: "run" });
  await assert.rejects(
    client.installLocalModel("moss-image-sft"),
    (error) => error.status === 409,
  );
  assert.equal(installs, 2);
});
