import React, { useState } from "react";
import { modelsFor } from "../panels/ProviderPicker.jsx";

export function ConnectionForm({ provider, onSave, onCancel }) {
  const [name, setName] = useState(provider.name || "");
  const [url, setUrl] = useState(provider.baseUrl || "");
  const [key, setKey] = useState("");
  const [clear, setClear] = useState(false);
  const [text, setText] = useState(
    provider.id ? modelsFor(provider, "text").join("\n") : "",
  );
  const [images, setImages] = useState(
    provider.id ? modelsFor(provider, "image").join("\n") : "",
  );
  const [vision, setVision] = useState(
    provider.modelDetails?.find((m) => m.capabilities.includes("text"))
      ?.acceptsImages ?? true,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="connection-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const models = new Map();
          for (const [value, capability] of [
            [text, "text"],
            [images, "image"],
          ])
            for (const id of value
              .split(/[\n,]/)
              .map((x) => x.trim())
              .filter(Boolean)) {
              const model = models.get(id) || {
                id,
                capabilities: [],
                acceptsImages: capability === "image" || vision,
              };
              model.capabilities.push(capability);
              models.set(id, model);
            }
          if (!models.size)
            throw new Error("Enter at least one text or image model ID.");
          await onSave({
            name,
            baseUrl: url,
            models: [...models.values()],
            apiKey: key
              ? { action: "replace", value: key }
              : { action: clear ? "clear" : "keep" },
          });
          setKey("");
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Connection name
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My inference endpoint"
        />
      </label>
      <label>
        Base URL
        <input
          required
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
        />
      </label>
      <label>
        API key{" "}
        <small>
          {provider.hasApiKey
            ? "Saved · leave blank to keep"
            : "Optional for local endpoints"}
        </small>
        <input
          type="password"
          autoComplete="new-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={
            provider.hasApiKey ? "•••••••• · stored on this computer" : "sk-…"
          }
        />
      </label>
      {provider.hasApiKey && (
        <label className="connection-check">
          <input
            type="checkbox"
            checked={clear}
            onChange={(e) => setClear(e.target.checked)}
          />{" "}
          Remove saved key
        </label>
      )}
      <div className="connection-models">
        <label>
          Text model IDs
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="One model ID per line"
          />
        </label>
        <label>
          Image model IDs
          <textarea
            value={images}
            onChange={(e) => setImages(e.target.value)}
            placeholder="One model ID per line"
          />
        </label>
      </div>
      <label className="connection-check">
        <input
          type="checkbox"
          checked={vision}
          onChange={(e) => setVision(e.target.checked)}
        />{" "}
        Text models can read reference images
      </label>
      <p>
        Use the API base including /v1 if required. Model IDs are defined by
        your endpoint. Changes apply to queued jobs and retries.
      </p>
      {error && (
        <p className="connection-error" role="alert">
          {error}
        </p>
      )}
      <div className="provider-setting-actions">
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save connection"}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
