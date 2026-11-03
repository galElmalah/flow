import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { WeftClient } from "../client/index.mjs";
const client = new WeftClient({ projectId: "quoture" });
const before = await client.runs();
const gallery = await client.request("/api/gallery");
const cases = [
  ["classical thinker resting beside ruined columns", /philosopher bust/i],
  ["a feathered creature offering comfort", /songbird/i],
  [
    "two people supporting each other on a difficult path",
    /travellers|travelers/i,
  ],
  ["patient teamwork growing herbs", /herb planter/i],
  ["reflecting on existence using a handheld looking glass", /pocket mirror/i],
];
const results = [];
for (const [query, expected] of cases) {
  const response = await client.searchImages({ query, limit: 3 });
  assert.equal(
    response.index.state,
    "ready",
    "Wait for /api/search/status to be ready before verification.",
  );
  assert(response.items.length > 0, `No semantic results for ${query}`);
  const first = response.items[0];
  assert.equal(first.projectId, "quoture");
  assert(
    expected.test(first.records?.[0]?.fields.scene || ""),
    `Wrong top scene for ${query}: ${first.records?.[0]?.fields.scene}`,
  );
  assert(
    !`${first.prompt} ${JSON.stringify(first.records)}`
      .toLowerCase()
      .includes(query.toLowerCase()),
    "Test phrase must be absent from source text.",
  );
  assert(
    gallery.some(
      (i) =>
        i.runId === first.runId &&
        i.id === first.id &&
        i.output === first.output,
    ),
  );
  const restricted = await client.searchImages({
    query,
    runId: first.runId,
    providerId: first.providerId,
    limit: 3,
  });
  assert(
    restricted.items.every(
      (i) => i.runId === first.runId && i.providerId === first.providerId,
    ),
  );
  results.push({
    query,
    topImage: first.id,
    runId: first.runId,
    scene: first.records[0].fields.scene,
    similarity: first.similarity,
    exactPhraseAbsent: true,
  });
}
assert.equal(
  (
    await client.searchImages({
      query: "a feathered creature offering comfort",
      providerId: "nonexistent-provider",
    })
  ).items.length,
  0,
);
assert.deepEqual(
  (await client.runs()).map((r) => r.id).sort(),
  before.map((r) => r.id).sort(),
  "Search must not generate images.",
);
const report = {
  checkedAt: new Date().toISOString(),
  index: await client.searchStatus(),
  results,
  noGenerationRunsCreated: true,
};
await writeFile(
  new URL("../.weft/probes/semantic-verification.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
