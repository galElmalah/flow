import React, { useEffect, useState } from "react";
import { Autocomplete } from "../components/Autocomplete.jsx";

async function request(method = "GET", body, suffix = "") {
  const response = await fetch(`/api/providers/codex${suffix}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not configure Codex.");
  return data;
}

export function CodexSettings({ onReload }) {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState("harness");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    request()
      .then((value) => {
        if (!stopped) {
          setStatus(value);
          setMode(value.mode);
        }
      })
      .catch((e) => !stopped && setError(e.message));
    return () => {
      stopped = true;
    };
  }, []);
  const pending = ["starting", "pending"].includes(status?.login?.status);
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    const timer = setInterval(
      () =>
        request()
          .then((value) => {
            if (stopped) return;
            setStatus(value);
            if (value.login?.status === "completed") onReload?.();
          })
          .catch((e) => !stopped && setError(e.message)),
      1800,
    );
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pending, onReload]);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let value = await request("PUT", {
        mode,
        ...(mode === "api-key" && key && { apiKey: key }),
      });
      setKey("");
      if (mode === "oauth" && !value.signedIn)
        value = await request("POST", {}, "/login");
      setStatus(value);
      await onReload?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="provider-auth-form" onSubmit={save}>
      <label>
        Connect with
        <Autocomplete
          label="Codex authentication"
          value={mode}
          disabled={busy || pending || !status}
          onChange={setMode}
          options={[
            {
              value: "harness",
              label: "Local harness",
              description: "Use the existing Codex CLI login",
            },
            {
              value: "oauth",
              label: "ChatGPT OAuth",
              description: "Sign in separately for Flow",
            },
            {
              value: "api-key",
              label: "API key",
              description: "Use OpenAI API billing",
            },
          ]}
        />
      </label>
      <p>
        {mode === "harness"
          ? "Uses your existing Codex CLI and its current login."
          : mode === "oauth"
            ? "Separate ChatGPT sign-in for Flow. Your CLI login stays as it is."
            : "Runs Codex with your OpenAI API key. API billing applies."}
      </p>
      {mode === "api-key" && (
        <label>
          API key
          <input
            aria-label="Codex API key"
            type="password"
            autoComplete="new-password"
            placeholder={
              status?.hasApiKey ? "Saved · leave blank to keep" : "sk-…"
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
      )}
      {pending && (
        <div className="provider-signin" role="status">
          {status.login.code ? (
            <>
              <code>{status.login.code}</code>
              <a href={status.login.url} target="_blank" rel="noreferrer">
                Open ChatGPT sign-in ↗
              </a>
            </>
          ) : (
            <span>{status.login.message}</span>
          )}
          <button
            type="button"
            onClick={async () => {
              try {
                setStatus(await request("POST", {}, "/login/cancel"));
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {status?.login && !pending && status.login.status !== "completed" && (
        <p role="status">{status.login.message}</p>
      )}
      {status && !pending && (
        <p role="status">
          {status.mode === mode ? status.auth : "Not applied yet"}
        </p>
      )}
      {error && (
        <p role="alert" className="connection-error">
          {error}
        </p>
      )}
      {!pending && (
        <button
          className="settings-button"
          disabled={
            !status || busy || (mode === "api-key" && !key && !status.hasApiKey)
          }
          type="submit"
        >
          {busy
            ? "Connecting…"
            : mode === "oauth" && !(status?.mode === mode && status?.signedIn)
              ? "Sign in with ChatGPT"
              : "Use this connection"}
        </button>
      )}
    </form>
  );
}
