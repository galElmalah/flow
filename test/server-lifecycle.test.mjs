import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startServer, stopServer } from "../cli/server.mjs";

import { starter } from "../server/defaults.mjs";

async function seedFixture(url) {
  const response = await fetch(url + "/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(starter),
  });
  assert.equal(response.status, 201);
}

const root = path.resolve(import.meta.dirname, "..");
async function temporary(t) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "flow-server-"));
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${reservation.address().port}`;
  await new Promise((resolve) => reservation.close(resolve));
  const config = { root, dataRoot, url };
  t.after(async () => {
    await stopServer({ ...config, force: true }).catch(() => {});
    await rm(dataRoot, { recursive: true, force: true });
  });
  return config;
}
test("background server starts, survives its launcher, reuses its identity, and stops idempotently", async (t) => {
  const config = await temporary(t);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [path.join(root, "cli/flow.mjs"), "serve", "--url", config.url, "--json"],
    {
      cwd: root,
      env: {
        ...process.env,
        FLOW_DATA_DIR: config.dataRoot,
        FLOW_CODEX_BIN: path.join(config.dataRoot, "no-codex-installed"),
      },
    },
  );
  const first = JSON.parse(stdout);
  assert.equal(first.ready, true);
  assert.equal(first.alreadyRunning, false);
  const second = await startServer(config);
  for (const section of [
    "workspace",
    "harnesses",
    "connections",
    "image-tools",
  ]) {
    const page = await fetch(`${config.url}/settings/${section}`, {
      headers: { accept: "text/html" },
    });
    assert.equal(page.status, 200, `direct settings link: ${section}`);
    assert.match(await page.text(), /<div id="root">/);
  }
  assert.equal(second.alreadyRunning, true);
  assert.equal(second.instanceId, first.instanceId);
  assert.equal(second.pid, first.pid);
  assert.equal((await stopServer(config)).stopped, true);
  assert.equal((await stopServer(config)).alreadyStopped, true);
});
test("lifecycle commands refuse another workspace and an unrelated HTTP service", async (t) => {
  const config = await temporary(t);
  const service = http.createServer((req, res) =>
    res.end(
      JSON.stringify({ application: "some-other-app", pid: process.pid }),
    ),
  );
  await new Promise((resolve) =>
    service.listen(Number(new URL(config.url).port), "127.0.0.1", resolve),
  );
  t.after(() => new Promise((resolve) => service.close(resolve)));
  await assert.rejects(startServer(config), /unrecognized app/);
  await assert.rejects(stopServer(config), /unrecognized app/);
  assert.equal((await fetch(config.url)).status, 200);
  service.removeAllListeners("request");
  service.on("request", (req, res) =>
    res.end(
      JSON.stringify({
        application: "flow",
        root: "/another/workspace",
        dataDirectory: config.dataRoot,
      }),
    ),
  );
  await assert.rejects(stopServer(config), /different Flow workspace/);
});

test("an agent discovers, forks, edits, plans, generates locally, waits and restores its run through the real CLI/API", async (t) => {
  const config = await temporary(t);
  await startServer(config);
  await seedFixture(config.url);
  const invoke = async (...args) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [path.join(root, "cli/flow.mjs"), ...args, "--url", config.url, "--json"],
      { cwd: root },
    );
    return JSON.parse(stdout);
  };
  const guide = await invoke("guide");
  assert.equal(guide.storage.engine, "sqlite");
  assert.match(
    await (await fetch(config.url + guide.guide.endpoint)).text(),
    /docs\/agents\.md/,
  );
  assert.equal((await invoke("schema")).type, "object");
  const original = await invoke("workflow", "paper-studies");
  const fork = await invoke("fork", original.id, "--name", "Agent local trial");
  assert.notEqual(fork.id, original.id);
  assert.equal(fork.forkedFrom.workflowId, original.id);
  assert.equal(
    (await invoke("runs")).some((r) => r.workflowId === fork.id),
    false,
  );
  fork.nodes.find((n) => n.type === "prompt").data.text =
    "Agent changes only its own fork";
  const file = path.join(config.dataRoot, "agent-workflow.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, JSON.stringify(fork));
  const saved = await invoke("import", "--from", file);
  assert.deepEqual(saved.forkedFrom, fork.forkedFrom);
  assert.deepEqual(await invoke("workflow", original.id), original);
  const plan = await invoke(
    "plan",
    "--workflow",
    fork.id,
    "--provider",
    "local-color",
    "--model",
    "color-study",
    "--count",
    "1",
  );
  assert.equal(plan.imageJobs, 4);
  assert.equal((await invoke("runs")).length, 0);
  const started = await invoke(
    "run",
    "--workflow",
    fork.id,
    "--provider",
    "local-color",
    "--model",
    "color-study",
    "--count",
    "1",
    "--concurrency",
    "2",
  );
  const finished = await invoke("wait", started.runId, "--timeout", "15");
  assert.equal(finished.status, "completed");
  assert.equal(finished.jobs.length, plan.total);
  assert.ok(finished.jobs.every((j) => j.output));
  assert.equal((await fetch(config.url + finished.jobs[0].output)).status, 200);
  const waited = await invoke(
    "run",
    "--workflow",
    fork.id,
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
  assert.equal(
    waited.status,
    "completed",
    "--wait --json returns one JSON document",
  );
  const draft = structuredClone(fork);
  draft.name = "Unsaved canvas title";
  draft.nodes.find((n) => n.type === "prompt").data.text =
    "Unsaved canvas prompt";
  const snapshotResponse = await fetch(
    `${config.url}/api/workflows/${fork.id}/fork`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: draft }),
    },
  );
  assert.equal(snapshotResponse.status, 201);
  const snapshot = await snapshotResponse.json();
  assert.equal(
    snapshot.nodes.find((n) => n.type === "prompt").data.text,
    "Unsaved canvas prompt",
  );
  assert.equal((await invoke("workflow", fork.id)).name, fork.name);
  await stopServer(config);
  await startServer(config);
  assert.deepEqual(await invoke("inspect", finished.id), finished);
  assert.equal(
    (await invoke("workflow", fork.id)).forkedFrom.workflowId,
    original.id,
  );
});

test("project agents discover context, create owned workflows, fork across projects, and preserve ownership after restart", async (t) => {
  const config = await temporary(t);
  await startServer(config);
  await seedFixture(config.url);
  const { mkdir, readFile, writeFile, realpath } =
    await import("node:fs/promises");
  const projectRoot = path.join(config.dataRoot, "quote-app");
  const nested = path.join(projectRoot, "artwork", "drafts");
  const otherRoot = path.join(config.dataRoot, "another-app");
  await mkdir(nested, { recursive: true });
  await mkdir(otherRoot);
  const invokeAt = async (cwd, ...args) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [path.join(root, "cli/flow.mjs"), ...args, "--json"],
      {
        cwd,
        env: { ...process.env, FLOW_URL: config.url },
      },
    );
    return JSON.parse(stdout);
  };
  const init = await invokeAt(
    root,
    "project",
    "init",
    "--root",
    projectRoot,
    "--project",
    "quote-app",
    "--name",
    "Quote app",
    "--workflow",
    "paper-studies",
  );
  assert.equal(init.project.id, "quote-app");
  assert.equal(init.project.root, await realpath(projectRoot));
  const manifest = JSON.parse(
    await readFile(path.join(projectRoot, "flow.project.json"), "utf8"),
  );
  assert.deepEqual(manifest, {
    version: 1,
    projectId: "quote-app",
    serverUrl: config.url,
    defaultWorkflowId: "paper-studies",
  });
  assert.match(await readFile(path.join(projectRoot, ".gitignore"), "utf8"), /^flow\.project\.json$/m);
  assert.equal((await invokeAt(nested, "project", "inspect")).id, "quote-app");
  const contextual = await promisify(execFile)(
    process.execPath,
    [path.join(root, "cli/flow.mjs"), "project", "inspect", "--json"],
    { cwd: nested, env: { ...process.env, FLOW_URL: "" } },
  );
  assert.equal(
    JSON.parse(contextual.stdout).id,
    "quote-app",
    "nearest ancestor manifest supplies server URL without environment or URL flags",
  );
  assert.equal(
    (await invokeAt(nested, "project", "register")).project.id,
    "quote-app",
  );
  assert.equal(
    (
      await invokeAt(
        nested,
        "plan",
        "--provider",
        "local-color",
        "--model",
        "color-study",
        "--count",
        "1",
      )
    ).imageJobs,
    4,
  );
  assert.equal(
    (
      await invokeAt(
        root,
        "plan",
        "--project",
        "quote-app",
        "--provider",
        "local-color",
        "--model",
        "color-study",
        "--count",
        "1",
      )
    ).imageJobs,
    4,
    "explicit project resolves its registered default without a cwd manifest",
  );
  const records = path.join(projectRoot, "records.json");
  await writeFile(
    records,
    JSON.stringify([
      { id: "first", topic: "quiet academy" },
      { id: "second", topic: "open courtyard" },
    ]),
  );
  const created = await invokeAt(
    nested,
    "workflow",
    "create",
    "--id",
    "quote-scenes",
    "--name",
    "Quote scenes",
    "--prompt",
    "A restrained engraving",
    "--seed-image",
    path.join(root, "public/assets/paper-seed.png"),
    "--records",
    records,
    "--provider",
    "local-color",
    "--model",
    "color-study",
    "--count",
    "1",
  );
  assert.equal(created.projectId, "quote-app");
  const changedDefault = await fetch(config.url + "/api/projects/quote-app", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ defaultWorkflowId: created.id }),
  });
  assert.equal(changedDefault.status, 200);
  assert.equal(
    (await invokeAt(nested, "plan")).imageJobs,
    2,
    "registered default supersedes a stale manifest default",
  );
  await invokeAt(nested, "project", "register");
  assert.equal(
    (await invokeAt(nested, "project", "inspect")).defaultWorkflowId,
    created.id,
    "registration preserves the current server default",
  );
  const copiedRoot = path.join(config.dataRoot, "copied-app");
  await mkdir(copiedRoot);
  await writeFile(
    path.join(copiedRoot, "flow.project.json"),
    JSON.stringify(manifest),
  );
  await assert.rejects(
    invokeAt(copiedRoot, "plan"),
    /manifest.*correct root|registered at/i,
  );
  assert.equal(
    (await invokeAt(copiedRoot, "plan", "--project", "quote-app")).imageJobs,
    2,
    "explicit project permits intentional cross-directory work",
  );
  assert.equal(
    created.nodes.find((n) => n.type === "dataset").data.records.length,
    2,
  );
  assert.equal(
    (await invokeAt(nested, "runs")).length,
    0,
    "workflow create does not start generation",
  );
  await assert.rejects(
    invokeAt(
      nested,
      "workflow",
      "create",
      "--id",
      created.id,
      "--prompt",
      "Already exists",
    ),
    /already exists/i,
  );
  const planned = await invokeAt(nested, "plan", "--workflow", created.id);
  assert.equal(planned.imageJobs, 2);
  const finished = await invokeAt(
    nested,
    "run",
    "--workflow",
    created.id,
    "--wait",
    "--timeout",
    "15",
  );
  assert.equal(finished.status, "completed");
  assert.equal(finished.projectId, "quote-app");
  assert.equal(finished.graph.projectId, "quote-app");
  assert.equal((await fetch(config.url + finished.jobs[0].output)).status, 200);
  const inherited = await invokeAt(
    nested,
    "fork",
    created.id,
    "--name",
    "Quote follow-up",
  );
  assert.equal(inherited.projectId, "quote-app");
  await invokeAt(
    root,
    "project",
    "init",
    "--root",
    otherRoot,
    "--project",
    "other-app",
  );
  await assert.rejects(
    invokeAt(otherRoot, "workflow", created.id),
    /ownership|belongs to/,
  );
  const ownedExport = path.join(projectRoot, "owned-flow.json");
  await writeFile(ownedExport, JSON.stringify(created));
  await assert.rejects(
    invokeAt(otherRoot, "import", "--from", ownedExport),
    /ownership|belongs to/,
  );
  await assert.rejects(
    invokeAt(otherRoot, "workflow", "create", "--from", ownedExport),
    /ownership|belongs to/,
  );
  await assert.rejects(
    invokeAt(otherRoot, "plan", "--workflow", created.id),
    /ownership|belongs to/,
  );
  const mismatch = await fetch(config.url + "/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowId: created.id, projectId: "other-app" }),
  });
  assert.equal(
    mismatch.status,
    409,
    "HTTP callers cannot bypass ownership checks",
  );
  const movedFork = await invokeAt(
    nested,
    "fork",
    created.id,
    "--project",
    "other-app",
  );
  assert.equal(
    movedFork.projectId,
    "other-app",
    "explicit fork project selects the destination",
  );
  assert.ok(
    (await invokeAt(otherRoot, "workflows")).every(
      (g) => g.projectId === "other-app",
    ),
  );
  assert.equal((await invokeAt(otherRoot, "runs")).length, 0);
  await assert.rejects(
    invokeAt(otherRoot, "resume", finished.id),
    /ownership|belongs to/,
  );
  await assert.rejects(
    invokeAt(otherRoot, "wait", finished.id),
    /ownership|belongs to/,
  );
  await assert.rejects(
    invokeAt(otherRoot, "inspect", finished.id),
    /ownership|belongs to/,
  );
  assert.equal(
    (await invokeAt(nested, "inspect", finished.id)).status,
    "completed",
    "wrong-project control never changes the saved run",
  );
  await stopServer(config);
  await startServer(config);
  assert.equal(
    (await invokeAt(nested, "project", "inspect")).defaultWorkflowId,
    created.id,
  );
  assert.equal(
    (await invokeAt(nested, "inspect", finished.id)).projectId,
    "quote-app",
  );
  assert.equal(
    (await invokeAt(nested, "workflow", created.id)).projectId,
    "quote-app",
  );
});

test("verified shutdown tolerates a slow health response while resources drain", async (t) => {
  const config = await temporary(t);
  const script = `
    const http = require('node:http');
    const config = JSON.parse(process.argv[1]);
    const info = { application: 'flow', root: config.root,
      dataDirectory: config.dataRoot, pid: process.pid,
      instanceId: 'slow-shutdown-fixture', activeJobs: 0 };
    let stopping = false;
    const server = http.createServer((req, res) => {
      const respond = () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(info));
      };
      if (stopping) setTimeout(respond, 1800);
      else respond();
    });
    server.listen(Number(new URL(config.url).port), '127.0.0.1', () => console.log('ready'));
    process.on('SIGTERM', () => {
      stopping = true;
      setTimeout(() => server.close(() => process.exit(0)), 2300);
    });
  `;
  const child = execFile(process.execPath, ["-e", script, JSON.stringify(config)]);
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", resolve);
    child.once("exit", (code) => { if (code) reject(new Error(`Fixture exited ${code}`)); });
  });
  await writeFile(path.join(config.dataRoot, "server.json"), JSON.stringify({
    pid: child.pid, instanceId: "slow-shutdown-fixture",
  }));
  assert.equal((await stopServer(config)).stopped, true);
});
