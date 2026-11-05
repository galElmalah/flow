import React, { useContext } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import { StudioContext } from "../studio/context.jsx";
import { modelsFor } from "../panels/ProviderPicker.jsx";
import "./generation-modes.css";
import { falDefaults, falModel } from "../../shared/fal.mjs";
import { ImageOutputSettings } from "./ImageOutputSettings.jsx";

const copies = (value) => Math.max(1, Math.min(500, Number(value) || 1));
const choiceKey = (providerId, model) =>
  JSON.stringify([providerId, model || ""]);
export function GenerationModes({
  id,
  data,
  kind = "image",
  providers,
  readOnly,
  editNode,
  plan,
}) {
  const context = useContext(StudioContext);
  providers ||= context?.providers || [];
  editNode ||= context?.editNode;
  readOnly ??= context?.readOnly;
  plan ||= context?.plan;
  const defaultProvider = kind === "video" ? "gemini-video" : "codex";
  const explicit = Boolean(data.modes?.length);
  const modes = explicit
    ? data.modes
    : [
        {
          id: "default",
          label:
            providers.find((p) => p.id === (data.providerId || defaultProvider))
              ?.name ||
            data.providerId ||
            defaultProvider,
          providerId: data.providerId || defaultProvider,
          model: data.model,
          count: data.count || 1,
        },
      ];
  const update = (modeId, patch) => {
    if (explicit)
      editNode(id, {
        modes: modes.map((mode) =>
          mode.id === modeId ? { ...mode, ...patch } : mode,
        ),
      });
    else editNode(id, patch);
  };
  const available = providers.filter(
    (provider) => modelsFor(provider, kind).length,
  );
  const options = available.flatMap((provider) =>
    modelsFor(provider, kind).map((model) => ({
      value: choiceKey(provider.id, model),
      label: `${provider.name} · ${provider.modelDetails?.find((m) => m.id === model)?.label || model}`,
      keywords: `${provider.id} ${model}`,
      icon: <HarnessLogo id={provider.id} model modelId={model} size={18} />,
      description: provider.ready ? undefined : "Setup required",
    })),
  );
  const add = () => {
    const provider =
      available.find(
        (p) => p.id === (kind === "video" ? "grok-video" : "grok-image"),
      ) ||
      available.find((p) => !modes.some((m) => m.providerId === p.id)) ||
      available[0];
    if (!provider) return;
    const defaults =
      provider.kind === "fal"
        ? falDefaults(falModel(modelsFor(provider, kind)[0]))
        : provider.id.startsWith("grok-")
          ? kind === "image"
            ? { quality: "medium", image: { resolution: "1k" } }
            : { video: { resolution: "720p", durationSeconds: 8 } }
          : {};
    editNode(id, {
      modes: [
        ...modes,
        {
          id: globalThis.crypto.randomUUID(),
          label: provider.name,
          providerId: provider.id,
          model: modelsFor(provider, kind)[0],
          count: data.count || 1,
          ...defaults,
        },
      ],
    });
  };
  const total = plan?.nodes?.[id];
  return (
    <div className="generation-modes nodrag nowheel">
      <div className="generation-modes-heading">
        <span>Generation modes</span>
        <span>{explicit ? `${modes.length} modes` : "Shared inputs"}</span>
      </div>
      {modes.map((mode, index) => {
        const provider = providers.find((p) => p.id === mode.providerId);
        const model = mode.model || modelsFor(provider, kind)[0] || "";
        const effective = { ...data, ...mode };
        const detail = provider?.modelDetails?.find((m) => m.id === model);
        const grok = mode.providerId.startsWith("grok-");
        const set = (patch) => update(mode.id, patch);
        return (
          <div className="generation-mode" key={mode.id}>
            <div className="generation-mode-main">
              <Autocomplete
                label={`${kind} generation mode ${index + 1}`}
                value={choiceKey(mode.providerId, model)}
                fallbackLabel={`${provider?.name || mode.providerId} · ${model || "Default"}`}
                options={options}
                onChange={(value) => {
                  const [providerId, selectedModel] = JSON.parse(value);
                  const selected = providers.find((p) => p.id === providerId);
                  const defaults =
                    selected?.kind === "fal"
                      ? falDefaults(falModel(selectedModel))
                      : providerId.startsWith("grok-")
                        ? kind === "image"
                          ? { quality: "medium", image: { resolution: "1k" } }
                          : {
                              video: { resolution: "720p", durationSeconds: 8 },
                            }
                        : kind === "video"
                          ? { video: { resolution: "720p" } }
                          : { image: {} };
                  const allowedRatios =
                    selected?.modelDetails?.find((m) => m.id === selectedModel)
                      ?.ratios ||
                    selected?.ratios ||
                    [];
                  const ratio =
                    mode.ratio ||
                    data.ratio ||
                    (kind === "video" ? "16:9" : "1:1");
                  set({
                    ...(allowedRatios.length && !allowedRatios.includes(ratio)
                      ? {
                          ratio:
                            allowedRatios.includes("16:9") && kind === "video"
                              ? "16:9"
                              : allowedRatios[0],
                        }
                      : {}),
                    providerId,
                    model: selectedModel,
                    ...(explicit &&
                    (mode.label === provider?.name || mode.label === "Default")
                      ? { label: selected?.name || providerId }
                      : {}),
                    ...defaults,
                  });
                }}
                disabled={readOnly}
                popupMinWidth={310}
                searchPlaceholder="Search harnesses or models…"
              />
              <label className="mode-copies">
                <span>Copies</span>
                <input
                  aria-label={`Copies for mode ${index + 1}`}
                  type="number"
                  min="1"
                  max="500"
                  value={mode.count ?? data.count ?? 1}
                  readOnly={readOnly}
                  onChange={(event) =>
                    set({ count: copies(event.target.value) })
                  }
                />
              </label>
              {explicit && (
                <button
                  className="mode-remove"
                  aria-label={`Remove mode ${index + 1}`}
                  title="Remove mode"
                  disabled={readOnly || modes.length === 1}
                  onClick={() =>
                    editNode(id, {
                      modes: modes.filter((m) => m.id !== mode.id),
                    })
                  }
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {!provider?.ready && (
              <button
                className="mode-setup"
                disabled={readOnly}
                onClick={() =>
                  context?.openSettings?.(
                    ["ollama", "comfyui"].includes(provider?.kind) ||
                      /^(ollama|comfyui)/.test(mode.providerId)
                      ? "local-models"
                      : "providers",
                  )
                }
              >
                Setup required · configure {provider?.name || mode.providerId} ↗
              </button>
            )}
            <details className="mode-overrides">
              <summary>Settings{explicit ? ` · ${mode.label}` : ""}</summary>
              {explicit && (
                <label>
                  Mode name
                  <input
                    aria-label={`Name for mode ${index + 1}`}
                    value={mode.label}
                    readOnly={readOnly}
                    onChange={(event) =>
                      set({ label: event.target.value.slice(0, 120) })
                    }
                  />
                </label>
              )}
              <label>
                Aspect ratio
                <Autocomplete
                  label={`Aspect ratio for mode ${index + 1}`}
                  value={effective.ratio || (kind === "video" ? "16:9" : "1:1")}
                  options={(
                    detail?.ratios ||
                    provider?.ratios || [
                      "1:1",
                      "2:1",
                      "3:2",
                      "2:3",
                      "16:9",
                      "9:16",
                    ]
                  ).map((v) => ({ value: v, label: v }))}
                  disabled={readOnly}
                  onChange={(ratio) => set({ ratio })}
                />
              </label>
              {kind === "image" ? (
                <>
                  <ImageOutputSettings
                    detail={detail}
                    image={effective.image}
                    index={index}
                    readOnly={readOnly}
                    onChange={(image) => set({ image })}
                  />
                  <label>
                    Quality
                    <Autocomplete
                      label={`Quality for mode ${index + 1}`}
                      value={effective.quality || (grok ? "medium" : "high")}
                      options={(
                        detail?.qualities ||
                        (grok
                          ? ["auto", "medium", "low"]
                          : ["auto", "high", "medium", "low"])
                      ).map((v) => ({ value: v, label: v }))}
                      disabled={readOnly}
                      onChange={(quality) => set({ quality })}
                    />
                  </label>
                  {detail?.imageResolutions && (
                    <label>
                      Image resolution
                      <Autocomplete
                        label={`Image resolution for mode ${index + 1}`}
                        value={effective.image?.resolution || "1k"}
                        options={(
                          detail?.imageResolutions || ["1k", "1.5k", "2k"]
                        ).map((v) => ({ value: v, label: v }))}
                        disabled={readOnly}
                        onChange={(resolution) =>
                          set({ image: { ...effective.image, resolution } })
                        }
                      />
                    </label>
                  )}
                </>
              ) : (
                <>
                  <label>
                    Resolution
                    <Autocomplete
                      label={`Video resolution for mode ${index + 1}`}
                      value={effective.video?.resolution || "720p"}
                      options={(
                        detail?.videoResolutions ||
                        (grok
                          ? ["480p", "720p", "1080p"]
                          : ["360p", "720p", "1080p", "4k"])
                      ).map((v) => ({ value: v, label: v }))}
                      disabled={readOnly}
                      onChange={(resolution) =>
                        set({ video: { ...effective.video, resolution } })
                      }
                    />
                  </label>
                  {(grok || detail?.durationSeconds) && (
                    <>
                      <label>
                        Duration · seconds
                        <input
                          aria-label={`Duration for mode ${index + 1}`}
                          type="number"
                          min={detail?.durationSeconds?.min || 1}
                          max={detail?.durationSeconds?.max || 15}
                          value={effective.video?.durationSeconds || 8}
                          readOnly={readOnly}
                          onChange={(event) =>
                            set({
                              video: {
                                ...effective.video,
                                durationSeconds: Math.max(
                                  detail?.durationSeconds?.min || 1,
                                  Math.min(
                                    detail?.durationSeconds?.max || 15,
                                    Number(event.target.value) || 8,
                                  ),
                                ),
                              },
                            })
                          }
                        />
                      </label>
                      {grok && (
                        <label>
                          Reference behavior
                          <Autocomplete
                            label={`Reference behavior for mode ${index + 1}`}
                            value={effective.video?.mode || "auto"}
                            options={[
                              { value: "auto", label: "Auto · from inputs" },
                              { value: "text", label: "Text to video" },
                              { value: "image", label: "Image · first frame" },
                              { value: "reference", label: "Reference images" },
                            ].filter(
                              (option) =>
                                option.value === "auto" ||
                                !detail?.videoModes ||
                                detail.videoModes.includes(option.value),
                            )}
                            disabled={readOnly}
                            onChange={(value) => {
                              const video = { ...effective.video };
                              if (value === "auto") delete video.mode;
                              else video.mode = value;
                              set({ video });
                            }}
                          />
                        </label>
                      )}
                    </>
                  )}
                </>
              )}
              <label>
                Variation label
                <input
                  aria-label={`Variation label for mode ${index + 1}`}
                  type="number"
                  min="0"
                  max="2147483647"
                  value={effective.seed ?? 42}
                  readOnly={readOnly}
                  onChange={(event) =>
                    set({
                      seed: Math.max(
                        0,
                        Math.min(2147483647, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
              </label>
              <small>
                {provider?.kind === "fal"
                  ? detail?.seeded
                    ? "This model receives the seed. The provider-reported seed is saved with the result."
                    : "This endpoint does not accept a seed. The label is local; provider-reported seeds are recorded with results."
                  : grok
                    ? "xAI does not accept deterministic seeds. This label is recorded locally."
                    : "Seed behavior depends on the provider. Inputs and settings are saved with every output."}
              </small>
            </details>
          </div>
        );
      })}
      <div className="generation-modes-footer">
        <button
          disabled={readOnly || modes.length >= 12 || !available.length}
          onClick={add}
        >
          <Plus size={13} />
          Add mode
        </button>
        <span>
          {total !== undefined
            ? `${total} ${kind === "video" ? "videos" : "images"} planned`
            : `${modes.reduce((n, m) => n + (m.count || 1), 0)} copies / input`}
        </span>
      </div>
      {explicit && (
        <p className="generation-modes-note">
          Every mode uses the same prompt, records and references.
        </p>
      )}
    </div>
  );
}
