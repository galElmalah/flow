import test from "node:test";
import assert from "node:assert/strict";
import {
  workflowActivity,
  workflowRunToRestore,
} from "../shared/run-state.mjs";
import { summarize } from "../server/store.mjs";
const run = (id, status, jobs, day = "01") =>
  summarize({
    id,
    workflowId: "flow",
    status,
    createdAt: `2026-10-${day}T00:00:00Z`,
    jobs: jobs.map(([nodeId, status], index) => ({
      id: String(index),
      nodeId,
      status,
    })),
  });
test("workflow activity includes concurrent agent runs and ignores a newer completed run when work is still active", () => {
  const state = workflowActivity(
    [
      run("history", "completed", [["old", "completed"]], "03"),
      run("agent-a", "running", [
        ["writer", "running"],
        ["image", "queued"],
      ]),
      run(
        "agent-b",
        "running",
        [
          ["image", "running"],
          ["image", "completed"],
        ],
        "02",
      ),
      {
        ...run("other", "running", [["other", "running"]]),
        workflowId: "other",
      },
    ],
    "flow",
  );
  assert.equal(state.status, "running");
  assert.equal(state.liveRuns, 2);
  assert.equal(state.counts.running, 2);
  assert.equal(state.counts.queued, 1);
  assert.equal(state.counts.completed, 1);
  assert.equal(state.total, 4);
  assert.equal(state.finished, 1);
  assert.equal(state.percent, 25);
  assert.deepEqual([...state.activeNodeIds].sort(), ["image", "writer"]);
});
test("refresh restores active work ahead of newer history, and progress counts unsuccessful finished jobs without claiming success", () => {
  const active = run("live", "running", [
    ["a", "completed"],
    ["a", "failed"],
    ["a", "running"],
    ["a", "queued"],
  ]);
  const newest = run("history", "completed", [["b", "completed"]], "03");
  assert.equal(workflowRunToRestore([newest, active], "flow").id, "live");
  assert.equal(workflowRunToRestore([active, newest], "flow").id, "live");
  const progress = workflowActivity([newest, active], "flow");
  assert.equal(progress.finished, 2);
  assert.equal(progress.percent, 50);
  assert.equal(progress.counts.completed, 1);
  assert.equal(
    workflowRunToRestore([{ ...active, status: "paused" }, newest], "flow").id,
    "live",
  );
  assert.equal(workflowRunToRestore([newest], "flow").id, "history");
  assert.equal(workflowRunToRestore([newest], "other"), undefined);
  assert.equal(workflowActivity([], "flow").percent, 0);
});
test("queued, retrying, paused, interrupted and completed states remain distinct; queued work never glows", () => {
  for (const [runStatus, jobStatus, expected] of [
    ["running", "queued", "queued"],
    ["running", "retrying", "retrying"],
    ["paused", "queued", "paused"],
    ["interrupted", "interrupted", "interrupted"],
    ["completed", "completed", "completed"],
    ["failed", "failed", "failed"],
  ]) {
    const state = workflowActivity(
      [run("a", runStatus, [["image", jobStatus]])],
      "flow",
    );
    assert.equal(state.status, expected);
    assert.equal(state.activeNodeIds.size, 0);
  }
  const draining = workflowActivity(
    [
      run("a", "paused", [
        ["image", "running"],
        ["image", "queued"],
      ]),
    ],
    "flow",
  );
  assert.equal(draining.status, "paused");
  assert.ok(draining.activeNodeIds.has("image"));
  assert.equal(workflowActivity([], "flow").status, "idle");
});

test("recorded-run activity is pinned to its own counts rather than newer or active workflow runs", () => {
  const recorded = run("recorded", "completed", [
    ["image", "completed"],
    ["image", "completed"],
  ]);
  const newer = run(
    "newer",
    "running",
    [
      ["image", "running"],
      ["image", "queued"],
      ["image", "queued"],
    ],
    "03",
  );
  const activity = workflowActivity([newer, recorded], "flow", "recorded");
  assert.equal(activity.runId, "recorded");
  assert.equal(activity.total, 2);
  assert.equal(activity.counts.completed, 2);
  assert.equal(activity.status, "completed");
  assert.equal(
    workflowActivity([newer, recorded], "flow", "missing").status,
    "idle",
  );
});
