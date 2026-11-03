const key = (projectId) => `flow:agent-view:${projectId || "unassigned"}`;
export function readAgentView(storage, projectId) {
  try {
    const value = JSON.parse(storage.getItem(key(projectId)) || "{}");
    if (!value || typeof value !== "object") return {};
    return {
      ...(typeof value.open === "boolean" && { open: value.open }),
      ...Object.fromEntries(
        [
          "sessionId",
          "provider",
          "model",
          "reasoningEffort",
          "autoApplyId",
          "draft",
        ]
          .filter(
            (name) =>
              typeof value[name] === "string" &&
              value[name].length <= (name === "draft" ? 16000 : 120),
          )
          .map((name) => [name, value[name]]),
      ),
    };
  } catch {
    return {};
  }
}
export function rememberAgentView(storage, projectId, changes) {
  try {
    storage.setItem(
      key(projectId),
      JSON.stringify({ ...readAgentView(storage, projectId), ...changes }),
    );
  } catch {
    // Browser storage is optional; server execution never depends on it.
  }
}
export async function restoreAgentSession(client, saved) {
  if (saved.sessionId) {
    try {
      return await client.agentConversation(saved.sessionId);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  return client.agentSession();
}
export function restoredAgentDraft(saved, turn) {
  return turn &&
    turn.id === saved.autoApplyId &&
    saved.draft?.trim() === turn.message
    ? ""
    : saved.draft || "";
}
export function agentElapsed(turn, now = Date.now()) {
  const start = Date.parse(turn?.startedAt || turn?.createdAt);
  if (!Number.isFinite(start)) return "";
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
