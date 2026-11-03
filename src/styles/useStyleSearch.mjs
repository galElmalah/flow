import { useEffect, useState } from "react";

export function useStyleSearch({ query, category, favorites, revision }) {
  const trimmed = query.trim();
  const active = Boolean(trimmed || category !== "all" || favorites);
  const params = new URLSearchParams();
  if (trimmed) params.set("search", trimmed);
  if (category !== "all") params.set("category", category);
  if (favorites) params.set("favorites", "1");
  const queryKey = params.toString();
  const key = `${queryKey}:${revision}`;
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/styles?${params}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Style search could not complete.");
        if (!controller.signal.aborted) setSnapshot({ key, queryKey, data });
      } catch (error) {
        if (!controller.signal.aborted)
          setSnapshot({ key, queryKey, error: error.message });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, active]);
  if (!active) return { active: false, loading: false };
  if (snapshot?.key !== key)
    return {
      active: true,
      loading: true,
      styles:
        snapshot?.queryKey === queryKey ? snapshot.data?.styles || [] : [],
    };
  return {
    active: true,
    loading: false,
    styles: snapshot.data?.styles || [],
    mode: snapshot.data?.searchMode,
    error: snapshot.error,
  };
}
