import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const execute = promisify(execFile);
const entry = resolve(import.meta.dirname, "../cli/flow.mjs");
test("CLI help and invalid command inputs have no side effects, including for migrate and run", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "flow-arguments-"));
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(500).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  });
  await writeFile(join(cwd, "flow.project.json"), "{malformed");
  const cli = (...args) =>
    execute(process.execPath, [entry, ...args, "--json"], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: cwd,
        FLOW_URL: `http://127.0.0.1:${server.address().port}`,
      },
    });
  const help = JSON.parse((await cli("help", "plan")).stdout);
  assert.deepEqual(JSON.parse((await cli("plan", "--help")).stdout), help);
  assert.equal(help.effect, "preview");
  assert.equal(help.flags.properties.count.maximum, 500);
  assert.equal(help.flags.properties["seed-image"], undefined);
  assert.equal(
    JSON.parse((await cli("migrate", "--help")).stdout).command,
    "migrate",
  );
  for (const [args, match] of [
    [["runs", "--count", "3"], /--count/],
    [["runs", "--not-a-flag"], /not-a-flag/],
    [["plan", "one", "--workflow", "two"], /must match/],
    [["run", "one", "ignored"], /Expected/],
    [["run", "--seed-image", "missing.png", "--count", "NaN"], /--count/],
    [["run", "--concurrency", "Infinity"], /--concurrency/],
    [
      [
        "workflow",
        "create",
        "--seed-image",
        "missing.png",
        "--seed",
        "Infinity",
      ],
      /--seed/,
    ],
    [["run", "--plan", "--seed-image", "missing.png"], /--seed-image/],
    [["plan", "--from", "missing.json"], /--from/],
    [["plan", "--prompt", "unused"], /--prompt/],
    [["run", "one", "--request-id", "bad id"], /--request-id/],
  ]) {
    await assert.rejects(cli(...args), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      const body = JSON.parse(error.stderr);
      assert.ok(body.error.code);
      assert.match(body.error.message, match);
      return true;
    });
  }
  assert.deepEqual(requests, []);
});

test("stored CLI submissions use explicit IDs, forward replay controls and return the full run", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "flow-cli-submission-"));
  const calls = [];
  const run = {
    id: "real-run",
    workflowId: "wanted",
    jobs: [{ id: "job" }],
    status: "running",
  };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push([req.url, JSON.parse(raw || "null")]);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/api/runs" ? run : {}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  });
  const cli = async (...args) =>
    JSON.parse(
      (
        await execute(process.execPath, [entry, ...args, "--json"], {
          cwd,
          env: {
            HOME: cwd,
            PATH: process.env.PATH,
            FLOW_URL: `http://127.0.0.1:${server.address().port}`,
          },
        })
      ).stdout,
    );
  await cli("plan", "wanted", "--count", "2");
  assert.deepEqual(
    await cli("run", "wanted", "--request-id", "task-1", "--concurrency", "2"),
    run,
  );
  await cli(
    "style",
    "start",
    "paper",
    "--provider",
    "local-color",
    "--model",
    "color-study",
  );
  assert.deepEqual(calls, [
    ["/api/plan", { workflowId: "wanted", options: { count: 2 } }],
    [
      "/api/runs",
      {
        workflowId: "wanted",
        options: {},
        concurrency: 2,
        requestId: "task-1",
      },
    ],
    [
      "/api/styles/paper/workflows",
      { providerId: "local-color", model: "color-study" },
    ],
  ]);
});
