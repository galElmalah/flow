export const gptImage26Models = [
  "gpt-image-2.6-sunburst",
  "gpt-image-2.6-flare",
];
export const isGptImage26 = (model) => gptImage26Models.includes(model);
export const codexImageDetail = {
  id: "native",
  label: "Codex Images · current",
  capabilities: ["image"],
  acceptsImages: true,
  outputFormats: ["png", "jpeg", "webp", "gif"],
  backgrounds: ["auto", "opaque", "transparent"],
  animationMethod: "sprite-sheet",
};
export function imageModelDetails(model) {
  return isGptImage26(model)
    ? {
        label: model.endsWith("flare")
          ? "GPT Image 2.6 Flare"
          : "GPT Image 2.6 Sunburst",
        outputFormats: ["png", "jpeg", "webp", "gif", "svg"],
        complexityLevels: ["low", "medium", "high"],
        backgrounds: ["auto", "opaque", "transparent"],
        animationMethod: "native",
        markup: true,
      }
    : {};
}
export function validateImageSettings(provider, job) {
  if (job.kind !== "image") return;
  const settings = job.image || {};
  const detail = provider.modelDetails?.find((model) => model.id === job.model);
  const api = ["compatible", "image-api"].includes(provider.kind);
  const supported =
    provider.kind === "codex"
      ? codexImageDetail
      : api && isGptImage26(job.model)
        ? imageModelDetails(job.model)
        : detail || {};
  const format = settings.outputFormat || "png";
  if (settings.markup) {
    if (!api || !isGptImage26(job.model))
      throw new Error(
        "Native markup layers require a GPT Image 2.6 API model.",
      );
    if (
      ["gif", "svg"].includes(format) ||
      job.edit ||
      job.images.length < 2 ||
      job.images.at(-1)?.role !== "markup"
    )
      throw new Error(
        "Markup requires a distinct transparent PNG layer and a source image, with still raster output and no region mask.",
      );
  }
  if (!(supported.outputFormats || ["png"]).includes(format))
    throw new Error(
      `${provider.name} / ${job.model} does not support ${format.toUpperCase()} output. Choose a supported image model; Flow will not switch providers.`,
    );
  if (
    settings.complexity &&
    !supported.complexityLevels?.includes(settings.complexity)
  )
    throw new Error(
      "Complexity requires a GPT Image 2.6 API model. Codex does not expose this control.",
    );
  if (
    settings.background &&
    !supported.backgrounds?.includes(settings.background)
  )
    throw new Error("This provider does not expose background controls.");
  if (api && ["gif", "svg"].includes(format) && job.images.length)
    throw new Error(
      `The Image API does not support ${format.toUpperCase()} output on image edits. Use text-only generation, or Codex sprite-sheet GIFs with references.`,
    );
  if (["gif", "svg"].includes(format) && job.edit)
    throw new Error(
      "Region editing requires a still raster image. Generate a GIF or SVG in an image generation node instead.",
    );
  if (job.edit && format !== "png")
    throw new Error(
      "Image region edits require PNG output to preserve the edited pixels.",
    );
}
