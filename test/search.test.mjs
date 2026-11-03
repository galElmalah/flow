import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { VectorIndex } from "../server/search/vectors.mjs";
import {
  galleryItems,
  imageDocument,
  matchesSearch,
} from "../server/search/documents.mjs";
import { searchRequest } from "../server/routes/search.mjs";

test("semantic projection preserves full source tails, provenance and gallery eligibility", () => {
  const run = {
    id: "r",
    workflowId: "w",
    projectId: "p",
    name: "Test",
    jobs: [
      {
        id: "ok",
        status: "completed",
        output: "/image.png",
        prompt: `${"generic style ".repeat(300)} a nocturnal fox on the final page`,
        records: [
          {
            fields: {
              scene: "A fox at night",
              quote: "Quiet courage",
              brief: "Repeated negative art rules and common instructions",
            },
          },
        ],
      },
      { id: "failed", status: "failed", output: "/bad.png" },
      { id: "text", kind: "text", status: "completed", output: "/text" },
    ],
  };
  const items = galleryItems([run]);
  assert.equal(items.length, 1);
  assert.equal(items[0].projectId, "p");
  const document = imageDocument(items[0]);
  assert.equal(document.key, "r/ok");
  assert(
    document.chunks.some((s) => s.includes("nocturnal fox on the final page")),
  );
  assert(document.chunks.includes("Quiet courage"));
  assert.equal(
    document.weights[
      document.chunks.findIndex((text) =>
        text.includes("Repeated negative art rules"),
      )
    ],
    0.7,
  );
  assert.equal(document.weights[document.chunks.indexOf("A fox at night")], 1);
  assert.equal(
    document.sourceHash,
    imageDocument({ ...items[0], message: "progress", projectId: "another" })
      .sourceHash,
  );
  assert.notEqual(
    document.sourceHash,
    imageDocument({ ...items[0], prompt: "Changed subject" }).sourceHash,
  );
  assert(matchesSearch(items[0], { scope: "project:p", workflowId: "w" }));
  assert(!matchesSearch(items[0], { scope: "project:another" }));
});

test("durable vector search filters before top-k, updates ownership without reembedding, excludes stale versions and late writes", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "flow-search-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "vectors.sqlite");
  let index = new VectorIndex(file, "test-model-v1", 2);
  const doc = (key, projectId) => ({
    key,
    sourceHash: key,
    projectId,
    workflowId: "w",
    runId: "r",
    providerId: "codex",
    chunks: ["Scene"],
    exact: "",
  });
  const outside = doc("outside", "other"),
    inside = doc("inside", "mine");
  index.reconcile([outside, inside]);
  index.commit(outside, [[1, 0]]);
  index.commit(inside, [[0.8, 0.6]]);
  let result = index.search([1, 0], {
    query: "meaning",
    scope: "project:mine",
    limit: 1,
  });
  assert.deepEqual(
    result.matches.map((r) => r.key),
    ["inside"],
  );
  assert(Math.abs(result.matches[0].similarity - 0.8) < 0.0001);
  assert.equal(
    index.search([1, 0], {
      query: "meaning",
      scope: "all",
      workflowId: "missing",
    }).total,
    0,
  );
  index.close();
  index = new VectorIndex(file, "test-model-v1", 2);
  assert.equal(index.coverage().indexed, 2);
  index.reconcile([{ ...inside, projectId: "moved" }, outside]);
  assert.equal(
    index.search([1, 0], { query: "meaning", scope: "project:mine" }).total,
    0,
  );
  assert.equal(
    index.search([1, 0], { query: "meaning", scope: "project:moved" }).total,
    1,
  );
  const changed = { ...inside, sourceHash: "changed", chunks: ["New subject"] };
  index.reconcile([changed]);
  assert.equal(index.commit(inside, [[1, 0]]), false);
  assert.equal(index.coverage().indexed, 0);
  assert.equal(
    index.search([1, 0], { query: "meaning", scope: "all" }).total,
    0,
  );
  assert.throws(() => index.commit(changed, [[1]]), /Invalid local embedding/);
  index.commit(changed, [[0, 1]]);
  index.close();
  index = new VectorIndex(file, "test-model-v2", 2);
  assert.equal(
    index.search([0, 1], { query: "meaning", scope: "all" }).total,
    0,
  );
  index.reconcile([changed]);
  assert.equal(index.coverage().indexed, 0);
  index.close();
});

test("search boundary rejects unbounded requests, malformed scopes and unknown parameters", () => {
  assert.equal(
    searchRequest.parse({ query: "  rest beside ruined columns " }).query,
    "rest beside ruined columns",
  );
  for (const input of [
    { query: " " },
    { query: "a".repeat(501) },
    { query: "ok", limit: 10000 },
    { query: "ok", scope: "sql:all" },
    { query: "ok", modelPath: "/tmp/model" },
  ])
    assert.equal(searchRequest.safeParse(input).success, false);
});

test("a matching scene outranks a more similar shared art-direction passage", () => {
  const index = new VectorIndex(":memory:", "weighted", 2);
  const doc = (key, weights) => ({
    key,
    sourceHash: key,
    projectId: null,
    workflowId: "w",
    runId: "r",
    providerId: "codex",
    chunks: ["specific scene", "shared template"],
    weights,
    exact: "",
  });
  const bust = doc("bust", [1, 0.7]),
    bird = doc("bird", [1, 0.7]);
  index.reconcile([bust, bird]);
  index.commit(bust, [
    [0.8, 0.6],
    [0.2, 0.98],
  ]);
  index.commit(bird, [
    [0.1, 0.995],
    [1, 0],
  ]);
  assert.equal(
    index.search([1, 0], { query: "thinker beside ruins", limit: 1 }).matches[0]
      .key,
    "bust",
  );
  index.close();
});
