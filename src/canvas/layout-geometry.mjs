function measuredGeometry(internal, node) {
  const width = internal?.measured?.width || node.measured?.width;
  const height = internal?.measured?.height || node.measured?.height;
  if (!(width > 0 && height > 0)) return null;
  const handles = internal?.internals?.handleBounds;
  const ports = [];
  for (const kind of ["source", "target"])
    for (const handle of handles?.[kind] || []) {
      const position =
        handle.position || (kind === "source" ? "right" : "left");
      ports.push({
        id: handle.id ?? null,
        kind,
        x:
          handle.x +
          (position === "right"
            ? handle.width
            : position === "left"
              ? 0
              : handle.width / 2),
        y:
          handle.y +
          (position === "bottom"
            ? handle.height
            : position === "top"
              ? 0
              : handle.height / 2),
      });
    }
  return { width, height, ...(ports.length ? { ports } : {}) };
}

export function collectCanvasGeometry(flow, nodes) {
  const geometry = {};
  for (const node of nodes) {
    const measured = measuredGeometry(flow.getInternalNode(node.id), node);
    if (measured) geometry[node.id] = measured;
  }
  return geometry;
}
