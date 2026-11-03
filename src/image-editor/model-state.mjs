export function shouldDetectRegions(editor, model) {
  if (!editor || !model?.ready || editor.segmentation.inheritedFrom)
    return false;
  const { status, autoModel, model: previousModel } = editor.segmentation;
  if (["running", "queued", "failed"].includes(status)) return false;
  return (
    status === "idle" ||
    Boolean(
      editor.regions.length && (autoModel || previousModel) !== model.model,
    )
  );
}
