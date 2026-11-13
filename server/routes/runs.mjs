import path from "node:path";
import { startWorkflowRun } from "../run-service.mjs";
import { ZipArchive } from "archiver";
import { planWorkflow } from "../graph.mjs";
import { summarize } from "../store.mjs";
import { galleryItems } from "../search/documents.mjs";
import { archiveFilterSchema } from "../../shared/archive.mjs";
import { runOptionsSchema } from "../../shared/run-options.mjs";
import {
  generationKind,
  isMediaJob,
  mediaArtifact,
} from "../../shared/media.mjs";

export function registerRunRoutes(
  app,
  { store, projects, queue, providers, assetPath, dataRoot, assets },
) {
  app.post("/api/prompt-sets/preview", (req, res, next) => {
    try {
      const original =
        req.body.workflow || store.workflows.get(req.body.workflowId);
      const graph = original && structuredClone(original);
      if (!graph) throw new Error("Choose a workflow first.");
      projects.assertWorkflow(graph, req.body.projectId);
      projects.assertActive(graph);
      const item = graph.nodes
        .find((n) => n.id === req.body.nodeId && n.type === "prompt-set")
        ?.data.prompts?.find((p) => p.id === req.body.itemId);
      const enabled = item?.enabled !== false;
      if (item) item.enabled = true;
      const plan = planWorkflow(graph, {
        promptSet: { nodeId: req.body.nodeId, itemIds: [req.body.itemId] },
      });
      const variants = new Map();
      for (const job of plan.jobs) {
        const key = `${job.comparison.groupId}/${job.mode.id}`;
        if (variants.has(key)) variants.get(key).count++;
        else
          variants.set(key, {
            nodeId: job.nodeId,
            label: job.label,
            kind: job.kind,
            providerId: job.providerId,
            model: job.model,
            modeId: job.mode.id,
            prompt: job.prompt,
            promptParts: job.promptParts,
            images: job.images,
            seed: job.seed,
            ratio: job.ratio,
            image: job.image,
            count: 1,
            promptSet: job.promptSet,
          });
      }
      res.json({
        nodeId: req.body.nodeId,
        itemId: req.body.itemId,
        enabled,
        total: plan.total,
        variants: [...variants.values()],
      });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/plan", (req, res, next) => {
    try {
      const graph =
        req.body.workflow || store.workflows.get(req.body.workflowId);
      if (!graph) throw new Error("Choose a workflow first.");
      projects.assertWorkflow(graph, req.body.projectId);
      projects.assertActive(graph);
      const plan = planWorkflow(
        graph,
        runOptionsSchema.parse(req.body.options ?? {}),
      );
      res.json({
        workflowId: plan.graph.id,
        revision: plan.graph.revision,
        countSemantics:
          "Copies per enabled scene/record and generation mode; total includes upstream prompt jobs.",
        projectId: plan.graph.projectId,
        total: plan.total,
        textJobs: plan.textJobs,
        imageJobs: plan.imageJobs,
        videoJobs: plan.videoJobs,
        modes: plan.modes,
        contexts: plan.contexts,
        nodes: Object.fromEntries(
          plan.graph.nodes
            .filter((n) => generationKind(n.type))
            .map((n) => [
              n.id,
              plan.jobs.filter((j) => j.nodeId === n.id).length,
            ]),
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/runs", async (req, res, next) => {
    try {
      const graph =
        req.body.workflow || store.workflows.get(req.body.workflowId);
      const run = await startWorkflowRun(
        { projects, queue, providers, assetPath },
        {
          graph,
          workflowId: req.body.workflow ? undefined : req.body.workflowId,
          projectId: req.body.projectId,
          options: req.body.options,
          concurrency: req.body.concurrency,
          requestId: req.body.requestId,
        },
      );
      res.status(201).json(run);
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/runs", (req, res, next) => {
    try {
      res.json(
        projects
          .filter(
            store.listRuns({
              archived: archiveFilterSchema.parse(
                req.query.archived || "active",
              ),
            }),
            req.query.projectId,
          )
          .map(summarize),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/runs/:id", (req, res, next) => {
    const r = store.runs.get(req.params.id);
    if (!r) return res.status(404).json({ error: "Run not found." });
    try {
      projects.assertWorkflow(r, req.query.projectId);
      res.json(r);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/runs/:id/:action", (req, res, next) => {
    try {
      const run = store.runs.get(req.params.id);
      if (!run) return res.status(404).json({ error: "Run not found." });
      projects.assertWorkflow(run, req.body?.projectId);
      if (["retry", "resume"].includes(req.params.action))
        projects.assertActive(run);
      res.json(queue.action(req.params.id, req.params.action));
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/gallery", (req, res, next) => {
    try {
      res.json(
        galleryItems(
          projects.filter(
            store.listRuns({ archived: "active" }),
            req.query.projectId,
          ),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/runs/:id/manifest", (req, res, next) => {
    const run = store.runs.get(req.params.id);
    if (!run) return res.sendStatus(404);
    try {
      projects.assertWorkflow(run, req.query.projectId);
      res.attachment(`flow-${run.id}.json`).json(run);
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/runs/:id/download", async (req, res, next) => {
    const run = store.runs.get(req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found." });
    try {
      projects.assertWorkflow(run, req.query.projectId);
    } catch (error) {
      return next(error);
    }
    const outputs = run.jobs.filter(
      (j) => isMediaJob(j) && j.status === "completed" && j.output,
    );
    if (!outputs.length)
      return res
        .status(400)
        .json({ error: "This run has no completed images or videos yet." });
    let dataset;
    try {
      if (assets)
        dataset = await assets.dataset({
          projectId: run.projectId ?? null,
          runId: run.id,
          mode: "all",
        });
    } catch (error) {
      return next(error);
    }
    res.attachment(`flow-${run.id}.zip`);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on("error", (error) => {
      if (res.headersSent) res.destroy(error);
      else next(error);
    });
    archive.on("warning", (error) => {
      if (res.headersSent) res.destroy(error);
      else next(error);
    });
    res.on("close", () => archive.abort());
    archive.pipe(res);
    for (const [i, job] of outputs.entries())
      archive.file(
        path.join(
          dataRoot,
          "runs",
          run.id,
          job.id,
          mediaArtifact(job).basename,
        ),
        {
          name: `${String(i + 1).padStart(4, "0")}-${String(
            job.mode?.id || job.providerId || "default",
          )
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(
              0,
              60,
            )}-${(job.records?.[0]?.fields.readingID || job.records?.[0]?.fields.assetID || "seed-" + job.seed).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160)}.${mediaArtifact(job).extension}`,
        },
      );
    archive.append(JSON.stringify(run, null, 2), { name: "manifest.json" });
    if (dataset)
      archive.append(
        dataset.rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
        { name: "assets.jsonl" },
      );
    archive.finalize();
  });
}
