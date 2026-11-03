export function styleCategories(styles, categories = []) {
  const names = categories
    .map((category) =>
      typeof category === "string" ? category : category.name || category.id,
    )
    .filter(Boolean);
  return [
    ...new Set([...names, ...styles.map((style) => style.category)]),
  ].sort((a, b) => a.localeCompare(b));
}

export function interleaveStyles(styles) {
  const groups = new Map();
  for (const style of styles) {
    if (!groups.has(style.category)) groups.set(style.category, []);
    groups.get(style.category).push(style);
  }
  const result = [];
  for (let row = 0; result.length < styles.length; row++)
    for (const group of groups.values())
      if (group[row]) result.push(group[row]);
  return result;
}

export function referencePresentation(status = "missing") {
  switch (status) {
    case "queued":
    case "pending":
      return {
        label: "Reference queued",
        detail: "Waiting for a local generation slot.",
        active: true,
      };
    case "running":
      return {
        label: "Generating reference",
        detail: "Your local harness is creating this image.",
        active: true,
      };
    case "retrying":
      return {
        label: "Retrying reference",
        detail: "The local harness is trying this image again.",
        active: true,
      };
    case "failed":
      return {
        label: "Reference generation failed",
        detail: "The style prompt is ready. Review the reference run to retry.",
        active: false,
      };
    case "interrupted":
    case "canceled":
    case "cancelled":
      return {
        label: "Reference generation stopped",
        detail: "The style prompt is ready. This reference needs another run.",
        active: false,
      };
    case "completed":
      return {
        label: "Reference unavailable",
        detail: "The saved image is unavailable. The style prompt is ready.",
        active: false,
      };
    default:
      return {
        label: "No reference image yet",
        detail: "Style direction is ready to use.",
        active: false,
      };
  }
}
