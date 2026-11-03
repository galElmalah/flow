export function fitImage({ width, height }, viewport) {
  if (!(width > 0 && height > 0 && viewport.width > 0 && viewport.height > 0))
    return { zoom: 1, x: 0, y: 0 };
  return {
    zoom: Math.min(1, viewport.width / width, viewport.height / height),
    x: 0,
    y: 0,
  };
}
export function zoomImage(
  view,
  target,
  point = { x: 0, y: 0 },
  minimum = 0.05,
) {
  const zoom = Math.max(minimum, Math.min(8, target));
  const ratio = zoom / view.zoom;
  return {
    zoom,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  };
}
