export const assetScope = (projectId) =>
  projectId === undefined ? {} : { projectId: projectId ?? "unassigned" };

export function assetImage(asset) {
  return {
    id: asset.origin?.type === "job" ? asset.origin.jobId : asset.id,
    assetId: asset.id,
    output: asset.url,
    kind: asset.kind,
    runId: asset.origin?.type === "job" ? asset.origin.runId : undefined,
    workflowId: asset.origin?.workflowId || asset.generation?.workflowId,
    projectId: asset.projectId ?? null,
    label: assetLabel(asset),
  };
}

export function assetLabel(asset) {
  return (
    asset.generation?.nodeLabel ||
    asset.displayName ||
    asset.provenance?.promptSet?.label ||
    asset.origin?.originalName ||
    asset.provenance?.segmentation?.label ||
    asset.annotations?.caption ||
    (asset.origin?.type === "job-input"
      ? "Captured source image"
      : undefined) ||
    (asset.origin?.type === "job" ? "Generated image" : "Source image")
  );
}

export function resolveInspectionAsset(assets, image) {
  const matches = assets.filter((asset) => asset.url === image.output);
  return (
    matches.find(
      (asset) =>
        image.runId &&
        asset.origin?.runId === image.runId &&
        (!image.id || asset.origin?.jobId === image.id),
    ) ||
    matches.find(
      (asset) => asset.origin?.type === "job" && asset.origin?.role === "final",
    ) ||
    matches[0]
  );
}
