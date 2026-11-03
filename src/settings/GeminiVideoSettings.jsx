import React, { useEffect, useState } from "react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import "../media/media.css";

export function GeminiVideoSettings({ onReload }) {
  const [status, setStatus] = useState(null),
    [mode, setMode] = useState("api-key"),
    [project, setProject] = useState(""),
    [key, setKey] = useState(""),
    [clear, setClear] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const request = async (options) => {
    const response = await fetch("/api/providers/gemini-video", options);
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not read Gemini video setup.");
    return result;
  };
  useEffect(() => {
    let cancelled = false;
    request()
      .then((result) => {
        if (cancelled) return;
        setStatus(result);
        setMode(
          ["api-key", "oauth-adc", "oauth-token"].includes(result.authMode)
            ? result.authMode
            : "api-key",
        );
        setProject(result.quotaProject || "");
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <section
      className="settings-card gemini-video-settings"
      aria-label="Gemini video API setup"
    >
      <p>
        Video via the Gemini API. Separate from your CLI login and Pro / Flow
        credits.
      </p>
      <p role="status">
        {status?.reason || status?.status || "Reading video connection…"}
      </p>
      <form
        className="connection-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          try {
            const result = await request({
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                authMode: mode,
                quotaProject: project.trim() || undefined,
                apiKey: key || (clear ? null : undefined),
              }),
            });
            setStatus(result);
            setKey("");
            setClear(false);
            setMessage("Connection saved.");
            await onReload();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Authentication
          <Autocomplete
            label="Gemini video authentication"
            value={mode}
            onChange={setMode}
            options={[
              { value: "api-key", label: "Gemini API key" },
              {
                value: "oauth-adc",
                label: "Google OAuth · application default credentials",
              },
              {
                value: "oauth-token",
                label: "OAuth token · server environment (advanced)",
              },
            ]}
          />
        </label>
        {mode === "api-key" ? (
          <>
            <label>
              API key{" "}
              <small>
                {status?.hasApiKey
                  ? "Saved · leave blank to keep"
                  : "Stored privately on this computer"}
              </small>
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={status?.hasApiKey ? "Saved key" : "Gemini API key"}
              />
            </label>
            {status?.hasApiKey && (
              <label className="connection-check">
                <input
                  type="checkbox"
                  checked={clear}
                  onChange={(e) => setClear(e.target.checked)}
                />
                Remove saved API key
              </label>
            )}
          </>
        ) : mode === "oauth-adc" ? (
          <>
            <p>
              Use your own Google Cloud project with the required API enabled
              and billing configured. Sign in locally with Google Cloud CLI;
              Flow refreshes these application credentials automatically. Create
              a desktop OAuth client for your own project and keep its
              downloaded client_secret.json on this computer. Gemini coding CLI
              sign-in is a separate login.
            </p>
            <p>
              <a
                href="https://ai.google.dev/gemini-api/docs/oauth"
                target="_blank"
                rel="noreferrer"
              >
                Google’s Gemini API OAuth setup guide ↗
              </a>
            </p>
            <pre>
              gcloud auth application-default login
              --client-id-file=client_secret.json
              --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/generative-language.retriever"
            </pre>
            <label>
              Quota project ID
              <input
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="my-google-cloud-project"
                required={mode === "oauth-adc"}
              />
            </label>
            <p>After signing in, set the same quota project:</p>
            <pre>
              gcloud auth application-default set-quota-project{" "}
              {project.trim() || "YOUR_PROJECT_ID"}
            </pre>
          </>
        ) : (
          <>
            <p>
              Set GEMINI_ACCESS_TOKEN in the Flow server environment. This
              advanced mode uses a short-lived token; it does not refresh it
              automatically. Application default credentials are recommended for
              persistent use.
            </p>
            <label>
              Quota project ID
              <input
                value={project}
                onChange={(event) => setProject(event.target.value)}
                placeholder="my-google-cloud-project"
                required
              />
            </label>
          </>
        )}
        {error && (
          <p className="connection-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="connection-message" role="status">
            {message}
          </p>
        )}
        <div className="provider-setting-actions">
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save connection"}
          </button>
        </div>
      </form>
    </section>
  );
}
