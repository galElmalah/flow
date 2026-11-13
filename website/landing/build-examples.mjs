// Regenerates the landing page's downloadable workflow and displayed code from this checkout.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createImageWorkflow, toFlowFile } from "../../client/index.mjs";

const output = path.join(import.meta.dirname, "site");
const graph = createImageWorkflow({
  id: "salt-speed-campaign-v1",
  name: "SALT / SPEED",
  projectId: "salt-speed",
  images: ["/files/uploads/helmet-seed.png"],
  prompt: "A fictional salt-flat racing campaign. Orange equipment, silver surfaces, hard sunlight and open horizons. No incidental lettering or logos.",
  prompts: [
    { id: "helmet", label: "The helmet", scene: "An orange racing helmet on a brushed metal block, salt flats stretching to the horizon.", seed: 17 },
    { id: "machine", label: "The machine", scene: "A silver racing machine standing alone on the salt flats, long shadows in hard sunlight." },
    { id: "kit", label: "The kit", scene: "An anonymous racer in orange technical clothing, with the helmet tucked under one arm." },
    { id: "trace", label: "The trace", scene: "Fresh tire tracks sweeping across white salt, an orange vehicle disappearing into the distance." },
  ],
  providerId: "codex", model: "native", count: 1, ratio: "3:4",
});
const file = JSON.stringify(toFlowFile(graph), null, 2) + "\n";
const js = `import { readFile } from "node:fs/promises";
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
`;
const cli = `# In your campaign folder, with Flow installed and running:
flow project init --project salt-speed --name "SALT / SPEED" --root "$PWD" --json

# Install the SDK from your local Flow checkout.
npm install --save /absolute/path/to/flow
# Download the workflow and build.mjs; add helmet-seed.png.
node build.mjs

# Use the workflow ID printed by build.mjs.
flow plan --workflow salt-speed-campaign-v1 --project salt-speed --json
flow export salt-speed-campaign-v1 --project salt-speed --output campaign.flow.json

# After checking provider readiness and the four-image plan:
flow providers --json
flow run --workflow salt-speed-campaign-v1 --project salt-speed --concurrency 4 --request-id BATCH_ID --json
# Keep the returned run ID; do not submit another run to monitor it.
flow wait RUN_ID --project salt-speed --timeout 600 --json`;
await mkdir(path.join(output, "examples"), { recursive: true });
await writeFile(path.join(output, "examples/salt-speed.flow.json"), file);
await writeFile(path.join(output, "examples/build.mjs"), js);
await writeFile(path.join(output, "shared/examples.js"), "window.FLOW_EXAMPLES = " + JSON.stringify({ file: file.trimEnd(), js: js.trimEnd(), cli }) + ";\n");
console.log("Built schema-valid workflow and complete CLI/SDK examples.");
