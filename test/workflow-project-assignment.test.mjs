import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowSaver } from "../src/canvas/workflow-saver.mjs";
import { assignWorkflowProject } from "../src/projects/assign-workflow.mjs";
const graph = {
  id: "a",
  name: "Quote artwork",
  projectId: "quoture",
  nodes: [{ id: "prompt", data: { text: "Original" } }],
  edges: [],
};

test("rejected project assignment restores ownership without losing edits or leaving a false draft", async () => {
  let reject,
    current = structuredClone(graph),
    disk;
  const saver = new WorkflowSaver({
    delay: 60000,
    save: (g) => {
      if (g.projectId === "other")
        return new Promise((resolve, fail) => {
          reject = fail;
        });
      disk = g;
    },
  });
  saver.seed(graph);
  const assigning = assignWorkflowProject({
    graph,
    projectId: "other",
    saver,
    setProject: (id, projectId) => {
      if (current.id === id) current = { ...current, projectId };
    },
  });
  const edited = saver.draft("a");
  edited.nodes[0].data.text = "New quote scene";
  saver.stage(edited);
  reject(new Error("Choose another project default before moving"));
  await assert.rejects(assigning, /default/);
  assert.equal(current.projectId, "quoture");
  assert.equal(saver.draft("a").projectId, "quoture");
  assert.equal(saver.draft("a").nodes[0].data.text, "New quote scene");
  assert.equal(disk.projectId, "quoture");
  assert.equal(disk.nodes[0].data.text, "New quote scene");
  assert.equal(saver.status("a"), "saved");
});
test("switching canvases during assignment never puts the first workflow metadata over the next workflow's nodes", async () => {
  let finish,
    current = structuredClone(graph);
  const saver = new WorkflowSaver({
    delay: 60000,
    save: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  saver.seed(graph);
  const assigning = assignWorkflowProject({
    graph,
    projectId: "other",
    saver,
    setProject: (id, projectId) => {
      if (current.id === id) current = { ...current, projectId };
    },
  });
  current = { id: "b", name: "Another canvas", nodes: [{ id: "b-node" }] };
  finish();
  await assigning;
  assert.equal(current.id, "b");
  assert.equal(current.nodes[0].id, "b-node");
  assert.equal(saver.draft("a").projectId, "other");
});
