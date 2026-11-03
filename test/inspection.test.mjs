import test from "node:test";
import assert from "node:assert/strict";
import { inputTypes, outputType } from "../shared/graph.mjs";
import {
  nodeInterfaces,
  templateParameters,
  describeField,
  inspectGeneration,
  recordFields,
  recordTitle,
  recordIdentity,
  upstreamNodes,
} from "../shared/inspection.mjs";

const node = (id, type, data) => ({ id, type, data: { label: id, ...data } });
const record = (id) => ({
  nodeId: "records",
  id,
  fields: { readingID: id, quote: `Passage ${id}`, author: `Author ${id}` },
});
const run = () => ({
  id: "saved-run",
  graph: {
    nodes: [
      node("references", "image", { images: ["/files/uploads/reference.png"] }),
      node("records", "dataset"),
      node("scene", "template", { text: "Saved scene {{readingID}}" }),
      node("writer", "prompt-generate", { text: "Saved writer instructions" }),
      node("style", "template", { text: "Saved engraving rules {{input}}" }),
      node("images", "generate"),
    ],
    edges: [
      ["records", "scene"],
      ["scene", "writer"],
      ["references", "writer"],
      ["writer", "style"],
      ["style", "images"],
    ].map(([source, target]) => ({ source, target })),
  },
  jobs: [
    ...["a", "b"].map((id) => ({
      id: `writer-${id}`,
      nodeId: "writer",
      kind: "text",
      label: "Scene writer",
      prompt: `Resolved source prompt ${id}`,
      resultText: `Generated scene ${id}`,
      records: [record(id)],
      images: [{ asset: "/files/uploads/reference.png" }],
      dependencies: [],
    })),
    ...["a", "b"].map((id) => ({
      id: `image-${id}`,
      nodeId: "images",
      kind: "image",
      prompt: `Final image prompt ${id}`,
      output: `/files/runs/saved-run/image-${id}/output.png`,
      records: [record(id)],
      images: [{ asset: "/files/uploads/reference.png" }],
      dependencies: [`writer-${id}`],
      promptParts: [{ literal: "Engraving rules" }, { jobId: `writer-${id}` }],
    })),
  ],
});

test("every supported node describes each real input and output type", () => {
  for (const [type, expected] of Object.entries(inputTypes)) {
    const spec = nodeInterfaces[type];
    assert.ok(spec.description.length > 20);
    assert.deepEqual(
      spec.inputs.map((p) => p.type),
      expected,
    );
    assert.deepEqual(
      spec.outputs.map((p) => p.type),
      outputType(type) ? [outputType(type)] : [],
    );
    assert.ok(
      [...spec.inputs, ...spec.outputs].every(
        (p) => p.label && p.description.length > 20,
      ),
    );
  }
});
test("template fields are unique and explain record values versus upstream generated text", () => {
  assert.deepEqual(
    templateParameters("{{ readingID }} {{input}} {{readingID}} {{scene}}"),
    ["readingID", "input", "scene"],
  );
  assert.match(describeField("readingID"), /exact passage/);
  assert.match(describeField("input"), /generated scene briefs/);
  assert.match(describeField("customScene"), /customScene.*each input record/);
});
test("an image inspector isolates that image's record and prompt dependencies", () => {
  const r = run(),
    image = r.jobs.find((j) => j.id === "image-a"),
    detail = inspectGeneration(image, r);
  assert.equal(detail.records[0].fields.readingID, "a");
  assert.deepEqual(
    detail.stages.map((j) => j.id),
    ["writer-a"],
  );
  assert.equal(detail.stages[0].prompt, "Resolved source prompt a");
  assert.equal(detail.stages[0].resultText, "Generated scene a");
  assert.equal(detail.stages[0].instructions, "Saved writer instructions");
  assert.equal(detail.references[0].url, "/files/uploads/reference.png");
  assert.equal(detail.references[0].label, "references");
  assert.equal(detail.job.prompt, "Final image prompt a");
  assert.deepEqual(
    detail.sources.map((n) => n.id),
    ["scene", "style"],
  );
});
test("saved generation inputs win over a stale gallery entry without depending on current canvas edits", () => {
  const r = run(),
    image = {
      ...r.jobs.find((j) => j.id === "image-a"),
      prompt: "Incorrect current prompt",
    };
  const currentCanvas = structuredClone(r.graph);
  currentCanvas.nodes.find((n) => n.id === "style").data.text =
    "Edited rules for the next run";
  const detail = inspectGeneration(image, r);
  assert.equal(detail.job.prompt, "Final image prompt a");
  assert.equal(
    detail.sources.find((n) => n.id === "style").data.text,
    "Saved engraving rules {{input}}",
  );
});
test("generated-image references resolve to saved outputs and missing jobs are explicit", () => {
  const r = run(),
    image = r.jobs.find((j) => j.id === "image-b");
  image.images.push({ jobId: "image-a" });
  image.dependencies.push("image-a", "unavailable-job");
  const detail = inspectGeneration(image, r);
  assert.equal(
    detail.references[1].url,
    "/files/runs/saved-run/image-a/output.png",
  );
  assert.equal(detail.stages.filter((s) => s.id === "writer-a").length, 1);
  assert.deepEqual(
    detail.stages.find((s) => s.id === "unavailable-job"),
    { id: "unavailable-job", missing: true },
  );
});
test("reference images and legacy jobs without quote metadata remain inspectable", () => {
  assert.deepEqual(recordFields({}), {});
  assert.equal(recordTitle({}), "");
  assert.equal(recordIdentity({}), undefined);
  const detail = inspectGeneration({
    output: "/assets/reference.png",
    prompt: "Seed image",
  });
  assert.deepEqual(detail.records, []);
  assert.deepEqual(detail.stages, []);
  assert.deepEqual(detail.sources, []);
  const cover = {
    records: [
      {
        id: "category-one",
        fields: {
          role: "category",
          title: "Ancient Philosophy",
          assetID: "ancient_philosophy",
        },
      },
    ],
  };
  assert.equal(recordTitle(cover), "Category · Ancient Philosophy");
  assert.equal(recordIdentity(cover), "ancient_philosophy");
});
test("shared upstream inputs appear once when multiple branches rejoin", () => {
  const g = run().graph;
  g.edges.push({ source: "scene", target: "style" });
  const ids = upstreamNodes(g, "images").map((n) => n.id);
  assert.equal(ids.filter((id) => id === "scene").length, 1);
  assert.ok(ids.includes("references"));
});
test("image collections do not attribute prompts from a different generation branch", () => {
  const r = run(),
    original = r.jobs.find((j) => j.id === "image-a");
  r.graph.nodes.push(
    node("other-template", "template", { text: "An unrelated scene" }),
    node("other-generator", "generate"),
    node("collection", "output"),
    node("refine", "generate"),
  );
  r.graph.edges.push(
    { source: "other-template", target: "other-generator" },
    { source: "other-generator", target: "collection" },
    { source: "images", target: "collection" },
    { source: "collection", target: "refine" },
  );
  const edited = {
    ...original,
    id: "edited-a",
    nodeId: "refine",
    images: [{ jobId: original.id }],
    dependencies: [original.id],
    promptParts: [{ literal: "Refine this image" }],
  };
  r.jobs.push(edited);
  const detail = inspectGeneration(edited, r);
  assert.deepEqual(
    detail.sources.map((n) => n.id),
    ["scene", "style"],
  );
  assert.equal(detail.references[0].url, original.output);
});
test("pending run data is not presented as missing input jobs", () => {
  const r = run(),
    original = r.jobs.find((j) => j.id === "image-a");
  assert.deepEqual(inspectGeneration(original).stages, []);
  assert.equal(inspectGeneration(original).records[0].id, "a");
});
