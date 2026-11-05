import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { FlowClient, createImageWorkflow } from "../client/index.mjs";
import { projectManifestSchema } from "../shared/projects.mjs";

// The demo owns only this dedicated local project. Reopening never submits another run.
export async function createLocalDemo({ url, dataRoot }) {
  const projectId = "flow-demo",
    workflowId = "flow-demo";
  const directory = path.join(dataRoot, "demo-project");
  await mkdir(directory, { recursive: true });
  const projectRoot = await realpath(directory);
  const client = new FlowClient({ url, projectId });
  const existing = (await client.projects()).find((p) => p.id === projectId);
  if (existing && path.resolve(existing.root) !== path.resolve(projectRoot))
    throw new Error(
      "The flow-demo project already belongs to another folder. Open it from Projects instead.",
    );
  if (!existing)
    await client.createProject({
      id: projectId,
      name: "Flow demo",
      root: projectRoot,
    });
  const manifestPath = path.join(projectRoot, "flow.project.json");
  const manifest = {
    version: 1,
    projectId,
    serverUrl: url,
    defaultWorkflowId: workflowId,
  };
  const previous = await readFile(manifestPath, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  const prior = previous && projectManifestSchema.parse(JSON.parse(previous));
  if (
    prior &&
    (prior.projectId !== projectId || prior.defaultWorkflowId !== workflowId)
  )
    throw new Error(
      "The demo project pointer has been changed. Open the existing project instead.",
    );
  if (!prior || prior.serverUrl !== url)
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const workflows = await client.workflows();
  const reused = workflows.some((graph) => graph.id === workflowId);
  let run;
  if (!reused) {
    const graph = await client.createWorkflow(
      createImageWorkflow({
        id: workflowId,
        projectId,
        name: "First flow · local color studies",
        prompt: "Explore the colors and texture of this reference.",
        images: ["/assets/paper-seed.png"],
        providerId: "local-color",
        model: "color-study",
        count: 4,
        seed: 42,
      }),
    );
    await client.updateProject(projectId, { defaultWorkflowId: graph.id });
    const plan = await client.plan(graph.id);
    if (plan.total !== 4 || plan.textJobs !== 0 || plan.videoJobs !== 0)
      throw new Error(
        "The local demo plan did not contain exactly four image-processing jobs.",
      );
    run = await client.run(graph.id, {}, { concurrency: 4 });
    run = await client.wait(run.id, { timeout: 120 });
    if (run.status !== "completed")
      throw new Error(
        `Demo run ${run.id} ended ${run.status}. Inspect it rather than submitting again.`,
      );
  } else {
    const latest = (await client.runs()).find(
      (item) => item.workflowId === workflowId,
    );
    if (latest) run = await client.inspect(latest.id);
  }
  const viewer = await client.viewer({ workflowId });
  return {
    projectId,
    workflowId,
    runId: run?.id || null,
    status: run?.status || "draft",
    reused,
    url: viewer.url,
    outputs: (run?.jobs || [])
      .filter((job) => job.status === "completed")
      .map((job) => ({ url: job.output, assetId: job.assetId })),
  };
}
