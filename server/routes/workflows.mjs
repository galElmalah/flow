import { randomUUID } from "node:crypto";
import { fromFlowFile } from "../../shared/flow-file.mjs";
import { validateGraph } from "../../shared/graph.mjs";
import {
  organizeGraph,
  organizeOptionsSchema,
} from "../../shared/graph-layout.mjs";
import { latestNodeJobs } from "../store.mjs";
import {
  archiveFilterSchema,
  archiveWorkflowsSchema,
} from "../../shared/archive.mjs";

export function registerWorkflowRoutes(
  app,
  { store, projects, assetPath, search },
) {
  function prepare(input) {
    const { graph } = validateGraph(fromFlowFile(input));
    projects.assertWorkflow(graph);
    projects.assertActive(graph);
    for (const node of graph.nodes)
      for (const url of [
        ...(node.data.images || []),
        ...(node.data.records || []).flatMap((record) => record.images || []),
        ...(node.data.prompts || []).flatMap((item) => item.images || []),
      ])
        assetPath(url);
    return graph;
  }

  app.get("/api/workflows", (req, res, next) => {
    try {
      const graphs = projects.filter(
        store.listWorkflows(
          archiveFilterSchema.parse(req.query.archived || "active"),
        ),
        req.query.projectId,
      );
      res.json(
        req.query.summary === "1"
          ? graphs.map((graph) => ({
              id: graph.id,
              name: graph.name,
              projectId: graph.projectId,
              nodeCount: graph.nodes.length,
              archived: store.isWorkflowArchived(graph.id),
            }))
          : graphs,
      );
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/workflows/archive", (req, res, next) => {
    try {
      const input = archiveWorkflowsSchema.parse(req.body);
      res.json(
        projects.archiveWorkflows(
          input.ids,
          input.archived,
          input.reason,
          input.projectId,
        ),
      );
      search?.refresh();
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/workflows/:id", (req, res, next) => {
    const graph = store.workflows.get(req.params.id);
    if (!graph) return res.status(404).json({ error: "Workflow not found." });
    try {
      projects.assertWorkflow(graph, req.query.projectId);
      res.json(graph);
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/workflows/:id/results", (req, res, next) => {
    const graph = store.workflows.get(req.params.id);
    if (!graph) return res.status(404).json({ error: "Workflow not found." });
    try {
      projects.assertWorkflow(graph, req.query.projectId);
      res.json(latestNodeJobs(store.listRuns(), graph));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/workflows", async (req, res, next) => {
    try {
      const body = Object.hasOwn(req.body, "format")
        ? fromFlowFile(req.body)
        : req.body;
      const graph = prepare({ ...body, id: body.id ?? randomUUID() });
      if (store.workflows.has(graph.id))
        throw Object.assign(
          new Error(
            "Workflow already exists. Use PUT to replace it or fork first.",
          ),
          {
            status: 409,
          },
        );
      await store.saveWorkflow(graph);
      res.status(201).json(graph);
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/workflows/:id", async (req, res, next) => {
    try {
      const body = Object.hasOwn(req.body, "format")
        ? fromFlowFile(req.body)
        : req.body;
      if (body.id !== req.params.id)
        throw new Error("Workflow ID does not match.");
      const graph = prepare(body);
      projects.assertReassignment(graph);
      const previous = store.workflows.get(graph.id);
      if (previous && graph.revision !== (previous.revision || 0))
        throw Object.assign(
          new Error(
            "This workflow changed elsewhere. Reopen it before saving; your local draft is preserved.",
          ),
          { status: 409 },
        );
      graph.revision = previous ? (previous.revision || 0) + 1 : 0;
      await store.saveWorkflow(graph);
      res.json(graph);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/workflows/:id/organize", async (req, res, next) => {
    try {
      const input = organizeOptionsSchema.parse(req.body);
      const source = store.workflows.get(req.params.id);
      if (!source)
        return res.status(404).json({ error: "Workflow not found." });
      projects.assertWorkflow(source, req.query.projectId);
      projects.assertActive(source);
      const assertCurrent = () => {
        const current = store.workflows.get(source.id);
        if (!current || (current.revision || 0) !== input.revision)
          throw Object.assign(
            new Error(
              "This workflow changed while organizing. Reopen it and try again.",
            ),
            { status: 409 },
          );
        projects.assertWorkflow(current, req.query.projectId);
        projects.assertActive(current);
      };
      assertCurrent();
      const result = await organizeGraph(source, input);
      assertCurrent();
      const graph = prepare(result.graph);
      if (!input.preview) {
        graph.revision = input.revision + 1;
        await store.saveWorkflow(graph);
      }
      res.json({ workflow: graph, diagnostics: result.diagnostics });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/workflows/:id/fork", async (req, res, next) => {
    try {
      const recorded = req.body.runId !== undefined;
      if (
        recorded &&
        (typeof req.body.runId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(req.body.runId))
      )
        throw new Error("Provide a valid source runId.");
      if (recorded && req.body.workflow !== undefined)
        throw new Error(
          "Choose a recorded runId or a workflow snapshot, not both.",
        );
      const run = recorded ? store.runs.get(req.body.runId) : null;
      if (recorded && !run)
        return res.status(404).json({ error: "Source run not found." });
      if (run) {
        projects.assertWorkflow(run, req.query.projectId);
        if (run.workflowId !== req.params.id)
          throw Object.assign(
            new Error("Source run belongs to another workflow."),
            { status: 409 },
          );
        if (!run.graph)
          throw Object.assign(
            new Error("This run has no recorded workflow snapshot to fork."),
            { status: 409 },
          );
      }
      const source = run?.graph || store.workflows.get(req.params.id);
      if (!source)
        return res.status(404).json({ error: "Workflow not found." });
      const snapshot = run?.graph || req.body.workflow || source;
      if (snapshot.id !== source.id)
        throw new Error("Fork source ID does not match.");
      const graph = prepare({
        ...snapshot,
        revision: 0,
        id: randomUUID(),
        name: req.body.name ?? `${snapshot.name.slice(0, 113)} · fork`,
        projectId: Object.hasOwn(req.body, "projectId")
          ? req.body.projectId
          : source.projectId,
        forkedFrom: {
          workflowId: source.id,
          ...(run && { runId: run.id }),
          name: source.name,
          createdAt: new Date().toISOString(),
        },
      });
      await store.saveWorkflow(graph);
      res.status(201).json(graph);
    } catch (error) {
      next(error);
    }
  });
}
