import { z } from "zod";
import { projectIdSchema } from "../../shared/projects.mjs";

export function publicAgentSession(session) {
  return {
    id: session.id,
    projectId: session.projectId,
    updatedAt: session.updatedAt,
    streamRevision: session.streamRevision,
    turns: session.turns.map(({ resolved, proposal, ...turn }) => turn),
  };
}

export function registerEventRoutes(app, { queue, agent, search }) {
  const clients = new Map();
  const send = (response, event) => {
    if (response.destroyed || response.writableEnded) return;
    if (response.writableLength > 1024 * 1024) {
      response.end();
      return;
    }
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const onQueue = (event) => {
    if (event.type === "run" || event.type === "job") search.refresh();
    for (const response of clients.keys()) send(response, event);
  };
  const onAgent = (session) => {
    const event = { type: "agent", session: publicAgentSession(session) };
    for (const [response, id] of clients)
      if (id === session.id) send(response, event);
  };
  queue.on("event", onQueue);
  agent.events.on("change", onAgent);
  app.get("/api/events", (req, res, next) => {
    try {
      const id =
        req.query.sessionId === undefined
          ? null
          : z.string().uuid().parse(req.query.sessionId);
      const scope =
        req.query.projectId === undefined
          ? undefined
          : projectIdSchema.parse(req.query.projectId);
      const session = id && agent.get(id, scope);
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      clients.set(res, id);
      send(res, { type: "connected" });
      if (session)
        send(res, { type: "agent", session: publicAgentSession(session) });
      const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20000);
      req.on("close", () => {
        clients.delete(res);
        clearInterval(keepAlive);
      });
    } catch (error) {
      next(error);
    }
  });
  return () => {
    queue.off("event", onQueue);
    agent.events.off("change", onAgent);
    for (const response of clients.keys()) response.end();
  };
}
