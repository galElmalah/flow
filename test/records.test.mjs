import test from "node:test";
import assert from "node:assert/strict";
import { parseRecords, expandTemplate } from "../shared/records.mjs";
import { planWorkflow } from "../server/graph.mjs";
const node = (id, type, data = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, ...data },
});
const edge = (source, target, type = "text") => ({
  id: source + "-" + target,
  source,
  target,
  targetHandle: type,
});
const records = Array.from({ length: 10 }, (_, i) => ({
  id: "quote-" + i,
  fields: {
    readingID: "quote-" + i,
    quote: "Quote " + i,
    author: "Author " + i,
    scene: "Scene " + i,
  },
}));
const graph = () => ({
  id: "batch",
  name: "Quote batch",
  nodes: [
    node("quotes", "dataset", { records }),
    node("template", "template", {
      text: "{{readingID}}\n{{quote}}\n{{author}}\nScene: {{scene}}",
    }),
    node("writer", "prompt-generate", {
      providerId: "claude-code",
      text: "Write the prompt",
    }),
    node("style", "template", {
      text: "Exact quote {{readingID}}\n{{input}}\nStyle: cobalt engraving",
    }),
    node("image", "generate", { ratio: "2:1", count: 1 }),
  ],
  edges: [
    edge("quotes", "template"),
    edge("template", "writer"),
    edge("writer", "style"),
    edge("style", "image"),
  ],
});
test("ten quote records produce ten prompts and ten images with stable exact reading identities", () => {
  const plan = planWorkflow(graph());
  assert.equal(plan.textJobs, 10);
  assert.equal(plan.imageJobs, 10);
  const writers = plan.jobs.filter((j) => j.kind === "text"),
    images = plan.jobs.filter((j) => j.kind === "image");
  for (let i = 0; i < 10; i++) {
    assert.ok(writers[i].prompt.includes("Scene: Scene " + i));
    assert.equal(images[i].records[0].id, "quote-" + i);
    assert.deepEqual(images[i].dependencies, [writers[i].id]);
    assert.equal(images[i].ratio, "2:1");
    assert.deepEqual(
      images[i].promptParts.map((p) => p.jobId).filter(Boolean),
      [writers[i].id],
    );
  }
});
test("forked branches from the same quote list rejoin by identity rather than multiplying ten into a hundred", () => {
  const g = graph();
  g.nodes.push(node("extra", "template", { text: "Metadata {{readingID}}" }));
  g.edges.push(edge("quotes", "extra"), edge("extra", "image"));
  const plan = planWorkflow(g);
  assert.equal(plan.imageJobs, 10);
  assert.equal(
    new Set(
      plan.jobs.filter((j) => j.kind === "image").map((j) => j.records[0].id),
    ).size,
    10,
  );
});
test("CSV imports quoted commas, multiline quotes, quotes inside quotes, and stable IDs; JSON preserves canonical fields", () => {
  const csv =
    'readingID,quote,author,scene\r\na,"A comma, and a ""quote""\nnext line",Author,Quiet arch\r\nb,Second,B,Open blue';
  const rows = parseRecords(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "a");
  assert.equal(rows[0].fields.quote, 'A comma, and a "quote"\nnext line');
  assert.deepEqual(parseRecords(JSON.stringify(rows)), rows);
  assert.throws(
    () => parseRecords('[{"id":"same","quote":"a"},{"id":"same","quote":"b"}]'),
    /unique/,
  );
  assert.throws(() => parseRecords("quote,scene\na"), /different number/);
  assert.throws(() => parseRecords('quote\n"unfinished'), /unclosed/);
});
test("templates fail before inference for missing data and preserve literal content without recursive substitution", () => {
  assert.throws(
    () => expandTemplate("{{missing}}", { text: [], fields: {} }),
    /missing/,
  );
  assert.deepEqual(
    expandTemplate("{{quote}}", {
      text: [],
      fields: { quote: "{{not_a_field}}" },
    }),
    [{ literal: "{{not_a_field}}" }],
  );
  const g = graph();
  g.nodes[1].data.text = "{{missing}}";
  assert.throws(() => planWorkflow(g), /missing/);
  g.nodes[1].data.text = "{{quote}}";
  g.nodes[0].data.records = [records[0], records[0]];
  assert.throws(() => planWorkflow(g), /unique/);
});
