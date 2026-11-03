export const inspectorPanels = ["guide", "properties", "runs"];

export function workspacePanelVisibility(active) {
  return {
    library: active === "library",
    flowMenu: active === "workflows",
    panel: inspectorPanels.includes(active) ? active : null,
  };
}

export function changeWorkspacePanel(current, target, value) {
  const open = typeof value === "function" ? value(current === target) : value;
  return open ? target : current === target ? null : current;
}
