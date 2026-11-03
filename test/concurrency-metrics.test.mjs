import test from "node:test";
import assert from "node:assert/strict";
import {
  peakOverlap,
  summarizePhase,
} from "../tools/lib/concurrency-metrics.mjs";
test("job overlap does not count touching, missing, zero-length or inverted intervals as concurrency", () => {
  assert.equal(
    peakOverlap([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 5, end: 12 },
      { start: 4, end: 4 },
      { start: 20, end: 10 },
      { start: NaN, end: 8 },
    ]),
    2,
  );
});
test("capacity reports retain failures/retries and distinguish real output verification from job and tool overlap", () => {
  const run = {
    id: "trial",
    status: "failed",
    jobs: [
      {
        id: "a",
        status: "completed",
        attempts: 1,
        startedAt: "2026-10-29T00:00:00Z",
        finishedAt: "2026-10-29T00:00:10Z",
      },
      {
        id: "b",
        status: "failed",
        attempts: 3,
        error: "Rate limited",
        startedAt: "2026-10-29T00:00:01Z",
        finishedAt: "2026-10-29T00:00:12Z",
      },
    ],
  };
  const result = summarizePhase(run, {
    submittedAt: 0,
    settledAt: 20000,
    observedPeak: 2,
    toolCalls: [
      { start: 0, end: 8, error: false },
      { start: 9, end: 10, error: true },
    ],
    outputs: [{ jobId: "a", valid: false }],
  });
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.retryAttempts, 2);
  assert.equal(result.verifiedOutputs, 0);
  assert.equal(result.peakOverlappingJobLifetimes, 2);
  assert.equal(result.observedPeakImageToolWaits, 1);
  assert.equal(result.observedCompletedImageToolCalls, 1);
  assert.equal(result.completedImagesPerMinute, 3);
  assert.deepEqual(result.errors, [{ jobId: "b", error: "Rate limited" }]);
});
