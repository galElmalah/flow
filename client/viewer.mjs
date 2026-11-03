import { viewerPath } from "../shared/viewer-routes.mjs";
/** Viewer links only ever target the local Flow installation. */
export function localViewerUrl(address) {
  const url = new URL(address);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Viewer commands require an HTTP localhost URL with no path.",
    );
  return url;
}

export async function resolveViewer(
  client,
  {
    workflowId,
    editorId,
    nodeId,
    runId,
    gallery = false,
    styles = false,
    projects = false,
  } = {},
) {
  if (gallery && styles)
    throw new Error("Choose the image gallery or style library.");
  const url = localViewerUrl(client.url);
  const project = client.projectId ? await client.project() : null;
  if (editorId) {
    if (workflowId || nodeId || runId || gallery || styles || projects)
      throw new Error("Choose an image editor or another viewer target.");
    const editor = await client.imageEditor(editorId);
    const target = { view: "projects", editor: editor.id };
    const editorProjectId = editor.projectId || editor.source.projectId;
    if (editorProjectId) target.project = editorProjectId;
    url.pathname = viewerPath(target);
    return {
      url: url.href,
      editorId: editor.id,
      projectId: editorProjectId,
    };
  }
  if (projects) {
    if (workflowId || nodeId || runId || gallery || styles)
      throw new Error(
        "Projects view cannot also target a workflow, run or gallery.",
      );
    url.pathname = viewerPath({ view: "projects", project: client.projectId });
    return { url: url.href, projectId: client.projectId, projects: true };
  }
  const run = runId ? await client.inspect(runId) : null;
  if (run && workflowId && workflowId !== run.workflowId)
    throw new Error(
      `Run ${runId} belongs to workflow ${run.workflowId}, not ${workflowId}.`,
    );
  workflowId = run?.workflowId || workflowId || project?.defaultWorkflowId;
  const workflow = workflowId ? await client.workflow(workflowId) : null;
  if (workflow && client.projectId && workflow.projectId !== client.projectId)
    throw new Error(
      `Workflow ${workflowId} belongs to ${workflow.projectId || "the unassigned workspace"}, not project ${client.projectId}.`,
    );
  if (
    run &&
    workflow &&
    (run.projectId ?? null) !== (workflow.projectId ?? null)
  )
    throw new Error(
      `Run ${runId} and workflow ${workflowId} have different project ownership.`,
    );
  if (
    nodeId &&
    !(run?.graph || workflow)?.nodes?.some((node) => node.id === nodeId)
  )
    throw new Error(
      workflowId
        ? `Node ${nodeId} does not exist in workflow ${workflowId}${run ? " for this run" : ""}.`
        : "Choose a workflow before opening a node.",
    );
  const projectId = client.projectId || workflow?.projectId || undefined;
  url.pathname = viewerPath({
    project: projectId,
    workflow: workflowId,
    node: nodeId,
    run: runId,
    gallery,
    view: styles ? "styles" : undefined,
  });
  return {
    url: url.href,
    projectId,
    workflowId,
    nodeId,
    runId,
    gallery,
    styles,
  };
}
