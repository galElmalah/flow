import { viewerParams } from "../shared/viewer-routes.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { FlowClient } from "../client/index.mjs";
import { resolveViewer } from "../client/viewer.mjs";
import { openViewer, viewerOpener } from "../cli/viewer.mjs";
import { stopServer } from "../cli/server.mjs";

import { starter } from "./fixtures/paper-workflow.mjs";

const root = path.resolve(import.meta.dirname, "..");
const exec = promisify(execFile);

test("viewer links encode targets, use current project defaults, and validate run snapshot nodes", async () => {
  const workflow = { id: "a b&c", projectId: "quotes", nodes: [{ id: "new" }] };
  const client = {
    url: "http://localhost:4310",
    projectId: "quotes",
    project: async () => ({ defaultWorkflowId: workflow.id }),
    workflow: async () => workflow,
    inspect: async () => ({
      id: "run/#1",
      workflowId: workflow.id,
      projectId: "quotes",
      graph: { nodes: [{ id: "prompt / #" }] },
    }),
  };
  assert.equal((await resolveViewer(client)).workflowId, workflow.id);
  const receipt = await resolveViewer(client, {
    runId: "run/#1",
    nodeId: "prompt / #",
    gallery: true,
  });
  assert.equal(new URL(receipt.url).search, "");
  assert.equal(
    new URL(receipt.url).pathname,
    "/project/quotes/workflow/a%20b%26c/run/run%2F%231/gallery/node/prompt%20%2F%20%23",
  );
  const query = viewerParams(new URL(receipt.url));
  assert.equal(query.get("workflow"), "a b&c");
  assert.equal(query.get("node"), "prompt / #");
  assert.equal(query.get("run"), "run/#1");
  assert.equal(query.get("gallery"), "1");
  assert.equal(query.get("project"), "quotes");
  const library = await resolveViewer(client, { styles: true });
  assert.equal(viewerParams(new URL(library.url)).get("view"), "styles");
  assert.equal(viewerParams(new URL(library.url)).get("project"), "quotes");
  await assert.rejects(
    resolveViewer(client, { styles: true, gallery: true }),
    /Choose/,
  );
  await assert.rejects(
    resolveViewer(client, { runId: "run/#1", workflowId: "different" }),
    /belongs to workflow/,
  );
  await assert.rejects(
    resolveViewer(client, { nodeId: "missing" }),
    /does not exist/,
  );
  await assert.rejects(
    resolveViewer({
      ...client,
      workflow: async () => ({ ...workflow, projectId: "another" }),
    }),
    /belongs to/,
  );
  await assert.rejects(
    resolveViewer({ ...client, url: "https://example.com" }),
    /localhost/,
  );
  await assert.rejects(
    resolveViewer({ ...client, url: "http://secret@localhost:4310" }),
    /localhost/,
  );
  assert.equal(
    (await new FlowClient({ url: "http://localhost:4310" }).viewer()).url,
    "http://localhost:4310/projects",
  );
});

test("viewer opener passes a URL as one argument without a shell and reports launch failures", async () => {
  const url = "http://localhost:4310/?workflow=a%26b&node=%24%28touch%29";
  const calls = [];
  const launch = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  };
  assert.equal(
    (await openViewer({ url }, { platform: "darwin", spawn: launch })).opened,
    true,
  );
  assert.deepEqual(calls[0], [
    "open",
    [url],
    { stdio: "ignore", shell: false, windowsHide: true },
  ]);
  assert.deepEqual(viewerOpener("linux", url), ["xdg-open", [url]]);
  assert.deepEqual(viewerOpener("win32", url), [
    "rundll32.exe",
    ["url.dll,FileProtocolHandler", url],
  ]);
  await assert.rejects(
    openViewer({ url }, { platform: "unsupported", spawn: launch }),
    /print-url/,
  );
  await assert.rejects(
    openViewer(
      { url },
      {
        platform: "linux",
        spawn: () => {
          const child = new EventEmitter();
          queueMicrotask(() =>
            child.emit("error", new Error("missing opener")),
          );
          return child;
        },
      },
    ),
    /missing opener/,
  );
});

test("exposed open CLI starts one installation server, resolves a consuming project, and rejects invalid targets", async (t) => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "flow-viewer-"));
  const projectRoot = path.join(dataRoot, "project");
  await mkdir(projectRoot);
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${reservation.address().port}`;
  await new Promise((resolve) => reservation.close(resolve));
  t.after(async () => {
    await stopServer({ root, dataRoot, url, force: true }).catch(() => {});
    await rm(dataRoot, { recursive: true, force: true });
  });
  const invoke = async (cwd, ...args) => {
    const { stdout } = await exec(
      process.execPath,
      [path.join(root, "cli/flow.mjs"), ...args, "--json"],
      {
        cwd,
        env: {
          ...process.env,
          FLOW_URL: url,
          FLOW_DATA_DIR: dataRoot,
          FLOW_CODEX_BIN: path.join(dataRoot, "no-codex"),
        },
      },
    );
    return JSON.parse(stdout);
  };
  const first = await invoke(root, "open", "--print-url");
  assert.equal(first.opened, false);
  assert.equal(first.url, url + "/projects");
  assert.equal(first.server.alreadyRunning, false);
  assert.deepEqual(await (await fetch(url + "/api/workflows")).json(), []);
  await fetch(url + "/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(starter),
  });
  await invoke(
    root,
    "project",
    "init",
    "--root",
    projectRoot,
    "--project",
    "viewer-app",
    "--workflow",
    "paper-studies",
  );
  const contextual = await invoke(projectRoot, "open", "--print-url");
  assert.equal(contextual.server.pid, first.server.pid);
  assert.equal(contextual.server.alreadyRunning, true);
  assert.equal(contextual.workflowId, "paper-studies");
  assert.equal(contextual.projectId, "viewer-app");
  assert.equal(
    await stat(path.join(projectRoot, ".flow")).catch(() => null),
    null,
  );
  const workflow = await invoke(projectRoot, "workflow", "paper-studies");
  const nodeId = workflow.nodes[0].id;
  const node = await invoke(
    projectRoot,
    "open",
    workflow.id,
    "--node",
    nodeId,
    "--gallery",
    "--print-url",
  );
  assert.equal(new URL(node.url).search, "");
  assert.match(
    new URL(node.url).pathname,
    /^\/project\/viewer-app\/workflow\/paper-studies\/gallery\/node\//,
  );
  const openedPage = await fetch(node.url);
  assert.equal(openedPage.status, 200);
  assert.match(openedPage.headers.get("content-type"), /text\/html/);
  assert.equal(viewerParams(new URL(node.url)).get("node"), nodeId);
  assert.equal(viewerParams(new URL(node.url)).get("gallery"), "1");
  await assert.rejects(
    invoke(projectRoot, "open", "missing-flow", "--print-url"),
    /not found/i,
  );
  const foreign = await invoke(
    root,
    "workflow",
    "create",
    "--id",
    "foreign-flow",
    "--prompt",
    "Foreign project",
  );
  await assert.rejects(
    invoke(projectRoot, "open", foreign.id, "--print-url"),
    /belongs to|ownership/,
  );
  await assert.rejects(
    invoke(projectRoot, "open", "--node", "missing-node", "--print-url"),
    /does not exist/,
  );
  const fork = await invoke(projectRoot, "fork", workflow.id);
  await new FlowClient({ url, projectId: "viewer-app" }).updateProject(
    "viewer-app",
    { defaultWorkflowId: fork.id },
  );
  assert.equal(
    (await invoke(projectRoot, "open", "--print-url")).workflowId,
    fork.id,
    "server default supersedes stale manifest default",
  );
  const run = await invoke(
    projectRoot,
    "run",
    "--workflow",
    workflow.id,
    "--provider",
    "local-color",
    "--model",
    "color-study",
    "--count",
    "1",
    "--wait",
    "--timeout",
    "15",
  );
  const runTarget = await invoke(
    projectRoot,
    "open",
    "--run",
    run.id,
    "--gallery",
    "--print-url",
  );
  assert.equal(runTarget.workflowId, workflow.id);
  assert.equal(runTarget.runId, run.id);
  await assert.rejects(
    invoke(projectRoot, "open", fork.id, "--run", run.id, "--print-url"),
    /belongs to workflow/,
  );
  await assert.rejects(
    invoke(projectRoot, "open", "--run", "missing-run", "--print-url"),
    /not found/i,
  );
  const help = await exec(
    process.execPath,
    [path.join(root, "cli/flow.mjs"), "help"],
    { cwd: root },
  );
  assert.match(help.stdout, /flow open/);
});
