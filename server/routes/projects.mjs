import { z } from "zod";
import {
  archiveFilterSchema,
  archiveProjectSchema,
} from "../../shared/archive.mjs";
export function registerProjectRoutes(app, { projects, search }) {
  app.get("/api/projects", (req, res, next) => {
    try {
      res.json(
        projects.list(
          z
            .object({
              search: z.string().max(500).optional(),
              archived: archiveFilterSchema.optional(),
            })
            .strict()
            .parse(req.query),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects/:id/archive", (req, res, next) => {
    try {
      const input = archiveProjectSchema.parse(req.body);
      res.json(
        projects.archiveProject(req.params.id, input.archived, input.reason),
      );
      search?.refresh();
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/projects/:id", (req, res, next) => {
    try {
      res.json(projects.require(req.params.id));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects", async (req, res, next) => {
    try {
      const { project, created } = await projects.create(req.body);
      res.status(created ? 201 : 200).json(project);
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/projects/:id", async (req, res, next) => {
    try {
      res.json(await projects.update(req.params.id, req.body));
    } catch (error) {
      next(error);
    }
  });
}
