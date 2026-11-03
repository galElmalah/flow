import React, { useEffect, useState } from "react";
import { Download, Check, Image } from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import {
  localModelPresets,
  createPresetProfile,
  presetHardwareNote,
} from "../../shared/local-model-presets.mjs";

export function LocalModelPreset({ state, busy, act, progress, validation }) {
  const [id, setId] = useState("moss-image-sft");
  const preset = localModelPresets.find((entry) => entry.id === id);
  const runtime = state?.runtimes?.find((entry) => entry.id === "comfyui");
  const installedPreset = localModelPresets.find((preset) =>
    preset.weights.every((weight) =>
      runtime?.models?.some(
        (entry) =>
          entry.folder === weight.folder && entry.filename === weight.filename,
      ),
    ),
  )?.id;
  useEffect(() => {
    const presetId = runtime?.task?.presetId || installedPreset;
    if (localModelPresets.some((entry) => entry.id === presetId))
      setId(presetId);
  }, [runtime?.task?.presetId, installedPreset]);
  const profile = state?.profiles?.find((entry) => entry.id === id);
  const proof = runtime?.presetGenerations?.[id];
  const installed = preset.weights.filter((weight) =>
    runtime?.models?.some(
      (entry) =>
        entry.folder === weight.folder && entry.filename === weight.filename,
    ),
  ).length;
  const active = runtime?.task?.status === "running";
  const external = runtime?.running && !runtime.managed;
  return (
    <section
      className="settings-card local-model-preset"
      aria-label="MOSS-Image local model"
    >
      <div className="settings-card-heading">
        <div>
          <h3>
            <Image size={19} />
            MOSS-Image
          </h3>
          <p>Local image generation · OpenMOSS · Apache-2.0</p>
        </div>
        <span className="settings-status">
          {external ? "External runtime" : `${installed}/3 weights`} ·{" "}
          {profile ? "Profile added" : "Setup required"}
        </span>
      </div>
      <div className="local-preset-controls">
        <Autocomplete
          label="MOSS-Image precision"
          value={id}
          options={localModelPresets.map((entry) => ({
            value: entry.id,
            label: entry.name,
            description: `${(entry.weights.reduce((sum, file) => sum + file.sizeBytes, 0) / 1e9).toFixed(1)} GB download`,
          }))}
          onChange={setId}
          disabled={busy || active}
        />
        <button
          className="settings-button settings-primary"
          disabled={busy || active || !state || external}
          onClick={() => act(`/comfyui/presets/${id}/install`, {})}
        >
          <Download size={14} />
          {installed === 3 && profile
            ? "Recheck files"
            : `Download & setup · ${(preset.weights.reduce((sum, file) => sum + file.sizeBytes, 0) / 1e9).toFixed(1)} GB`}
        </button>
        {active && (
          <button
            className="settings-button"
            disabled={busy}
            onClick={() => act("/comfyui/cancel", {})}
          >
            Cancel setup
          </button>
        )}
      </div>
      {proof ? (
        <p className="local-preset-proof">
          <Check size={14} />
          Verified locally · {proof.width}×{proof.height} ·{" "}
          <a href={`/run/${proof.runId}`}>View image ↗</a>
        </p>
      ) : (
        <p>
          {presetHardwareNote(id, state?.hardware)}{" "}
          {state?.hardware?.platform === "darwin" &&
            `This Mac has ${Math.round(state.hardware.memoryBytes / 1024 ** 3)} GB of shared memory.`}
        </p>
      )}
      <p>
        Text-to-image only. Use a prompt-writing node to describe seed
        references; this preset cannot directly condition on images.
      </p>
      {external && (
        <p>
          Downloads use Flow’s managed runtime. For your external ComfyUI,
          install these files there and add the profile below.
        </p>
      )}
      {progress}
      {validation?.[id] && (
        <div className="local-profile-validation" role="status">
          {validation[id].valid ? (
            "Dependencies available · inference untested"
          ) : (
            <ul>
              {validation[id].errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <details className="local-model-details">
        <summary>Model files & existing installations</summary>
        <ul className="local-installed-models">
          {preset.weights.map((file) => (
            <li key={file.filename}>
              <span>
                <a href={file.url}>
                  {file.folder}/{file.filename}
                </a>
              </span>
              <small>{(file.sizeBytes / 1e9).toFixed(1)} GB</small>
            </li>
          ))}
        </ul>
        <p>
          Setup verifies each published SHA-256, reuses matching files, and adds
          the model under ComfyUI Image. No generation starts during setup.
        </p>
        <div className="local-runtime-actions">
          {!profile && (
            <button
              className="settings-button"
              disabled={busy || active || !state}
              onClick={() => act("/comfyui/profiles", createPresetProfile(id))}
            >
              <Check size={14} />
              Use existing weights
            </button>
          )}
          {profile && (
            <button
              className="settings-button"
              disabled={busy || active || !runtime?.running}
              onClick={() => act(`/comfyui/profiles/${id}/validate`, {})}
            >
              Validate model
            </button>
          )}
          <a href="https://github.com/OpenMOSS/MOSS-Image/blob/main/comfyui/README.md">
            Official guide ↗
          </a>
        </div>
      </details>
    </section>
  );
}
