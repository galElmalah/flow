import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { FlowClient } from "../client/index.mjs";
import { toFlowFile, fromFlowFile } from "../shared/flow-file.mjs";
import { createLocalDemo } from "../cli/demo.mjs";

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(tmpdir(), "flow-clone-check-"));
const dataRoot = path.join(temporary, "data"),
  verificationHome = path.join(temporary, "home");
const blocked = path.join(temporary, "network-attempts.log");
let server, exited, mcp;
const checks = [];
try {
  await readFile(path.join(root, "dist", "index.html")).catch(() => {
    throw new Error(
      "Build the UI first: npm run setup (or npm run build), then npm run verify:setup.",
    );
  });
  const guard = path.join(temporary, "local-only.mjs");
  await mkdir(verificationHome, { mode: 0o700 });
  await writeFile(
    guard,
    `import {appendFileSync} from 'node:fs';
import {homedir} from 'node:os';
const expectedHome = ${JSON.stringify(verificationHome)};
if ([process.env.HOME, process.env.USERPROFILE, homedir()].some(value => value !== expectedHome))
  throw new Error('Clone verification requires its temporary home.');
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){
    appendFileSync(${JSON.stringify(blocked)},'blocked\\n');
    throw new Error('Clone verification blocks external network requests.');
  }
  return originalFetch(input,options);
};`,
  );
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  // Only OS process necessities are inherited; no API keys or selected workspace.
  const env = Object.fromEntries(
    ["PATH", "SystemRoot", "WINDIR", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, {
    HOME: verificationHome,
    USERPROFILE: verificationHome,
    PORT: String(port),
    FLOW_URL: url,
    FLOW_DATA_DIR: dataRoot,
    NODE_OPTIONS: `--import=${pathToFileURL(guard).href}`,
  });
  for (const name of ["CODEX", "CLAUDE", "GEMINI", "PI"])
    env[`FLOW_${name}_BIN`] = path.join(
      temporary,
      `no-${name.toLowerCase()}-installed`,
    );
  let log = "";
  server = spawn(
    process.execPath,
    [path.join(root, "server/index.mjs"), "--production"],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  exited = new Promise((resolve) => server.once("close", resolve));
  server.once("error", (error) => {
    log += error.message;
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      log = (log + chunk.toString()).slice(-6000);
    });
  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline && server.exitCode === null) {
    const health = await fetch(`${url}/api/server`, {
      signal: AbortSignal.timeout(1000),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (health?.ready) {
      assert.equal(health.dataDirectory, dataRoot);
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Fresh server failed to start. ${log}`);
  checks.push("empty-workspace server");
  const client = new FlowClient({ url, projectId: "flow-demo" });
  assert.equal((await new FlowClient({ url }).workflows()).length, 0);
  const demo = await createLocalDemo({ url, dataRoot });
  assert.equal(demo.status, "completed");
  assert.equal(demo.outputs.length, 4);
  for (const output of demo.outputs) {
    const response = await fetch(url + output.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /image\/png/);
    assert.ok((await response.arrayBuffer()).byteLength > 64);
    const lineage = await client.assetLineage(output.assetId);
    assert.equal(lineage.asset.provenance.requested.providerId, "local-color");
    assert.ok(lineage.asset.provenance.prompt);
    assert.ok(lineage.asset.parents.length);
  }
  checks.push("four local outputs and saved lineage");
  const edited = await client.workflow(demo.workflowId);
  edited.nodes.find((node) => node.id === "prompt").data.text =
    "Keep my edited demo direction.";
  await client.saveWorkflow(edited);
  const reopened = await createLocalDemo({ url, dataRoot });
  assert.equal(reopened.runId, demo.runId);
  assert.equal(reopened.reused, true);
  assert.equal((await client.runs()).length, 1);
  const graph = await client.workflow(demo.workflowId);
  assert.equal(
    graph.nodes.find((node) => node.id === "prompt").data.text,
    "Keep my edited demo direction.",
  );
  checks.push("idempotent demo; saved edits preserved; no duplicate run");
  const exported = toFlowFile(graph);
  assert.equal(exported.format, "flow");
  assert.equal((await client.plan(fromFlowFile(exported))).total, 4);
  const page = await fetch(demo.url, { headers: { Accept: "text/html" } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root">/);
  checks.push("Flow file round trip and viewer deep link");
  const binDir = path.join(verificationHome, ".local", "bin");
  const commandOptions = {
    cwd: path.join(dataRoot, "demo-project"),
    env: { ...env, PATH: [binDir, env.PATH].join(path.delimiter) },
    timeout: 15000,
  };
  for (let i = 0; i < 2; i++) {
    const setup = await execute(
      process.execPath, [path.join(root, "tools/setup.mjs")], commandOptions,
    );
    const { cli, skills } = JSON.parse(setup.stdout);
    assert.equal(cli.command, path.join(binDir, "flow"));
    assert.equal(cli.alreadyInstalled, i > 0);
    assert.equal(skills.ready, true);
  }
  const version = await execute("flow", ["--version", "--json"], commandOptions);
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(JSON.parse(version.stdout), { name: pkg.name, version: pkg.version });
  const help = await execute("flow", ["--help"], commandOptions);
  assert.match(help.stdout, /flow plan/);
  checks.push("installed flow on PATH from a consuming project");
  const launcher = path.join(
    verificationHome,
    ".agents/skills/flow-workflows/scripts/flow.mjs",
  );
  const listing = await execute(
    process.execPath,
    [launcher, "projects", "--json"],
    commandOptions,
  );
  assert.ok(
    JSON.parse(listing.stdout).some((project) => project.id === "flow-demo"),
  );
  checks.push("isolated user skills and consuming-project discovery");
  mcp = new Client({ name: "flow-clone-verification", version: "1.0.0" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "mcp/server.mjs")],
      cwd: root,
      env: { ...env, FLOW_PROJECT: "flow-demo" },
      stderr: "pipe",
    }),
  );
  assert.ok(
    (await mcp.listTools()).tools.some((tool) => tool.name === "run_workflow"),
  );
  const discovered = await mcp.callTool({ name: "discover", arguments: {} });
  assert.notEqual(discovered.isError, true);
  assert.equal(discovered.structuredContent.data.projectId, "flow-demo");
  checks.push(
    "real stdio MCP discovery",
    "temporary home for server, launchers and MCP",
  );
  const search = await client.request("/api/search/status");
  assert.equal(search.state, "setup-required");
  const attempts = await readFile(blocked, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  assert.equal(attempts, "");
  checks.push("no credentials, external fetches or model downloads");
  console.log(
    JSON.stringify({ ok: true, checks, outputs: demo.outputs.length }, null, 2),
  );
} catch (error) {
  console.error(`Setup verification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mcp?.close().catch(() => {});
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    let timer;
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          server.kill("SIGKILL");
          resolve();
        }, 7000);
      }),
    ]);
    clearTimeout(timer);
    await exited;
  }
  await rm(temporary, { recursive: true, force: true });
}
