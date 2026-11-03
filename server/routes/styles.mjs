import { z } from "zod";
import { projectIdSchema } from "../../shared/projects.mjs";
import {
  styleFavoriteSchema,
  styleReferencesSchema,
  styleListSchema,
} from "../../shared/styles/schema.mjs";
import { StyleLibrary } from "../styles.mjs";

export function registerStyleRoutes(app, services) {
  const library = new StyleLibrary(services);
  const route = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
  app.get(
    "/api/styles",
    route(async (req, res) => {
      const options = styleListSchema.parse(req.query);
      res.json(
        await library.list({
          ...options,
          favorites: ["true", "1"].includes(options.favorites),
        }),
      );
    }),
  );
  app.post(
    "/api/styles",
    route(async (req, res) => {
      res.status(201).json(await library.create(req.body));
    }),
  );
  app.put(
    "/api/styles/:id",
    route(async (req, res) => {
      res.json(await library.update(req.params.id, req.body));
    }),
  );
  app.post(
    "/api/styles/import-run",
    route(async (req, res) => {
      const input = z
        .object({
          runId: z.string().min(1).max(100),
          projectId: projectIdSchema.optional(),
        })
        .strict()
        .parse(req.body);
      res.json(await library.importRun(input.runId, input.projectId));
    }),
  );
  app.get(
    "/api/styles/:id",
    route((req, res) => res.json(library.read(req.params.id))),
  );
  app.put(
    "/api/styles/:id/favorite",
    route((req, res) => {
      res.json(
        library.favorite(
          req.params.id,
          styleFavoriteSchema.parse(req.body).favorite,
        ),
      );
    }),
  );
  app.post(
    "/api/styles/:id/references",
    route(async (req, res) => {
      res.json(
        await library.saveReferences(
          req.params.id,
          styleReferencesSchema.parse(req.body).references,
        ),
      );
    }),
  );
  app.post(
    "/api/styles/:id/workflows",
    route(async (req, res) => {
      res.status(201).json(await library.start(req.params.id, req.body));
    }),
  );
  return library;
}
