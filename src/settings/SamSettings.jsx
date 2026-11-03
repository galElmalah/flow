import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SamSetup } from "../components/SamSetup.jsx";
import { jsonRequest } from "../studio/ui.mjs";

export function SamSettings() {
  const [model, setModel] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      setModel(await jsonRequest("/api/image-editors/status"));
      setError("");
    } catch (error) {
      setError(error.message);
    }
  };
  useEffect(() => {
    let active = true,
      timer;
    const poll = async () => {
      try {
        const status = await jsonRequest("/api/image-editors/status");
        if (active) {
          setModel(status);
          setError("");
        }
      } catch (error) {
        if (active) setError(error.message);
      }
      if (active) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  return (
    <>
      <header className="settings-section-heading">
        <div>
          <h2>Image tools</h2>
        </div>
        <button
          className="settings-button"
          onClick={refresh}
          aria-label="Refresh SAM status"
        >
          <RefreshCw size={15} />
        </button>
      </header>
      {error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
      <SamSetup
        model={model}
        busy={busy}
        details
        onSetup={async () => {
          setBusy(true);
          setError("");
          try {
            setModel(
              await jsonRequest("/api/image-editors/setup", {
                method: "POST",
                body: "{}",
              }),
            );
          } catch (error) {
            setError(error.message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
