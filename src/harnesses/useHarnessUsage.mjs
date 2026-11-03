import { useCallback, useRef, useState } from "react";

export function useHarnessUsage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(null);
  const load = useCallback((refresh = false) => {
    if (pending.current)
      return refresh ? pending.current.then(() => load(true)) : pending.current;
    setLoading(true);
    setError("");
    pending.current = (async () => {
      try {
        const response = await fetch(
          `/api/providers/usage${refresh ? "?refresh=1" : ""}`,
          { signal: AbortSignal.timeout(20000) },
        );
        if (!response.ok)
          throw new Error("Usage could not be loaded. Try again.");
        setReport(await response.json());
      } catch {
        setError("Usage could not be loaded. Try again.");
        setReport((previous) =>
          previous
            ? {
                ...previous,
                accounts: previous.accounts.map((account) => ({
                  ...account,
                  stale: true,
                })),
              }
            : null,
        );
      } finally {
        pending.current = null;
        setLoading(false);
      }
    })();
    return pending.current;
  }, []);
  return { report, loading, error, load };
}
