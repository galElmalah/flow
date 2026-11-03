import { z } from "zod";

export const reasoningEffortSchema = z.enum([
  "inherit",
  "off",
  "on",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const levels = [
  "off",
  "on",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export const reasoningLabel = (value) =>
  ({
    inherit: "Auto",
    off: "Off",
    on: "On",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Max",
  })[value] || value;
export function reasoningLevels(provider, model) {
  const details = provider?.modelDetails?.find((entry) => entry.id === model);
  if (details?.reasoning?.levels)
    return details.reasoning.levels.filter((value) => levels.includes(value));
  if (provider?.id === "codex-text") return ["low", "medium", "high", "xhigh"];
  if (provider?.id === "claude-code") return ["low", "medium", "high"];
  if (provider?.id === "pi")
    return ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  return [];
}
export function selectedReasoning(provider, model, value) {
  return value === "inherit" || reasoningLevels(provider, model).includes(value)
    ? value
    : "inherit";
}
export function ollamaReasoning(info) {
  const values = info.thinking?.values;
  const supported = Array.isArray(values)
    ? values
    : info.capabilities?.includes("thinking")
      ? [false, true]
      : [];
  const choices = supported
    .map((value) => (value === true ? "on" : value === false ? "off" : value))
    .filter((value) => levels.includes(value));
  return {
    levels: [...new Set(choices)],
    ...(info.thinking?.default !== undefined && {
      default: info.thinking.default,
    }),
  };
}
export function ollamaThink(info, effort) {
  if (effort === "inherit") return undefined;
  if (effort === undefined) return false;
  const checked = reasoningEffortSchema.parse(effort);
  if (!ollamaReasoning(info).levels.includes(checked))
    throw new Error(
      "This Ollama model does not support that thinking level. Choose Auto or a listed level.",
    );
  return checked === "on" ? true : checked === "off" ? false : checked;
}
