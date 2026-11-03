import { z } from "zod";
import { projectIdSchema } from "../../shared/projects.mjs";
import { agentSessionSchema, askAgentSchema } from "../../shared/agent.mjs";
import { readTrace, browserObservation } from "../../observability/tracing.mjs";

export function registerAgentRoutes(app, { agent }) {
  const route = (handler) => (req, res, next) =>
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  const scope = (req) =>
    req.query.projectId === undefined
      ? undefined
      : projectIdSchema.parse(req.query.projectId);
  app.post(
    "/api/agent/sessions",
    route((req, res) =>
      res
        .status(201)
        .json(agent.open(agentSessionSchema.parse(req.body), scope(req))),
    ),
  );
  app.get(
    "/api/agent/sessions/:id",
    route((req, res) => res.json(agent.get(req.params.id, scope(req)))),
  );
  const timingTurn = (req) => {
    z.string().uuid().parse(req.params.turnId);
    const session = agent.get(req.params.id, scope(req));
    const turn = session.turns.find((t) => t.id === req.params.turnId);
    if (!turn)
      throw Object.assign(new Error("Message not found."), { status: 404 });
    return { session, turn };
  };
  app.get(
    "/api/agent/sessions/:id/turns/:turnId/trace",
    route(async (req, res) => {
      const { turn } = timingTurn(req);
      res.json({
        timing: turn.timing || null,
        spans: turn.timing?.traceId ? await readTrace(turn.timing.traceId) : [],
      });
    }),
  );
  const browserSchema = z
    .object({
      elapsedMs: z.number().min(0).max(3600000),
      prepareMs: z.number().min(0).max(3600000),
      acceptedMs: z.number().min(0).max(3600000),
    })
    .strict();
  app.post(
    "/api/agent/sessions/:id/turns/:turnId/timing",
    route((req, res) => {
      const values = browserSchema.parse(req.body);
      const { session, turn } = timingTurn(req);
      if (!turn.preview?.text && !turn.answer?.message)
        throw Object.assign(new Error("No reply has been published yet."), {
          status: 409,
        });
      if (turn.timing && !turn.timing.browser) {
        turn.timing.browser = {
          ...values,
          observedAt: new Date().toISOString(),
        };
        agent.save(session);
        browserObservation(turn.timing, {
          "ui.elapsed_ms": values.elapsedMs,
          "ui.prepare_ms": values.prepareMs,
          "ui.accepted_ms": values.acceptedMs,
        });
      }
      res.json({ timing: turn.timing || null });
    }),
  );
  app.post(
    "/api/agent/sessions/:id/turns",
    route((req, res) =>
      res
        .status(202)
        .json(
          agent.ask(req.params.id, askAgentSchema.parse(req.body), scope(req)),
        ),
    ),
  );
  for (const action of ["apply", "cancel", "undo"])
    app.post(
      `/api/agent/sessions/:id/turns/:turnId/${action}`,
      route((req, res) => {
        z.object({}).strict().parse(req.body);
        res.json(agent[action](req.params.id, req.params.turnId, scope(req)));
      }),
    );
}
