import { readFile } from "node:fs/promises";
import { planWorkflow } from "./graph.mjs";

export async function startWorkflowRun(
  { projects, queue, providers, assetPath },
  { graph, projectId, options = {}, concurrency },
) {
  if (!graph) throw new Error("Choose a workflow first.");
  projects.assertWorkflow(graph, projectId);
  projects.assertActive(graph);
  const plan = planWorkflow(graph, options);
  if (
    concurrency !== undefined &&
    (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128)
  )
    throw new Error("Parallel jobs must be 1–128.");
  const assets = new Set(
    plan.jobs.flatMap((job) =>
      job.images.filter((ref) => ref.asset).map((ref) => ref.asset),
    ),
  );
  for (const url of assets) await readFile(assetPath(url));
  await providers.preflight(plan.jobs);
  projects.assertActive(graph);
  if (concurrency !== undefined) queue.concurrency = concurrency;
  return queue.create(plan.graph, options, plan);
}
