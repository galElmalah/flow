export const engineValue = (provider, model) =>
  JSON.stringify([provider, model]);
export function harnessModelOptions(providers, providerId, modelId) {
  return providers
    .filter((p) => p.capabilities?.includes("text"))
    .map((p) => {
      const details = p.modelDetails?.filter((m) =>
        m.capabilities.includes("text"),
      );
      const models = details?.length
        ? [...details]
        : (p.models?.length ? p.models : ["default"]).map((id) => ({ id }));
      if (
        p.id === providerId &&
        modelId &&
        !models.some((m) => m.id === modelId)
      )
        models.push({ id: modelId, description: "Saved model selection" });
      return {
        value: p.id,
        label: p.name,
        description: p.ready
          ? p.managed
            ? "Your compatible endpoint"
            : p.authMethod === "api-key"
              ? "API billing"
              : p.local
                ? "Local model"
                : p.kind === "compatible" || p.kind === "image-api"
                  ? "API endpoint"
                  : "Local harness"
          : p.status,
        disabled: !p.ready,
        providerId: p.id,
        children: models.map((m) => ({
          value: engineValue(p.id, m.id),
          label:
            m.id === "default"
              ? "Configured default"
              : m.name || m.label || m.id,
          keywords: m.id,
          selectedLabel: `${p.name} · ${m.id === "default" ? "Default" : m.name || m.label || m.id}`,
          description:
            m.description ||
            (m.id === "default" ? "Uses your harness model settings" : m.id),
          providerId: p.id,
          modelId: m.id,
          disabled: !p.ready,
        })),
      };
    });
}
