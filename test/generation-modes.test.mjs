import test from "node:test";
import assert from "node:assert/strict";
import {
  createImageWorkflow,
  createVideoWorkflow,
} from "../client/workflows.mjs";
import { planWorkflow } from "../server/graph.mjs";
import { validateGraph } from "../shared/graph.mjs";

const modes = [
  {
    id: "codex",
    label: "Codex",
    providerId: "codex",
    model: "native",
    count: 2,
  },
  {
    id: "grok",
    label: "Grok",
    providerId: "grok-image",
    model: "grok-imagine-image-2.0",
    count: 3,
  },
];
test("comparison modes pair each source record and copy across providers without changing inputs", () => {
  const graph = createImageWorkflow({
    prompt: "Monochrome",
    images: ["/assets/paper-seed.png"],
    modes,
    seed: 2147483647,
    records: [
      { id: "cycling", fields: { sport: "cycling" } },
      { id: "running", fields: { sport: "running" } },
    ],
    template: "Scene: {{sport}}",
    promptProviderId: "codex-text",
  });
  const plan = planWorkflow(graph);
  assert.equal(plan.textJobs, 2);
  assert.equal(plan.imageJobs, 10);
  const images = plan.jobs.filter((j) => j.kind === "image");
  for (const record of ["cycling", "running"]) {
    const jobs = images.filter((j) => j.records[0].id === record);
    assert.equal(jobs.length, 5);
    assert.equal(new Set(jobs.map((j) => j.comparison.groupId)).size, 1);
    assert.equal(new Set(jobs.map((j) => j.dependencies[0])).size, 1);
    for (const i of [0, 1]) {
      const paired = jobs.filter((j) => j.comparison.copyIndex === i);
      assert.equal(paired.length, 2);
      assert.equal(new Set(paired.map((j) => j.seed)).size, 1);
      assert.deepEqual(paired[0].promptParts, paired[1].promptParts);
      assert.deepEqual(paired[0].images, paired[1].images);
    }
  }
  const grok = images.find((j) => j.providerId === "grok-image");
  assert.equal(grok.quality, "medium");
  assert.equal(grok.image.resolution, "1k");
  assert.deepEqual(
    plan.modes.filter((m) => m.kind === "image").map((m) => m.count),
    [4, 6],
  );
  assert.equal(planWorkflow(graph, { count: 1 }).imageJobs, 4);
  assert.throws(
    () => planWorkflow(graph, { providerId: "codex" }),
    /generation modes/,
  );
  assert.throws(
    () => planWorkflow(graph, { model: "native" }),
    /generation modes/,
  );
  const invalid = structuredClone(graph);
  invalid.nodes.find((n) => n.id === "generate").data.modes[1].id = "codex";
  assert.throws(() => validateGraph(invalid), /unique/);
});

test("chained comparison outputs retain each parent dependency instead of a new cartesian product", () => {
  const graph = createImageWorkflow({ prompt: "A runner", modes });
  graph.nodes.push({
    id: "edit",
    type: "generate",
    position: { x: 1600, y: 0 },
    data: {
      label: "One edit per result",
      text: "Change scenery",
      providerId: "local-color",
      count: 1,
    },
  });
  graph.edges.push({
    id: "results-edit",
    source: "generate",
    target: "edit",
    targetHandle: "image",
  });
  const plan = planWorkflow(graph);
  assert.equal(plan.imageJobs, 10);
  const children = plan.jobs.filter((j) => j.nodeId === "edit");
  assert.equal(children.length, 5);
  assert.equal(new Set(children.map((j) => j.dependencies[0])).size, 5);
});

test("mode settings match media type and a clean video override clears provider-specific shared settings", () => {
  const graph = createVideoWorkflow({
    prompt: "A cyclist",
    video: { resolution: "720p", durationSeconds: 8, mode: "reference" },
    modes: [
      {
        id: "google",
        label: "Gemini",
        providerId: "gemini-video",
        count: 1,
        video: { resolution: "720p" },
      },
      {
        id: "grok",
        label: "Grok",
        providerId: "grok-video",
        count: 1,
        video: { resolution: "1080p", durationSeconds: 4, mode: "image" },
      },
    ],
  });
  const plan = planWorkflow(graph);
  assert.deepEqual(plan.jobs[0].video, { resolution: "720p" });
  assert.deepEqual(plan.jobs[1].video, {
    resolution: "1080p",
    durationSeconds: 4,
    mode: "image",
  });
  const invalid = structuredClone(graph);
  invalid.nodes.find((n) => n.id === "generate").data.modes[0].image = {
    resolution: "1k",
  };
  assert.throws(() => validateGraph(invalid), /media type/);
  const onPrompt = structuredClone(graph);
  onPrompt.nodes.find((n) => n.id === "prompt").data.modes = modes;
  assert.throws(() => validateGraph(onPrompt), /generation node/);
});

test("rejoining the same seed uses the same ordered image references in preflight and execution", () => {
  const graph = createImageWorkflow({
    prompt: "A cyclist",
    images: ["/assets/paper-seed.png"],
    providerId: "grok-video",
  });
  graph.edges.push({
    id: "seed-prompt",
    source: "seed",
    target: "prompt",
    targetHandle: "image",
  });
  const job = planWorkflow(graph).jobs[0];
  assert.deepEqual(job.images, [{ asset: "/assets/paper-seed.png" }]);
});

test("shared copies apply to every mode when no per-mode count was supplied", () => {
  const graph = createImageWorkflow({
    prompt: "One scene",
    count: 4,
    modes: [
      { id: "codex", label: "Codex", providerId: "codex" },
      { id: "grok", label: "Grok", providerId: "grok-image" },
    ],
  });
  const plan = planWorkflow(graph);
  assert.equal(plan.imageJobs, 8);
  assert.deepEqual(
    plan.modes.map((mode) => mode.count),
    [4, 4],
  );
  assert.ok(plan.jobs.every((job) => job.mode.count === 4));
});

test("Grok video recipe chooses its native model when the caller only supplies the provider", () => {
  const job = planWorkflow(
    createVideoWorkflow({ prompt: "A cyclist", providerId: "grok-video" }),
  ).jobs[0];
  assert.equal(job.model, "grok-imagine-video-1.5");
});
