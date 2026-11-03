import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSharedWorkflow } from "../examples/quoture/shared-workflow.mjs";
import { promptGuide } from "../shared/prompt-guide.mjs";
import { planWorkflow } from "../server/graph.mjs";
import { createImageWorkflow } from "../client/workflows.mjs";

test("Quoture's guide locates the shared brief and separates quote and cover execution paths", async () => {
  const original = JSON.parse(
    await readFile(
      new URL("./fixtures/quote-records.json", import.meta.url),
    ),
  );
  const graph = buildSharedWorkflow(original, [
    { id: "category-example", fields: { role: "category", assetID: "category-example", title: "Learning", background: "warm ochre", ratio: "1:1", scene: "A simple book", sourceTitle: "Synthetic fixture", sourceLocator: "category" } },
    { id: "journey-example", fields: { role: "journey", assetID: "journey-example", title: "Practice", background: "deep olive", ratio: "2:1", scene: "A path beside a tree", sourceTitle: "Synthetic fixture", sourceLocator: "journey" } },
  ], ["/assets/paper-seed.png"]);
  const plan = planWorkflow(graph);
  const guide = promptGuide(graph, {
    nodes: Object.fromEntries(
      graph.nodes.map((n) => [
        n.id,
        plan.jobs.filter((j) => j.nodeId === n.id).length,
      ]),
    ),
  });
  assert(
    guide.starts.some(
      (n) => n.id === "shared-style" && n.kind === "Base prompt",
    ),
  );
  const quotes = guide.flows.find((f) => f.id === "collection"),
    covers = guide.flows.find((f) => f.id === "cover-collection");
  assert.equal(quotes.textJobs, 10);
  assert.equal(quotes.imageJobs, 10);
  assert.equal(covers.textJobs, 2);
  assert.equal(covers.imageJobs, 2);
  assert(quotes.steps.some((s) => s.id === "scene-writer"));
  assert(!quotes.steps.some((s) => s.id === "cover-writer"));
  assert(covers.steps.some((s) => s.id === "shared-style"));
});

test("a frozen-brief workflow points to record prompts instead of claiming an empty direction is the base", () => {
  const graph = createImageWorkflow({
    prompt: "",
    records: [
      { id: "one", fields: { brief: "A bird beside a river" } },
      { id: "two", fields: { brief: "Two travellers" } },
    ],
    template: "{{brief}}",
  });
  const guide = promptGuide(graph);
  assert.deepEqual(
    guide.starts.map((s) => s.id),
    ["records"],
  );
  assert.match(guide.starts[0].description, /brief/);
  assert.equal(guide.optional[0].id, "prompt");
  assert.equal(guide.flows[0].textJobs, null);
  assert(
    guide.flows[0].steps.findIndex((n) => n.id === "record-template") <
      guide.flows[0].steps.findIndex((n) => n.id === "generate"),
  );
});
