import { requestClaudeControl } from "./control.mjs";

const efforts = ["low", "medium", "high", "xhigh", "max"];
export function claudeModelsFromInitialization(report) {
  const models = new Map();
  for (const model of Array.isArray(report?.models)
    ? report.models.slice(0, 100)
    : []) {
    if (
      !model ||
      typeof model.value !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,119}$/.test(model.value)
    )
      continue;
    models.set(model.value, {
      id: model.value,
      name:
        typeof model.displayName === "string"
          ? model.displayName.slice(0, 160)
          : model.value,
      ...(typeof model.description === "string" && {
        description: model.description.slice(0, 600),
      }),
      ...(typeof model.resolvedModel === "string" && {
        resolvedModel: model.resolvedModel.slice(0, 120),
      }),
      capabilities: ["text"],
      acceptsImages: true,
      reasoning: {
        levels:
          model.supportsEffort === true &&
          Array.isArray(model.supportedEffortLevels)
            ? [
                ...new Set(
                  model.supportedEffortLevels.filter((level) =>
                    efforts.includes(level),
                  ),
                ),
              ]
            : [],
      },
    });
  }
  return [...models.values()];
}

const cache = new Map();
export async function claudeTextModels({
  executable = process.env.WEFT_CLAUDE_BIN || "claude",
  timeoutMs = 5000,
  now = Date.now(),
  read = requestClaudeControl,
} = {}) {
  const cached = cache.get(executable);
  if (read === requestClaudeControl && cached && now - cached.at < 30000)
    return cached.promise;
  const promise = read({ executable, timeoutMs, prefix: "flow-models" })
    .then(claudeModelsFromInitialization)
    .catch(() => []); // Unknown/older CLIs retain only their configured default.
  if (read === requestClaudeControl)
    cache.set(executable, { at: now, promise });
  return promise;
}
