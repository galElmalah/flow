import { z } from "zod";
import {
  openEditorSchema,
  editorPatchSchema,
  segmentSchema,
  editRequestSchema,
  nameRegionsSchema,
} from "../../shared/image-editor.mjs";
import { projectIdSchema } from "../../shared/projects.mjs";
export function registerImageEditorRoutes(app, { editors }) {
  const route = (handler) => (req, res, next) =>
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  const scope = (req) =>
    req.query.projectId === undefined
      ? undefined
      : projectIdSchema.parse(req.query.projectId);
  app.get(
    "/api/image-editors/status",
    route(async (req, res) => res.json(await editors.model.status())),
  );
  app.post(
    "/api/image-editors/setup",
    route(async (req, res) => {
      editors.model.setup();
      res.status(202).json(await editors.model.status());
    }),
  );
  app.get(
    "/api/image-editors",
    route((req, res) =>
      res.json(
        editors.list(scope(req)).map((editor) => ({
          id: editor.id,
          projectId: editor.projectId ?? editor.source.projectId,
          source: editor.source,
          width: editor.width,
          height: editor.height,
          regionCount: editor.regions.length,
          commentCount: editor.comments.filter((c) => !c.resolved).length,
          segmentation: editor.segmentation,
          updatedAt: editor.updatedAt,
        })),
      ),
    ),
  );
  app.post(
    "/api/image-editors",
    route(async (req, res) =>
      res
        .status(201)
        .json(await editors.open(openEditorSchema.parse(req.body))),
    ),
  );
  app.get(
    "/api/image-editors/:id",
    route((req, res) => res.json(editors.get(req.params.id, scope(req)))),
  );
  app.patch(
    "/api/image-editors/:id",
    route((req, res) =>
      res.json(
        editors.patch(
          req.params.id,
          editorPatchSchema.parse(req.body),
          scope(req),
        ),
      ),
    ),
  );
  app.get(
    "/api/image-editors/:id/variations",
    route((req, res) =>
      res.json(editors.variations(req.params.id, scope(req))),
    ),
  );
  app.post(
    "/api/image-editors/:id/names",
    route((req, res) =>
      res
        .status(202)
        .json(
          editors.nameRegions(
            req.params.id,
            nameRegionsSchema.parse(req.body),
            scope(req),
          ),
        ),
    ),
  );
  app.post(
    "/api/image-editors/:id/names/cancel",
    route((req, res) => {
      z.object({}).strict().parse(req.body);
      res.json(editors.cancelNaming(req.params.id, scope(req)));
    }),
  );
  app.post(
    "/api/image-editors/:id/segments",
    route(async (req, res) =>
      res
        .status(202)
        .json(
          await editors.segment(
            req.params.id,
            segmentSchema.parse(req.body),
            scope(req),
          ),
        ),
    ),
  );
  app.post(
    "/api/image-editors/:id/requests",
    route(async (req, res) =>
      res
        .status(201)
        .json(
          await editors.request(
            req.params.id,
            editRequestSchema.parse(req.body),
            scope(req),
          ),
        ),
    ),
  );
  app.get(
    "/files/editors/:id/:name",
    route(async (req, res) =>
      res.sendFile(await editors.file(req.params.id, req.params.name), {
        dotfiles: "allow",
      }),
    ),
  );
  app.post(
    "/api/image-editors/:id/requests/:requestId/send",
    route(async (req, res) => {
      z.object({}).strict().parse(req.body);
      const requestId = z.string().uuid().parse(req.params.requestId);
      res
        .status(202)
        .json(await editors.send(req.params.id, requestId, scope(req)));
    }),
  );
}
