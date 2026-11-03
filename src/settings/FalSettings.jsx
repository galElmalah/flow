import React, { useEffect, useState } from "react";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";

export function FalSettings({ onReload }) {
  const [status, setStatus] = useState(null),
    [key, setKey] = useState(""),
    [clear, setClear] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const request = async (options) => {
    const response = await fetch("/api/providers/fal", options);
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not read fal connection.");
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
      className="settings-card fal-settings"
      aria-label="fal image and video API setup"
    >
      <p>Seedance video, Seedream and FLUX images. Pay per generation.</p>
      <div className="provider-inline-actions" aria-label="fal model families">
        <span>
          <HarnessLogo
            id="fal-video"
            model
            modelId="bytedance/seedance-2.5/text-to-video"
            size={16}
          />{" "}
          Seedance 2.5 / 2.0 · Seedream 5
        </span>
        <span>
          <HarnessLogo
            id="fal-image"
            model
            modelId="fal-ai/flux/schnell"
            size={16}
          />{" "}
          FLUX.1
        </span>
      </div>
      <p role="status">
        {status?.reason ||
          (status?.configured
            ? "API key configured · account access is checked when generating."
            : "Reading fal connection…")}
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
          fal API key{" "}
          <small>
            {status?.hasApiKey
              ? "Saved · leave blank to keep"
              : "Stored privately on this computer"}
          </small>
          <input
            type="password"
            autoComplete="new-password"
            aria-label="fal API key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={
              status?.hasApiKey ? "Saved key · write-only" : "fal API key"
            }
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
          <a
            href="https://fal.ai/dashboard/keys"
            target="_blank"
            rel="noreferrer"
          >
            Get a fal API key ↗
          </a>
        </div>
      </form>
    </section>
  );
}
