export function tooltipPosition(anchor, tooltip, viewport, preferred = "top") {
  const gap = 9,
    edge = 8;
  let side = preferred;
  if (
    side === "right" &&
    anchor.right + gap + tooltip.width > viewport.width - edge
  )
    side = "left";
  if (side === "left" && anchor.left - gap - tooltip.width < edge)
    side = "right";
  if (side === "top" && anchor.top - gap - tooltip.height < edge)
    side = "bottom";
  if (
    side === "bottom" &&
    anchor.bottom + gap + tooltip.height > viewport.height - edge
  )
    side = "top";
  const x =
    side === "right"
      ? anchor.right + gap
      : side === "left"
        ? anchor.left - gap - tooltip.width
        : anchor.left + (anchor.width - tooltip.width) / 2;
  const y =
    side === "top"
      ? anchor.top - gap - tooltip.height
      : side === "bottom"
        ? anchor.bottom + gap
        : anchor.top + (anchor.height - tooltip.height) / 2;
  return {
    left: Math.max(edge, Math.min(x, viewport.width - tooltip.width - edge)),
    top: Math.max(edge, Math.min(y, viewport.height - tooltip.height - edge)),
    side,
  };
}
