import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Only model metadata leaves the cache; its account identity stays private.
export async function codexTextModels(
  home = process.env.CODEX_HOME || path.join(homedir(), ".codex"),
) {
  try {
    const cache = JSON.parse(
      await readFile(path.join(home, "models_cache.json"), "utf8"),
    );
    if (!Array.isArray(cache.models)) return [];
    return cache.models
      .filter(
        (model) =>
          model?.visibility === "list" &&
          typeof model.slug === "string" &&
          /^[a-zA-Z0-9._-]{1,120}$/.test(model.slug),
      )
      .slice(0, 100)
      .map((model) => ({
        id: model.slug,
        name:
          typeof model.display_name === "string"
            ? model.display_name
            : model.slug,
        capabilities: ["text"],
        ...(Array.isArray(model.supported_reasoning_levels) && {
          reasoning: {
            levels: model.supported_reasoning_levels
              .map((level) => level.effort)
              .filter((level) =>
                [
                  "low",
                  "medium",
                  "high",
                  "xhigh",
                  "max",
                  "minimal",
                  "off",
                ].includes(level),
              ),
          },
        }),
        acceptsImages: Array.isArray(model.input_modalities)
          ? model.input_modalities.includes("image")
          : true,
      }));
  } catch {
    return [];
  }
}
