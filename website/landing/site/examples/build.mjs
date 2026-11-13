import { readFile } from "node:fs/promises";
import { FlowClient, fromFlowFile } from "flow";

// Register this project first; put the two files beside build.mjs.
const flow = new FlowClient({
  url: process.env.FLOW_URL || "http://localhost:4310",
  projectId: "salt-speed",
});
const file = JSON.parse(await readFile("./salt-speed.flow.json", "utf8"));
const [seed] = await flow.upload([{
  name: "helmet-seed.png",
  data: await readFile("./helmet-seed.png"),
  type: "image/png",
}]);
const graph = fromFlowFile(file);
graph.nodes.find(node => node.id === "seed").data.images = [seed.url];
const saved = await flow.createWorkflow(graph);
const plan = await flow.plan(saved.id);
console.log({ workflowId: saved.id, plan });

// Review provider readiness and the plan before running:
// const run = await flow.run(saved.id, {}, {
//   requestId: crypto.randomUUID(), concurrency: 4,
// });
// console.log(await flow.wait(run.id, { timeout: 600 }));
