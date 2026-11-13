import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { planWorkflow } from "./graph.mjs";
import {
  runOptionsSchema,
  runSubmissionSchema,
} from "../shared/run-options.mjs";

const submissions = new WeakMap();
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function replay(queue, submission, projects, projectId) {
  const run = queue.store.findRunSubmission(
    submission.scope,
    submission.requestId,
  );
  if (!run) return null;
  projects.assertWorkflow(run, projectId);
  if (run.submission.fingerprint !== submission.fingerprint)
    throw Object.assign(
      new Error(
        "This requestId already belongs to a different run request. Inspect that run or choose a new requestId.",
      ),
      {
        status: 409,
        code: "REQUEST_ID_REUSED",
        runId: run.id,
      },
    );
  return run;
}

export async function startWorkflowRun(
  { projects, queue, providers, assetPath },
  { graph, workflowId, projectId, options = {}, concurrency, requestId },
) {
  options = runOptionsSchema.parse(options);
  ({ concurrency, requestId } = runSubmissionSchema.parse({
    concurrency,
    requestId,
  }));
  const submission = requestId
    ? {
        requestId,
        scope:
          projectId === undefined
            ? "@workspace"
            : projectId === null
              ? "@unassigned"
              : projectId,
        fingerprint: createHash("sha256")
          .update(
            JSON.stringify(
              canonical({
                workflow: workflowId || graph,
                options,
                concurrency,
              }),
            ),
          )
          .digest("hex"),
      }
    : undefined;
  if (!submission)
    return createRun(
      { projects, queue, providers, assetPath },
      { graph, projectId, options, concurrency },
    );
  let pending = submissions.get(queue);
  if (!pending) submissions.set(queue, (pending = new Map()));
  const key = JSON.stringify([submission.scope, requestId]);
  // Reserve before any asynchronous preflight. The database unique index also
  // protects independent callers sharing storage across a restart.
  if (pending.has(key)) {
    await pending.get(key);
    return replay(queue, submission, projects, projectId);
  }
  const existing = replay(queue, submission, projects, projectId);
  if (existing) return existing;
  const task = createRun(
    { projects, queue, providers, assetPath },
    { graph, projectId, options, concurrency, submission },
  );
  pending.set(key, task);
  try {
    return await task;
  } catch (error) {
    if (error.code?.startsWith("ERR_SQLITE")) {
      const existing = replay(queue, submission, projects, projectId);
      if (existing) return existing;
    }
    throw error;
  } finally {
    pending.delete(key);
  }
}

async function createRun(
  { projects, queue, providers, assetPath },
  { graph, projectId, options, concurrency, submission },
) {
  if (!graph) throw new Error("Choose a workflow first.");
  projects.assertWorkflow(graph, projectId);
  projects.assertActive(graph);
  const plan = planWorkflow(graph, options);
  const assets = new Set(
    plan.jobs.flatMap((job) =>
      job.images.filter((ref) => ref.asset).map((ref) => ref.asset),
    ),
  );
  for (const url of assets) await readFile(assetPath(url));
  await providers.preflight(plan.jobs);
  projects.assertActive(graph);
  return queue.create(plan.graph, options, plan, { concurrency, submission });
}
