import test from "node:test";
import assert from "node:assert/strict";
import {
  assetImage,
  assetLabel,
  resolveInspectionAsset,
  assetScope,
} from "../shared/asset-inspection.mjs";

test("a reused generated URL resolves its original asset even when its canvas ID is synthetic", () => {
  const upload = {
    id: "uploaded",
    url: "/files/image.png",
    origin: { type: "upload", originalName: "seed.png" },
  };
  const generated = {
    id: "generated",
    url: upload.url,
    origin: {
      type: "job",
      role: "final",
      runId: "original-run",
      jobId: "original-job",
    },
  };
  assert.equal(
    resolveInspectionAsset([upload, generated], {
      output: upload.url,
      id: "canvas-reference-0",
    }).id,
    "generated",
  );
  const inspected = assetImage(generated);
  assert.equal(inspected.id, "original-job");
  assert.equal(inspected.runId, "original-run");
  assert.equal(inspected.assetId, "generated");
  assert.equal(assetLabel(upload), "seed.png");
  assert.equal(
    assetLabel({
      ...generated,
      displayName: "Seed images",
      generation: { nodeLabel: "Original cycling scene" },
    }),
    "Original cycling scene",
  );
});

test("captured inputs retain asset identity without attributing their consumer's prompt", () => {
  const snapshot = {
    id: "snapshot",
    url: "/files/input-1.png",
    origin: { type: "job-input", runId: "consumer-run", jobId: "consumer-job" },
  };
  const inspected = assetImage(snapshot);
  assert.equal(inspected.id, "snapshot");
  assert.equal(inspected.runId, undefined);
  assert.equal(inspected.assetId, "snapshot");
  assert.equal(inspected.label, "Captured source image");
  assert.deepEqual(assetScope(null), { projectId: "unassigned" });
  assert.deepEqual(assetScope(undefined), {});
  assert.deepEqual(assetScope("one"), { projectId: "one" });
});
