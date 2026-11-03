import React, { useEffect, useState } from "react";

export function GrokSettings({ onReload }) {
  const [status, setStatus] = useState(null),
    [key, setKey] = useState(""),
    [clear, setClear] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const request = async (options) => {
    const response = await fetch("/api/providers/grok", options);
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not read xAI connection.");
    return result;
  };
  useEffect(() => {
    let cancelled = false;
    request()
      .then((value) => !cancelled && setStatus(value))
      .catch((error) => !cancelled && setError(error.message));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <section
      className="settings-card grok-settings"
      aria-label="Grok image and video API setup"
    >
      <p>Image and video via the xAI API. API billing applies.</p>
      <p role="status">
        {status?.reason ||
          (status?.configured
            ? "API key configured · account access is checked when generating."
            : "Reading xAI connection…")}
      </p>
      <form
        className="connection-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          try {
            setStatus(
              await request({
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  apiKey: key || (clear ? null : undefined),
                }),
              }),
            );
            setKey("");
            setClear(false);
            setMessage("Connection saved.");
            await onReload();
          } catch (error) {
            setError(error.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          xAI API key{" "}
          <small>
            {status?.hasApiKey
              ? "Saved · leave blank to keep"
              : "Stored privately on this computer"}
          </small>
          <input
            type="password"
            autoComplete="new-password"
            aria-label="xAI API key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={status?.hasApiKey ? "Saved key · write-only" : "xai-…"}
          />
        </label>
        {status?.hasApiKey && (
          <label className="connection-check">
            <input
              type="checkbox"
              checked={clear}
              onChange={(event) => setClear(event.target.checked)}
            />
            Remove saved key
          </label>
        )}
        {error && (
          <p role="alert" className="connection-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="connection-message">
            {message}
          </p>
        )}
        <div className="provider-setting-actions">
          <button
            className="primary-button"
            disabled={busy || (!key && !clear)}
            type="submit"
          >
            {busy ? "Saving…" : "Save key"}
          </button>
          <a href="https://console.x.ai/" target="_blank" rel="noreferrer">
            Open xAI console ↗
          </a>
        </div>
      </form>
    </section>
  );
}
