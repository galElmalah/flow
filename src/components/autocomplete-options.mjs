const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();

export function filterOptions(options, query) {
  const text = normalize(query).trim().replace(/\s+/g, " ");
  if (!text) return options;
  const words = text.split(" ");
  return options
    .map((option, index) => {
      const label = normalize(option.label);
      const keywords = normalize(
        [
          option.keywords,
          ...(option.children || []).map(
            (child) => `${child.label} ${child.keywords || ""}`,
          ),
        ].join(" "),
      );
      const value = normalize(option.value);
      const labelWords = label.split(/[^\p{L}\p{N}]+/u);
      const allInLabel = words.every((word) => label.includes(word));
      const rank = label.startsWith(text)
        ? 0
        : allInLabel &&
            words.every((word) =>
              labelWords.some((part) => part.startsWith(word)),
            )
          ? 1
          : allInLabel
            ? 2
            : words.every((word) => `${label} ${keywords}`.includes(word))
              ? 3
              : words.every((word) =>
                    `${label} ${keywords} ${value}`.includes(word),
                  )
                ? 4
                : -1;
      return { option, index, rank };
    })
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ option }) => option);
}

export function findChoice(options, value) {
  for (const option of options) {
    if (String(option.value) === String(value)) return option;
    const child = option.children?.find(
      (item) => String(item.value) === String(value),
    );
    if (child) return child;
  }
}

export function childChoices(parent, query) {
  if (!parent) return [];
  return filterOptions([{ ...parent, children: [] }], query).length
    ? parent.children || []
    : filterOptions(
        (parent.children || []).map((child) => ({
          ...child,
          keywords: `${parent.label} ${parent.keywords || ""} ${child.keywords || ""}`,
        })),
        query,
      ).map((match) =>
        parent.children.find((child) => child.value === match.value),
      );
}

export function nextEnabled(options, current, direction) {
  for (let step = 1; step <= options.length; step++) {
    const index =
      (current + direction * step + options.length) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function popupPosition(rect, viewport, desiredHeight, minWidth = 180) {
  const margin = 8,
    gap = 5;
  const below = viewport.height - rect.bottom - margin - gap;
  const above = rect.top - margin - gap;
  const flip = below < Math.min(desiredHeight, 180) && above > below;
  const maxHeight = Math.max(0, Math.min(300, flip ? above : below));
  const height = Math.min(desiredHeight, maxHeight);
  const width = Math.min(
    Math.max(rect.width, minWidth),
    viewport.width - margin * 2,
  );
  return {
    left: Math.max(
      margin,
      Math.min(rect.left, viewport.width - width - margin),
    ),
    top: flip ? rect.top - gap - height : rect.bottom + gap,
    width,
    maxHeight,
  };
}
