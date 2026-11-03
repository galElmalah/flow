import React, { useState } from "react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";

export function OllamaSettings({ provider }) {
  const [selected, setSelected] = useState("");
  const models = provider.modelDetails || [],
    model = models.some((m) => m.id === selected)
      ? selected
      : models[0]?.id || "";
  return (
    <div className="ollama-provider-settings">
      <p>{provider.status}</p>
      {!!models.length && (
        <>
          <label className="ollama-model-choice">
            Model
            <Autocomplete
              label="Ollama model"
              value={model}
              onChange={setSelected}
              popupMinWidth={280}
              options={models.map((entry) => ({
                value: entry.id,
                label: entry.name || entry.id,
                description: entry.acceptsImages
                  ? "Text + image input"
                  : "Text",
                icon: <HarnessLogo id="ollama" size={18} />,
              }))}
            />
          </label>
          <button
            className="settings-button"
            disabled={!provider.ready || !model}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("weft:agent-select-model", {
                  detail: { providerId: "ollama", model },
                }),
              )
            }
          >
            Use in agent
          </button>
        </>
      )}
      <a href="/settings/local-models">Manage / download models ↗</a>
    </div>
  );
}
