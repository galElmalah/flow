export const jobResultScope = (job) =>
  JSON.stringify(
    job.promptSet
      ? [job.nodeId, job.promptSet.nodeId, job.promptSet.itemId]
      : [job.nodeId],
  );

export function overlayJobResults(previous, current) {
  const replaced = new Set(current.map(jobResultScope));
  return [
    ...previous.filter((job) => !replaced.has(jobResultScope(job))),
    ...current,
  ];
}
