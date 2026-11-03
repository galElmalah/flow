import { randomUUID } from "node:crypto";
const now = () => new Date().toISOString();
export function startActivity(turn, name, kind, input) {
  const call = {
    id: randomUUID(),
    name,
    kind,
    input,
    status: "running",
    startedAt: now(),
  };
  (turn.activity ||= []).push(call);
  return call;
}
export function finishActivity(turn, name, status, output) {
  const call = turn.activity?.findLast(
    (item) => item.name === name && item.status === "running",
  );
  if (call)
    Object.assign(call, {
      status,
      finishedAt: now(),
      ...(output !== undefined && { output }),
    });
}
export function finishPendingActivity(turn, status, message) {
  for (const item of turn.activity || [])
    if (item.status === "running")
      finishActivity(turn, item.name, status, { message });
}
