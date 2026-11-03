import { z } from "zod";
const id = z.string().min(1).max(200);
export const searchRequest = z
  .object({
    query: z.string().trim().min(1).max(500),
    scope: z
      .string()
      .regex(/^(all|unassigned|project:.+|workflow:.+)$/)
      .max(220)
      .default("all"),
    workflowId: id.optional(),
    runId: id.optional(),
    providerId: id.optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();
export function registerSearchRoutes(app, { search, store, projects }) {
  app.get("/api/search/status", (_, res) => res.json(search.status()));
  app.post("/api/search/retry", async (_, res, next) => {
    try {
      res.json(await search.retry());
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/gallery/search", async (req, res, next) => {
    const controller = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", disconnected);
    try {
      const request = searchRequest.parse(req.body);
      if (request.scope.startsWith("project:"))
        projects.require(request.scope.slice(8));
      const workflowId = request.scope.startsWith("workflow:")
        ? request.scope.slice(9)
        : request.workflowId;
      if (workflowId && !store.workflows.has(workflowId))
        throw new Error("Workflow not found.");
      const result = await search.search(request, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) res.json(result);
    } catch (e) {
      if (!controller.signal.aborted) next(e);
    } finally {
      res.removeListener("close", disconnected);
    }
  });
}
