import { useEffect, useState } from "react";

export function useGallerySearch({
  query,
  scope,
  runId,
  providerId,
  revision,
  enabled,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const request = {
    query: query.trim(),
    scope,
    ...(runId !== "all" && { runId }),
    ...(providerId !== "all" && { providerId }),
    limit: 100,
  };
  const key = JSON.stringify(request);
  useEffect(() => {
    if (!enabled || !request.query) return;
    setSnapshot(null);
    const controller = new AbortController();
    let timer;
    const search = async () => {
      try {
        const response = await fetch("/api/gallery/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Local search could not complete.");
        if (data.index.state === "error")
          throw new Error(
            data.index.error || "Local search needs setup. Retry local search.",
          );
        if (controller.signal.aborted) return;
        setSnapshot({ key, data });
        if (["loading", "indexing"].includes(data.index.state))
          timer = setTimeout(search, 1000);
      } catch (error) {
        if (!controller.signal.aborted)
          setSnapshot({ key, error: error.message });
      }
    };
    timer = setTimeout(search, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, enabled, revision]);
  if (!query.trim()) return { active: false, loading: false, items: [] };
  if (snapshot?.key !== key) return { active: true, loading: true, items: [] };
  return {
    active: true,
    loading: false,
    items: snapshot.data?.items || [],
    total: snapshot.data?.total,
    index: snapshot.data?.index,
    error: snapshot.error,
  };
}
