import React from "react";
import { Sparkles, LoaderCircle, X } from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import {
  harnessModelOptions,
  engineValue,
} from "../agent/harness-model-options.mjs";
import { needsRegionName } from "../../shared/image-editor.mjs";

export function RegionNaming({
  editor,
  providers,
  options,
  onOptions,
  auto,
  onAuto,
  onName,
  onCancel,
  disabled,
}) {
  const active = ["queued", "running"].includes(editor.naming?.status);
  const remaining = editor.regions.filter(needsRegionName).length;
  const name =
    providers.find((p) => p.id === options.providerId)?.name ||
    options.providerId;
  const engines = harnessModelOptions(
    providers
      .map((p) => ({
        ...p,
        modelDetails: p.modelDetails?.filter((m) => m.acceptsImages !== false),
      }))
      .filter((p) => p.modelDetails?.length),
    options.providerId,
    options.model || "default",
  ).map((p) => ({
    ...p,
    icon: <HarnessLogo id={p.providerId} size={16} />,
    children: p.children.map((m) => ({
      ...m,
      icon: (
        <HarnessLogo id={p.providerId} model modelId={m.modelId} size={16} />
      ),
    })),
  }));
  return (
    <section
      className="editor-region-naming"
      aria-label="Automatic region names"
    >
      <div>
        <Sparkles size={14} />
        <strong>Region names</strong>
        {active ? (
          <button onClick={onCancel} aria-label="Stop region naming">
            <X size={13} /> Stop
          </button>
        ) : (
          <button disabled={disabled || !remaining} onClick={onName}>
            {editor.naming?.status === "failed"
              ? "Retry naming"
              : remaining
                ? `Name ${remaining} regions`
                : editor.regions.length
                  ? "All named"
                  : "Detect regions first"}
          </button>
        )}
      </div>
      {active && (
        <div className="editor-naming-progress" role="status">
          <LoaderCircle size={12} className="spin" />
          <span>
            Naming with {name} · {editor.naming.completed}/{editor.naming.total}
          </span>
          <progress
            aria-label="Region naming progress"
            value={editor.naming.completed}
            max={editor.naming.total}
          />
        </div>
      )}
      {editor.naming?.error && !active && (
        <p role={editor.naming.status === "failed" ? "alert" : undefined}>
          {editor.naming.error}
        </p>
      )}
      <details>
        <summary>{active ? "Naming settings" : `Names via ${name}`}</summary>
        <Autocomplete
          label="Region naming harness and model"
          value={engineValue(options.providerId, options.model || "default")}
          fallbackLabel={`${name} · Default`}
          options={engines}
          popupMinWidth={500}
          onChange={(value) => {
            const [providerId, model] = JSON.parse(value);
            onOptions({ providerId, model });
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={auto}
            onChange={(event) => onAuto(event.target.checked)}
          />{" "}
          Auto-name new regions
        </label>
        <p>
          SAM finds masks locally. {name} reads the image and mask crops to name
          objects. Uses text/vision inference; no image generation. Your manual
          names are kept.
        </p>
      </details>
    </section>
  );
}
