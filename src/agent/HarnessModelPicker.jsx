import React, { useEffect, useState } from "react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import { engineValue, harnessModelOptions } from "./harness-model-options.mjs";
import { ThinkingDial } from "./ThinkingDial.jsx";
import { reasoningLevels, selectedReasoning } from "../../shared/reasoning.mjs";

export function HarnessModelPicker({
  providers,
  provider,
  model,
  onChange,
  reasoningEffort = "inherit",
  onReasoningChange,
}) {
  const [draftEffort, setDraftEffort] = useState(reasoningEffort);
  useEffect(
    () => setDraftEffort(reasoningEffort),
    [provider, model, reasoningEffort],
  );
  const options = harnessModelOptions(providers, provider, model).map(
    (group) => ({
      ...group,
      icon: <HarnessLogo id={group.providerId} size={20} />,
      children: group.children.map((child) => ({
        ...child,
        icon: (
          <HarnessLogo
            id={child.providerId}
            model
            modelId={child.modelId}
            size={18}
          />
        ),
      })),
    }),
  );
  return (
    <label className="agent-engine-field agent-engine-combined">
      <Autocomplete
        label="Agent provider and model"
        fallbackLabel={`${providers.find((p) => p.id === provider)?.name || provider} · ${model === "default" ? "Default" : model}`}
        popupMinWidth={330}
        popupClassName="agent-model-list"
        submenuMode="drilldown"
        groupLabel="Providers"
        searchPlaceholder="Search providers or models…"
        value={engineValue(provider, model)}
        options={options}
        renderHeader={({ parent }) => {
          const activeProvider = providers.find(
            (p) => p.id === (parent?.providerId || provider),
          );
          const activeModel =
            parent?.providerId && parent.providerId !== provider
              ? parent.children[0]?.modelId
              : model;
          return (
            <div className="agent-model-thinking">
              <ThinkingDial
                value={selectedReasoning(
                  activeProvider,
                  activeModel,
                  draftEffort,
                )}
                levels={reasoningLevels(activeProvider, activeModel)}
                onChange={(value) => {
                  setDraftEffort(value);
                  if (activeProvider?.id === provider)
                    onReasoningChange?.(value);
                }}
              />
            </div>
          );
        }}
        onChange={(value) => {
          const [providerId, modelId] = JSON.parse(value);
          const selected = providers.find((p) => p.id === providerId);
          onChange(
            providerId,
            modelId,
            selectedReasoning(selected, modelId, draftEffort),
          );
        }}
      />
    </label>
  );
}
