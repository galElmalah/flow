import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fromFlowFile } from "../../client/index.mjs";
import { planWorkflow } from "../../server/graph.mjs";
import { parserOptions, validateInvocation } from "../../shared/commands.mjs";

// Checks the landing examples against this checkout. It never submits inference.
const repo = path.resolve(import.meta.dirname, "../..");
const root = path.join(import.meta.dirname, "site");
const source = await readFile(path.join(root, "shared/examples.js"), "utf8");
const examples = JSON.parse(source.slice("window.FLOW_EXAMPLES = ".length).trim().replace(/;$/, ""));
assert.equal(examples.file + "\n", await readFile(path.join(root, "examples/salt-speed.flow.json"), "utf8"));
assert.equal(examples.js + "\n", await readFile(path.join(root, "examples/build.mjs"), "utf8"));
assert.equal(planWorkflow(fromFlowFile(JSON.parse(examples.file))).imageJobs, 4);
for (const line of examples.cli.split("\n").filter(line => line.startsWith("flow "))) {
  const args = line.slice(5).match(/"[^"]*"|\S+/g).map(token => token.replace(/^"|"$/g, ""));
  const parsed = parseArgs({ args, options: parserOptions, allowPositionals: true, tokens: true });
  validateInvocation(parsed.positionals, parsed.values, parsed.tokens);
}
const directory = await mkdtemp(path.join(tmpdir(), "flow-landing-example-"));
const calls = [];
let saved;
const server = createServer(async (req, res) => {
  try {
    const parts = [];
    for await (const part of req) parts.push(part);
    const bytes = Buffer.concat(parts);
    calls.push(req.method + " " + req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/uploads") {
      assert.match(bytes.toString(), /salt-speed/);
      assert.match(bytes.toString(), /filename="helmet-seed.png"/);
      res.end(JSON.stringify([{ url: "/files/uploads/verified-seed.png" }]));
    } else if (req.url === "/api/workflows") {
      saved = fromFlowFile(JSON.parse(bytes));
      assert.equal(saved.projectId, "salt-speed");
      assert.deepEqual(saved.nodes.find(n => n.id === "seed").data.images, ["/files/uploads/verified-seed.png"]);
      res.end(JSON.stringify(saved));
    } else if (req.url === "/api/plan") {
      const request = JSON.parse(bytes);
      assert.equal(request.workflowId, saved.id);
      const plan = planWorkflow(saved, request.options);
      assert.equal(plan.imageJobs, 4);
      assert.ok(plan.jobs.every(job => job.images.some(ref => ref.asset === "/files/uploads/verified-seed.png")));
      res.end(JSON.stringify(plan));
    } else throw new Error("Unexpected request: " + req.url);
  } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
});
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  await mkdir(path.join(directory, "node_modules"));
  await symlink(repo, path.join(directory, "node_modules/flow"));
  await writeFile(path.join(directory, "build.mjs"), examples.js);
  await writeFile(path.join(directory, "salt-speed.flow.json"), examples.file);
  await writeFile(path.join(directory, "helmet-seed.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=", "base64"));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["build.mjs"], { cwd: directory, env: { PATH: process.env.PATH, FLOW_URL: `http://127.0.0.1:${server.address().port}` }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", data => stderr += data);
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  assert.deepEqual(calls, ["POST /api/uploads", "POST /api/workflows", "POST /api/plan"]);
  console.log("Verified: valid Flow file, every CLI invocation, real SDK imports, project-scoped upload, saved graph, four resolved image jobs, no inference submission.");
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
