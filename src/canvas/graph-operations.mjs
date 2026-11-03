export function copySubgraph(nodes, edges, ids) {
  const selected = new Set(ids);
  return {
    nodes: structuredClone(nodes.filter((n) => selected.has(n.id))),
    edges: structuredClone(
      edges.filter((e) => selected.has(e.source) && selected.has(e.target)),
    ),
  };
}
export function cloneSubgraph(
  graph,
  { offset = { x: 55, y: 55 }, idFactory = () => crypto.randomUUID() } = {},
) {
  const ids = new Map(graph.nodes.map((n) => [n.id, idFactory()]));
  return {
    nodes: graph.nodes.map((n) => ({
      ...structuredClone(n),
      data: {
        ...structuredClone(n.data),
        ...(n.data.members && {
          members: n.data.members
            .filter((id) => ids.has(id))
            .map((id) => ids.get(id)),
        }),
      },
      id: ids.get(n.id),
      selected: true,
      position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
    })),
    edges: graph.edges.map((e) => ({
      ...structuredClone(e),
      id: idFactory(),
      source: ids.get(e.source),
      target: ids.get(e.target),
      selected: false,
    })),
  };
}
