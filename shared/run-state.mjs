const emptyCounts = () =>
  Object.fromEntries(
    [
      "running",
      "queued",
      "retrying",
      "completed",
      "failed",
      "blocked",
      "cancelled",
      "interrupted",
    ].map((key) => [key, 0]),
  );
export function workflowRunToRestore(runs, workflowId) {
  const history = runs
    .filter((run) => run.workflowId === workflowId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    history.find((run) => run.status === "running") ||
    history.find((run) => run.status === "paused") ||
    history[0]
  );
}
export function workflowActivity(runs, workflowId, runId) {
  const history = runs
    .filter(
      (run) => run.workflowId === workflowId && (!runId || run.id === runId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const live = history.filter((run) =>
    ["running", "paused"].includes(run.status),
  );
  const selected = live.length ? live : history.slice(0, 1);
  const counts = emptyCounts(),
    activeNodeIds = new Set();
  for (const run of selected) {
    for (const key of Object.keys(counts))
      counts[key] += run.counts?.[key] || 0;
    for (const [id, node] of Object.entries(run.nodes || {}))
      if (node.running > 0) activeNodeIds.add(id);
  }
  const running = live.find((run) => run.status === "running");
  const run = running || selected[0];
  const status = running
    ? counts.running
      ? "running"
      : counts.retrying
        ? "retrying"
        : "queued"
    : run?.status || "idle";
  const labels = {
    running: "Running",
    queued: "Queued",
    retrying: "Retrying",
    paused: "Paused",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
    idle: "Ready",
  };
  const total = selected.reduce((sum, r) => sum + r.total, 0);
  const finished = [
    "completed",
    "failed",
    "blocked",
    "cancelled",
    "interrupted",
  ].reduce((sum, key) => sum + counts[key], 0);
  return {
    status,
    label: labels[status] || status,
    counts,
    activeNodeIds,
    liveRuns: live.length,
    runId: run?.id,
    total,
    finished,
    percent: total ? Math.min(100, Math.floor((100 * finished) / total)) : 0,
  };
}
