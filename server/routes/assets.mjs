import { projectIdSchema } from "../../shared/projects.mjs";
import {
  assetAnnotationRequestSchema,
  datasetModeSchema,
} from "../../shared/assets.mjs";
export function registerAssetRoutes(app, { assets }) {
  const route = (handler) => (req, res, next) =>
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  const scope = (req) =>
    req.query.projectId === undefined
      ? undefined
      : req.query.projectId === "unassigned"
        ? null
        : projectIdSchema.parse(req.query.projectId);
  app.get(
    "/api/assets",
    route(async (req, res) =>
      res.json(
        await assets.list({
          projectId: scope(req),
          url: req.query.url,
          runId: req.query.runId,
          jobId: req.query.jobId,
          workflowId: req.query.workflowId,
        }),
      ),
    ),
  );
  app.get(
    "/api/assets/dataset",
    route(async (req, res) => {
      const data = await assets.dataset({
        projectId: scope(req),
        runId: req.query.runId,
        workflowId: req.query.workflowId,
        mode: datasetModeSchema.parse(req.query.mode || "all"),
      });
      res.type("application/x-ndjson").attachment("weft-assets.jsonl");
      res.set("X-Weft-Dataset-Total", String(data.total));
      res.set("X-Weft-Dataset-Skipped", String(data.skipped.length));
      res.set(
        "X-Weft-Dataset-Skip-Reasons",
        JSON.stringify(
          data.skipped.reduce((counts, row) => {
            for (const reason of row.reasons)
              counts[reason] = (counts[reason] || 0) + 1;
            return counts;
          }, {}),
        ),
      );
      res.send(
        data.rows.map((row) => JSON.stringify(row)).join("\n") +
          (data.rows.length ? "\n" : ""),
      );
    }),
  );
  app.get(
    "/api/assets/:id",
    route((req, res) => res.json(assets.get(req.params.id, scope(req)))),
  );
  app.get(
    "/api/assets/:id/lineage",
    route((req, res) => res.json(assets.lineage(req.params.id, scope(req)))),
  );
  app.patch(
    "/api/assets/:id/annotations",
    route((req, res) => {
      const { projectId: requestedProjectId, ...input } =
        assetAnnotationRequestSchema.parse(req.body);
      const projectId =
        requestedProjectId === "unassigned" ? null : requestedProjectId;
      res.json(
        assets.annotate(
          req.params.id,
          input,
          projectId === undefined ? scope(req) : projectId,
        ),
      );
    }),
  );
}
