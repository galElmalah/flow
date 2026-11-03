import { useEffect, useState } from "react";
import {
  assetScope,
  resolveInspectionAsset,
} from "../../shared/asset-inspection.mjs";

const request = async (url, signal) => {
  const response = await fetch(url, { signal });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Could not load image lineage.");
  return value;
};

export function useAssetLineage(image) {
  const key = JSON.stringify([
    image.assetId,
    image.output,
    image.projectId,
    image.runId,
    image.id,
  ]);
  const [state, setState] = useState(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, loading: true });
    (async () => {
      let id = image.assetId;
      if (!id) {
        const params = new URLSearchParams({
          ...assetScope(image.projectId),
          url: image.output,
        });
        // URL references can have UI IDs. Only a known run supplies a job constraint.
        if (image.runId) params.set("runId", image.runId);
        if (image.runId && image.id) params.set("jobId", image.id);
        const result = await request(
          `/api/assets?${params}`,
          controller.signal,
        );
        id = resolveInspectionAsset(
          Array.isArray(result) ? result : result.assets || [],
          image,
        )?.id;
      }
      if (!id)
        throw new Error("No saved asset record is available for this image.");
      const lineage = await request(
        `/api/assets/${encodeURIComponent(id)}/lineage?${new URLSearchParams(assetScope(image.projectId))}`,
        controller.signal,
      );
      if (!controller.signal.aborted)
        setState({ key, lineage, loading: false });
    })().catch((error) => {
      if (!controller.signal.aborted)
        setState({ key, error: error.message, loading: false });
    });
    return () => controller.abort();
  }, [key, retry]);
  return {
    ...(state?.key === key ? state : { loading: true }),
    reload: () => setRetry((value) => value + 1),
    updateAsset: (asset) =>
      setState((value) =>
        value?.key === key
          ? {
              ...value,
              lineage: {
                ...value.lineage,
                asset: { ...value.lineage.asset, ...asset },
              },
            }
          : value,
      ),
  };
}
