export const graphForSave = (g, nodes, edges, viewport) => ({
  ...g,
  nodes: nodes.map(({ id, type, position, data }) => ({
    id,
    type,
    position,
    data,
  })),
  edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
  })),
  ...(viewport ? { viewport } : {}),
});
