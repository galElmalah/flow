import { settingsSections } from "../../shared/viewer-routes.mjs";
const targetKeys = ["project", "workflow", "node", "run", "gallery", "view"];

/** Resolve an explicit deep link without changing any saved workflow or run. */
export async function resolveViewerTarget(
  params,
  { workflows, projects, fetchRun },
) {
  if (params.has("__routeError")) throw new Error(params.get("__routeError"));
  if (!targetKeys.some((key) => params.has(key))) return null;
  if (params.get("view") === "settings") {
    if (
      params.has("section") &&
      !settingsSections.includes(params.get("section"))
    )
      throw new Error("Unknown settings section.");
    if (
      ["project", "workflow", "node", "run", "gallery", "editor"].some((key) =>
        params.has(key),
      )
    )
      throw new Error("Settings cannot target workflow resources.");
    return { settings: true, section: params.get("section") || "workspace" };
  }
  const readId = (key) => {
    if (!params.has(key)) return null;
    const value = params.get(key);
    if (!value.trim()) throw new Error(`Viewer ${key} must not be empty.`);
    return value;
  };
  const projectId = readId("project");
  const explicitWorkflowId = readId("workflow");
  const nodeId = readId("node");
  const runId = readId("run");
  const galleryValue = params.get("gallery");
  if (
    galleryValue !== null &&
    !["1", "true", "0", "false"].includes(galleryValue)
  )
    throw new Error("Viewer gallery must be 1 or 0.");
  const gallery = galleryValue === "1" || galleryValue === "true";
  const view = params.get("view");
  if (view !== null && !["styles", "projects"].includes(view))
    throw new Error("Viewer view must be styles or projects.");
  const styles = view === "styles";
  if (styles && gallery)
    throw new Error("Choose the image gallery or style library.");
  const project = projectId
    ? projects.find((item) => item.id === projectId)
    : null;
  if (projectId && !project)
    throw new Error(`Project ${projectId} was not found.`);
  if (view === "projects") {
    if (explicitWorkflowId || nodeId || runId || gallery)
      throw new Error(
        "Projects view cannot also target a workflow, run or gallery.",
      );
    return {
      workflow: null,
      run: null,
      nodeId: null,
      gallery: false,
      projectId,
      projects: true,
    };
  }
  const explicitWorkflow = explicitWorkflowId
    ? workflows.find((item) => item.id === explicitWorkflowId)
    : null;
  if (explicitWorkflowId && !explicitWorkflow && !runId)
    throw new Error(`Workflow ${explicitWorkflowId} was not found.`);
  if (projectId && explicitWorkflow && explicitWorkflow.projectId !== projectId)
    throw new Error(
      `Workflow ${explicitWorkflowId} does not belong to project ${projectId}.`,
    );
  const run = runId ? await fetchRun(runId) : null;
  if (runId && (!run || run.id !== runId))
    throw new Error(`Run ${runId} was not found.`);
  if (run && explicitWorkflowId && run.workflowId !== explicitWorkflowId)
    throw new Error(
      `Run ${runId} belongs to workflow ${run.workflowId}, not ${explicitWorkflowId}.`,
    );
  if (run && projectId && run.projectId !== projectId)
    throw new Error(`Run ${runId} does not belong to project ${projectId}.`);
  if (
    run &&
    explicitWorkflow &&
    (run.projectId ?? null) !== (explicitWorkflow.projectId ?? null)
  )
    throw new Error(
      `Run ${runId} and workflow ${explicitWorkflowId} have different project ownership.`,
    );
  let workflow;
  if (run) {
    if (
      !run.workflowId ||
      !Array.isArray(run.graph?.nodes) ||
      !Array.isArray(run.graph?.edges)
    )
      throw new Error(`Run ${runId} has no valid workflow snapshot.`);
    workflow = {
      ...structuredClone(run.graph),
      id: run.workflowId,
      projectId: run.projectId ?? null,
    };
  } else {
    const workflowId = explicitWorkflowId || project?.defaultWorkflowId;
    const saved = workflowId
      ? workflows.find((item) => item.id === workflowId)
      : null;
    if (workflowId && !saved)
      throw new Error(`Workflow ${workflowId} was not found.`);
    if (projectId && saved && saved.projectId !== projectId)
      throw new Error(
        `Workflow ${workflowId} does not belong to project ${projectId}.`,
      );
    workflow = saved ? structuredClone(saved) : null;
  }
  if (nodeId && !workflow)
    throw new Error("Choose a workflow before opening a node.");
  if (nodeId && !workflow.nodes.some((node) => node.id === nodeId))
    throw new Error(
      `Node ${nodeId} was not found in ${run ? "this run's workflow snapshot" : `workflow ${workflow.id}`}.`,
    );
  return {
    workflow,
    run,
    nodeId,
    gallery,
    projectId,
    ...(styles && { styles: true }),
  };
}
