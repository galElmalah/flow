import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareWorkflow } from "../cli/workflow-input.mjs";

const execute = promisify(execFile);
const entry = resolve(import.meta.dirname, "../cli/flow.mjs");
test("CLI recipe validation retains distinct pending references when choosing a video endpoint", async () => {
  const reference = resolve(
    import.meta.dirname,
    "../public/assets/paper-seed.png",
  );
  const urls = [0, 1, 2].map(
    (index) => `/files/uploads/reference-${index}.png`,
  );
  const graph = await prepareWorkflow(
    {
      async upload(files) {
        assert.equal(files.length, 3);
        return urls.map((url) => ({ url }));
      },
    },
    {
      media: "video",
      provider: "fal-video",
      "seed-image": [reference, reference, reference],
    },
    { create: true },
  );
  const generation = graph.nodes.find((node) => node.type === "video-generate");
  assert.equal(
    generation.data.model,
    "bytedance/seedance-2.5/reference-to-video",
  );
  assert.equal(generation.data.video.mode, "reference");
  assert.deepEqual(
    graph.nodes.find((node) => node.type === "image").data.images,
    urls,
  );
});
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
  assert.deepEqual(
    JSON.parse((await cli("help", "providers", "create")).stdout).flags
      .required,
    ["from"],
  );
  assert.ok(JSON.parse((await cli("agent", "schema")).stdout).properties.page);
  for (const [args, match] of [
    [["run", "--workflow="], /nonempty.*--workflow/],
    [
      ["run", "--workflow", "first", "--workflow", "second"],
      /Conflicting.*--workflow/,
    ],
    [["run", "", "--wait"], /nonempty/],
    [["project", "inspect", "one", "--project", "two"], /must match/],
    [["editor", "inspect", "one", "--editor", "two"], /must match/],
    [["agent", "trace", "session", "one", "--id", "two"], /must match/],
    [
      ["editor", "open", "--seed-image", "a.png", "--seed-image", "b.png"],
      /--seed-image/,
    ],
    [
      ["editor", "open", "--image", "one", "--seed-image", "two"],
      /Choose --image/,
    ],
    [["open", "--styles", "--gallery", "--print-url"], /viewer targets/],
    [
      ["workflow", "create", "--ratio", "wrong", "--seed-image", "a.png"],
      /--ratio/,
    ],
    [
      [
        "workflow",
        "create",
        "--output-format",
        "wrong",
        "--seed-image",
        "a.png",
      ],
      /--output-format/,
    ],
    [["workflow", "create", "--node", "unused"], /--node/],
    [["workflow", "create", "--prompt-set", "unused"], /--prompt-set/],
    [["workflow", "create", "--prompt-model", "unused"], /--prompt-provider/],
    [
      ["local", "pull", "ollama", "--model", "one", "--from", "two.json"],
      /--from or --model/,
    ],
    [["import", "--project", "one"], /Provide --from/],
    [["providers", "configure-grok", "--project", "one"], /Provide --from/],
    [
      ["status", "--url", "http://localhost:4310", "--port", "4311"],
      /same port/,
    ],
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

test("JSON waits keep the recorded run and job failures and identify a submitted run after a polling error", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "flow-cli-wait-"));
  const failed = {
    id: "original",
    status: "failed",
    jobs: [{ status: "failed", error: "generation failed" }],
  };
  let failPoll = false;
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST")
      res.end(JSON.stringify({ id: "original", status: "running" }));
    else if (failPoll)
      res.writeHead(503).end(
        JSON.stringify({
          error: "storage unavailable",
          code: "STORAGE_UNAVAILABLE",
        }),
      );
    else res.end(JSON.stringify(failed));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  });
  const invoke = (...args) =>
    execute(
      process.execPath,
      [entry, ...args, "--port", String(server.address().port), "--json"],
      {
        cwd,
        env: {
          HOME: cwd,
          PATH: process.env.PATH,
          FLOW_URL: "http://127.0.0.1:1",
        },
      },
    );
  await assert.rejects(invoke("wait", "original"), (failure) => {
    assert.equal(failure.stdout, "");
    const { error } = JSON.parse(failure.stderr);
    assert.equal(error.code, "RUN_FAILED");
    assert.equal(error.runId, "original");
    assert.deepEqual(error.run, failed);
    return true;
  });
  failPoll = true;
  await assert.rejects(invoke("run", "saved", "--wait"), (failure) => {
    assert.equal(failure.stdout, "");
    assert.deepEqual(JSON.parse(failure.stderr).error, {
      code: "STORAGE_UNAVAILABLE",
      status: 503,
      message: "storage unavailable",
      runId: "original",
    });
    return true;
  });
});

test("invalid local recipes and editor or style inputs do not upload assets", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "flow-cli-recipes-"));
  const calls = [];
  const server = createServer((req, res) => {
    calls.push(req.url);
    res.writeHead(500).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  });
  const graph = {
    id: "example",
    name: "Graph",
    edges: [],
    nodes: [
      {
        id: "generate",
        type: "generate",
        position: { x: 0, y: 0 },
        data: { label: "Generate" },
      },
    ],
  };
  await writeFile(join(cwd, "graph.json"), JSON.stringify(graph));
  await writeFile(
    join(cwd, "editor.json"),
    JSON.stringify({ source: "/assets/other.png" }),
  );
  await writeFile(join(cwd, "empty.json"), "{}");
  const cli = (...args) =>
    execute(
      process.execPath,
      [
        entry,
        ...args,
        "--seed-image",
        resolve(import.meta.dirname, "../public/assets/paper-seed.png"),
        "--json",
      ],
      {
        cwd,
        env: {
          HOME: cwd,
          PATH: process.env.PATH,
          FLOW_URL: `http://127.0.0.1:${server.address().port}`,
        },
      },
    );
  for (const [args, match] of [
    [["workflow", "create", "--from", "missing.json"], /ENOENT/],
    [
      ["workflow", "create", "--from", "graph.json", "--prompt", "absent node"],
      /no prompt node/,
    ],
    [
      [
        "workflow",
        "create",
        "--from",
        "graph.json",
        "--media",
        "video",
        "--duration",
        "4",
      ],
      /no video generation/,
    ],
    [["workflow", "create", "--frames", "4"], /gif/],
    [
      ["run", "--prompt", "a scene", "--duration", "3"],
      /require a video workflow/,
    ],
    [["style", "create", "--from", "empty.json"], /name/],
    [["editor", "open", "--from", "editor.json"], /Choose one editor source/],
  ]) {
    await assert.rejects(cli(...args), (e) => {
      assert.match(JSON.parse(e.stderr).error.message, match);
      return true;
    });
  }
  assert.deepEqual(calls, []);
});

test("project commands use the selected manifest, check its registered root and preflight explicit default workflows", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "flow-cli-manifest-"));
  const alpha = join(tmp, "alpha"),
    beta = join(tmp, "beta"),
    copy = join(tmp, "copied");
  await Promise.all([alpha, beta, copy].map((dir) => mkdir(dir)));
  const calls = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "null");
    calls.push([req.method, req.url, body]);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/projects/alpha")
      res.end(JSON.stringify({ id: "alpha", root: alpha }));
    else if (req.url === "/api/projects" && req.method === "POST")
      res.end(JSON.stringify(body));
    else
      res.writeHead(404).end(JSON.stringify({ error: "Workflow not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(tmp, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const [dir, projectId] of [
    [alpha, "alpha"],
    [copy, "alpha"],
    [beta, "beta"],
  ])
    await writeFile(
      join(dir, "flow.project.json"),
      JSON.stringify({ version: 1, projectId, serverUrl: url }),
    );
  const cli = (cwd, ...args) =>
    execute(process.execPath, [entry, ...args, "--json"], {
      cwd,
      env: { HOME: tmp, PATH: process.env.PATH, FLOW_URL: url },
    });
  for (const args of [["archive"], ["update", "--name", "Wrong root"]])
    await assert.rejects(cli(copy, "project", ...args), /registered at/);
  assert.deepEqual(
    calls.map(([method, url]) => [method, url]),
    Array(2).fill(["GET", "/api/projects/alpha"]),
  );
  const registered = JSON.parse(
    (
      await cli(
        alpha,
        "project",
        "register",
        "--from",
        join(beta, "flow.project.json"),
      )
    ).stdout,
  );
  assert.equal(registered.project.id, "beta");
  assert.equal(calls.at(-1)[2].id, "beta");
  const before = calls.length;
  await assert.rejects(
    cli(tmp, "project", "init", "--project", "new", "--workflow", "missing"),
    /Workflow not found/,
  );
  assert.deepEqual(
    calls.slice(before).map(([method, url]) => [method, url]),
    [["GET", "/api/workflows/missing"]],
  );
});
