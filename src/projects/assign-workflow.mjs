// Keep assignment in the same ordered writer as node edits, including rollback.
export async function assignWorkflowProject({
  graph,
  projectId,
  saver,
  setProject,
}) {
  const previous = saver.draft(graph.id) || graph;
  saver.stage({ ...previous, projectId });
  setProject(graph.id, projectId);
  try {
    await saver.flush(graph.id);
  } catch (error) {
    const draft = saver.draft(graph.id) || previous;
    saver.stage({ ...draft, projectId: previous.projectId });
    setProject(graph.id, previous.projectId);
    try {
      await saver.flush(graph.id);
    } catch (restoreError) {
      throw new Error(
        `${error.message} Previous project restored locally; saving is still pending: ${restoreError.message}`,
      );
    }
    throw error;
  }
}
