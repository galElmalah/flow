const visibleTurn = ({ resolved, proposal, ...turn }) => turn;
export function mergeAgentSession(previous, next) {
  if (!previous || previous.id !== next.id) return next;
  if ((next.streamRevision || 0) < (previous.streamRevision || 0))
    return previous;
  const old = new Map(previous.turns.map((turn) => [turn.id, turn]));
  return {
    ...next,
    turns: next.turns.map((turn) => {
      const before = old.get(turn.id);
      return before &&
        JSON.stringify(visibleTurn(before)) ===
          JSON.stringify(visibleTurn(turn))
        ? before
        : turn;
    }),
  };
}
