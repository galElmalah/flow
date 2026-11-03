export function peakOverlap(intervals) {
  const events = intervals.flatMap(({ start, end }) =>
    Number.isFinite(start) && Number.isFinite(end) && end > start
      ? [
          { at: start, delta: 1 },
          { at: end, delta: -1 },
        ]
      : [],
  );
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let active = 0,
    peak = 0;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}
export function summarizePhase(
  run,
  { submittedAt, settledAt, observedPeak, toolCalls, outputs },
) {
  const completed = run.jobs.filter((job) => job.status === "completed");
  const seconds = (settledAt - submittedAt) / 1000;
  return {
    runId: run.id,
    status: run.status,
    total: run.jobs.length,
    completed: completed.length,
    failed: run.jobs.filter((j) => ["failed", "blocked"].includes(j.status))
      .length,
    cancelled: run.jobs.filter((j) => j.status === "cancelled").length,
    retryAttempts: run.jobs.reduce(
      (sum, j) => sum + Math.max(0, j.attempts - 1),
      0,
    ),
    elapsedSeconds: seconds,
    completedImagesPerMinute:
      seconds > 0 ? (completed.length * 60) / seconds : null,
    observedPeakRunningJobs: observedPeak,
    peakOverlappingJobLifetimes: peakOverlap(
      run.jobs.map((j) => ({
        start: Date.parse(j.startedAt),
        end: Date.parse(j.finishedAt),
      })),
    ),
    observedImageToolCalls: toolCalls.length,
    observedCompletedImageToolCalls: toolCalls.filter(
      (call) => call.end && !call.error,
    ).length,
    observedPeakImageToolWaits: peakOverlap(
      toolCalls.map((call) => ({ start: call.start, end: call.end })),
    ),
    verifiedOutputs: outputs.filter((o) => o.valid).length,
    distinctPixelHashes: new Set(
      outputs.filter((o) => o.valid).map((o) => o.pixelSHA256),
    ).size,
    errors: run.jobs
      .filter((j) => j.error)
      .map((j) => ({ jobId: j.id, error: j.error })),
  };
}
