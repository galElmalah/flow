import { viewerParams } from "../shared/viewer-routes.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { resolveViewerTarget } from "../src/canvas/viewer-target.mjs";

const workflow = {
  id: "studies",
  projectId: "quotes",
  nodes: [{ id: "brief", data: { text: "Current edited prompt" } }],
  edges: [],
};
const otherWorkflow = {
  id: "foreign",
  projectId: "other",
  nodes: [],
  edges: [],
};
const run = {
  id: "run-one",
  workflowId: workflow.id,
  projectId: "quotes",
  graph: {
    id: "snapshot-id",
    projectId: "old-snapshot-owner",
    nodes: [{ id: "old-brief", data: { text: "Original frozen prompt" } }],
    edges: [],
  },
};
const dependencies = {
  workflows: [workflow, otherWorkflow],
  projects: [
    { id: "quotes", defaultWorkflowId: workflow.id },
    { id: "other", defaultWorkflowId: otherWorkflow.id },
    { id: "empty" },
  ],
  fetchRun: async (id) => (id === run.id ? run : null),
};
const resolve = (query, changes) =>
  resolveViewerTarget(new URLSearchParams(query), {
    ...dependencies,
    ...changes,
  });

test("viewer targets resolve current project defaults and decoded node links without mutation", async () => {
  assert.equal(await resolve(""), null);
  assert.equal(await resolve("unrelated=1"), null);
  const resolved = await resolve("project=quotes&node=brief");
  assert.equal(resolved.workflow.id, workflow.id);
  assert.equal(resolved.nodeId, "brief");
  assert.equal(resolved.run, null);
  assert.equal(resolved.gallery, false);
  resolved.workflow.nodes[0].data.text = "Local viewer change";
  assert.equal(workflow.nodes[0].data.text, "Current edited prompt");
  const projectOnly = await resolve("project=empty");
  assert.equal(projectOnly.workflow, null);
  assert.equal(projectOnly.projectId, "empty");
  const library = await resolve("project=quotes&node=brief&view=styles");
  assert.equal(library.styles, true);
  assert.equal(library.nodeId, "brief");
  assert.equal((await resolve("view=styles")).styles, true);
  const encoded = {
    ...workflow,
    id: "flow & /",
    nodes: [{ id: "prompt # /", data: {} }],
  };
  const query = new URLSearchParams({
    workflow: encoded.id,
    node: encoded.nodes[0].id,
    gallery: "1",
  });
  const exact = await resolve(query.toString(), { workflows: [encoded] });
  assert.equal(exact.workflow.id, encoded.id);
  assert.equal(exact.nodeId, encoded.nodes[0].id);
  assert.equal(exact.gallery, true);
  assert.deepEqual(await resolve("gallery=1"), {
    workflow: null,
    run: null,
    nodeId: null,
    gallery: true,
    projectId: null,
  });
});

test("run links select cloned historical prompts and nodes rather than the current saved graph", async () => {
  const selected = await resolve(
    "project=quotes&workflow=studies&run=run-one&node=old-brief&gallery=1",
  );
  assert.equal(selected.workflow.id, run.workflowId);
  assert.equal(selected.workflow.projectId, run.projectId);
  assert.equal(selected.workflow.nodes[0].data.text, "Original frozen prompt");
  assert.equal(selected.run, run);
  assert.equal(selected.gallery, true);
  selected.workflow.nodes[0].data.text = "Viewer mutation";
  assert.equal(run.graph.nodes[0].data.text, "Original frozen prompt");
  assert.equal(workflow.nodes[0].data.text, "Current edited prompt");
  const implicit = await resolve("run=run-one");
  assert.equal(implicit.workflow.id, workflow.id);
  await assert.rejects(resolve("run=run-one&node=brief"), /snapshot/);
  await assert.rejects(resolve("workflow=studies&node=old-brief"), /not found/);
});

test("invalid viewer targets fail explicitly instead of opening a different workflow", async () => {
  for (const [query, message] of [
    ["project=missing", /Project missing/],
    ["project=quotes&workflow=foreign", /does not belong/],
    ["workflow=missing", /Workflow missing/],
    ["node=brief", /Choose a workflow/],
    ["workflow=studies&node=missing", /Node missing/],
    ["run=missing", /Run missing/],
    ["run=run-one&workflow=foreign", /belongs to workflow/],
    ["run=run-one&project=other", /does not belong/],
    ["project=", /must not be empty/],
    ["workflow=studies&gallery=maybe", /gallery must/],
    ["view=unknown", /view must/],
    ["view=styles&gallery=1", /Choose/],
  ])
    await assert.rejects(resolve(query), message);
  await assert.rejects(
    resolve("project=quotes", {
      projects: [{ id: "quotes", defaultWorkflowId: "missing" }],
    }),
    /Workflow missing/,
  );
  await assert.rejects(
    resolve("project=quotes", {
      projects: [{ id: "quotes", defaultWorkflowId: "foreign" }],
    }),
    /does not belong/,
  );
  await assert.rejects(
    resolve("run=run-one", { fetchRun: async () => ({ ...run, graph: null }) }),
    /no valid workflow snapshot/,
  );
  await assert.rejects(
    resolve("run=run-one&workflow=studies", {
      fetchRun: async () => ({ ...run, projectId: "other" }),
    }),
    /different project ownership/,
  );
});

test("resource paths reach the same ownership checks and immutable run snapshot resolver", async () => {
  const current = await resolveViewerTarget(
    viewerParams("/project/quotes/workflow/studies/node/brief"),
    dependencies,
  );
  assert.equal(current.workflow.id, "studies");
  assert.equal(current.nodeId, "brief");
  const recorded = await resolveViewerTarget(
    viewerParams(
      "/project/quotes/workflow/studies/run/run-one/gallery/node/old-brief",
    ),
    dependencies,
  );
  assert.equal(recorded.run.id, "run-one");
  assert.equal(recorded.workflow.nodes[0].data.text, "Original frozen prompt");
  assert.equal(recorded.gallery, true);
  await assert.rejects(
    resolveViewerTarget(
      viewerParams("/project/other/workflow/studies"),
      dependencies,
    ),
    /does not belong/,
  );
  await assert.rejects(
    resolveViewerTarget(
      viewerParams("/workflow/studies/project/quotes"),
      dependencies,
    ),
    /Invalid order/,
  );
});
