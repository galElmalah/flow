export function canvasShortcut(
  event,
  {
    editing = false,
    readOnly = false,
    dialogOpen = false,
    interactiveFocus = false,
  } = {},
) {
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key?.toLowerCase();
  if (key === "escape") return "escape";
  if (modifier && key === "s") return "save";
  if (editing || dialogOpen) return null;
  if (!interactiveFocus && event.code === "Space") return "pan";
  if (event.shiftKey && event.key === "!") return "fit";
  if (readOnly) return null;
  if (modifier && key === "z") return event.shiftKey ? "redo" : "undo";
  if (modifier && key === "a") return "select-all";
  if (modifier && key === "d") return "duplicate";
  if (key === "tab" && !interactiveFocus) return "add";
  if (key === "delete" || key === "backspace") return "delete";
  if (modifier && key === "enter") return "run";
  return null;
}

export const canvasIdentity = (state) =>
  `${state.workflow?.id || ""}/${state.viewingRun?.id || "live"}`;
