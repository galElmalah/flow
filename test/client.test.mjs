import test from "node:test";
import assert from "node:assert/strict";
import {
  FlowClient,
  FlowError,
  createImageWorkflow,
  createVideoWorkflow,
  toFlowFile,
} from "../client/index.mjs";
import { prepareWorkflow } from "../cli/workflow-input.mjs";
import { planWorkflow } from "../server/graph.mjs";

function fixture(graph, projectId) {
  const writes = [];
  const client = new FlowClient({
    projectId,
    fetch: async (_url, options = {}) => {
      if (!options.method) return Response.json(graph);
      const body = JSON.parse(options.body);
      writes.push(body);
      return Response.json(body);
    },
  });
  return { client, writes };
}
test("project-bound writes respect ownership and unbound writes can explicitly unassign", async () => {
  const graph = createImageWorkflow({
    id: "trial",
    projectId: "first",
    prompt: "Scenery",
  });
  const { client, writes } = fixture(graph, "first");
  const unbound = fixture(graph);
  for (const projectId of [null, "second"]) {
    assert.throws(() => client.createWorkflow({ ...graph, projectId }), {
      code: "PROJECT_SCOPE_MISMATCH",
    });
    await assert.rejects(client.saveWorkflow({ ...graph, projectId }), {
      code: "PROJECT_SCOPE_MISMATCH",
    });
    assert.throws(() => client.fork(graph.id, { projectId }), {
      code: "PROJECT_SCOPE_MISMATCH",
    });
  }
  assert.throws(() => client.updateProject("second", { name: "Changed" }), {
    code: "PROJECT_SCOPE_MISMATCH",
  });
  assert.throws(() => client.createProject({ id: "second" }), {
    code: "PROJECT_SCOPE_MISMATCH",
  });
  assert.equal(
    (await unbound.client.createWorkflow({ ...graph, projectId: null }))
      .projectId,
    null,
  );
  assert.equal(
    (await unbound.client.saveWorkflow({ ...graph, projectId: null }))
      .projectId,
    null,
  );
  assert.equal(createImageWorkflow({ projectId: null }).projectId, null);
  const foreign = fixture({ ...graph, projectId: "second" }, "first");
  const ownerless = structuredClone(graph);
  delete ownerless.projectId;
  await assert.rejects(
    foreign.client.saveWorkflow(ownerless),
    /belongs to project second/,
  );
  assert.equal(foreign.writes.length, 0);
  const unowned = fixture({ ...graph, projectId: null }, "first");
  await assert.rejects(
    unowned.client.saveWorkflow(ownerless),
    /Assign an unowned workflow explicitly/,
  );
  assert.equal((await unowned.client.saveWorkflow(graph)).projectId, "first");
  assert.equal(writes.length, 0);
});
test("saved workflow prompt-instructions override reaches the actual planned harness job without altering the saved graph", async () => {
  const graph = createImageWorkflow({
    id: "scene-workflow",
    projectId: "first",
    prompt: "Quiet scenery",
    promptProviderId: "claude-code",
    promptInstructions: "Original instructions",
    providerId: "local-color",
    model: "color-study",
  });
  const { client } = fixture(graph, "first");
  const input = await prepareWorkflow(
    client,
    { "prompt-instructions": "Describe a precise new courtyard scene." },
    { workflowId: graph.id },
  );
  const plan = planWorkflow(input);
  assert.match(
    plan.jobs.find((j) => j.kind === "text").prompt,
    /Describe a precise new courtyard scene\./,
  );
  assert.equal(
    graph.nodes.find((n) => n.type === "prompt-generate").data.text,
    "Original instructions",
  );
});
test("project context travels with run controls and scoped waits reject another project's run", async () => {
  const { client, writes } = fixture(
    { id: "run", projectId: "second", status: "completed" },
    "first",
  );
  await client.control("run", "resume");
  assert.deepEqual(writes, [{ projectId: "first" }]);
  await assert.rejects(client.wait("run"), /belongs to second/);
});

test("a consuming repository cannot redirect platform discovery to a remote service", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { findProjectContext } = await import("../client/project-context.mjs");
  const directory = await mkdtemp(join(tmpdir(), "flow-local-manifest-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "flow.project.json"),
    JSON.stringify({
      version: 1,
      projectId: "quoture",
      serverUrl: "https://remote.example",
    }),
  );
  await assert.rejects(
    findProjectContext(directory),
    /localhost HTTP platform URL/,
  );
});

test("semantic search keeps project ownership while narrowing filters and propagates cancellation", async () => {
  const requests = [];
  const controller = new AbortController();
  const result = {
    items: [{ id: "image", similarity: 0.8, searchExcerpt: "Two companions" }],
    total: 1,
    index: { state: "ready", indexed: 1, total: 1, model: "local" },
  };
  const client = new FlowClient({
    url: "http://localhost:4310",
    projectId: "quoture",
    fetch: async (url, options) => {
      requests.push({ url, options });
      return Response.json(result);
    },
  });
  assert.deepEqual(
    await client.searchImages(
      {
        query: "friendship through hardship",
        workflowId: "studies",
        runId: "run-id",
        providerId: "codex",
        limit: 20,
      },
      { signal: controller.signal },
    ),
    result,
  );
  assert.equal(requests[0].url, "http://localhost:4310/api/gallery/search");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.signal, controller.signal);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    query: "friendship through hardship",
    scope: "project:quoture",
    workflowId: "studies",
    runId: "run-id",
    providerId: "codex",
    limit: 20,
  });
  await client.searchImages({ query: "path", scope: "project:quoture" });
  assert.equal(requests.length, 2);
  for (const scope of [
    "all",
    "unassigned",
    "project:foreign",
    "workflow:studies",
    null,
    "",
  ])
    await assert.rejects(
      client.searchImages({ query: "path", scope, workflowId: "studies" }),
      (error) => error instanceof FlowError && error.status === 409,
    );
  assert.equal(requests.length, 2, "invalid scopes never reach the server");
});

test("unbound search accepts explicit scopes and exposes index recovery without masking errors", async () => {
  const requests = [];
  const client = new FlowClient({
    url: "http://localhost:4310",
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith("/api/gallery/search")) {
        if (JSON.parse(options.body).query === "invalid")
          return Response.json(
            { error: "Search query is too long." },
            { status: 400 },
          );
        return Response.json({
          items: [],
          total: 0,
          index: { state: "indexing" },
        });
      }
      return Response.json({
        state: "indexing",
        indexed: 1,
        total: 2,
        model: "local",
      });
    },
  });
  for (const scope of [
    undefined,
    "all",
    "unassigned",
    "project:quoture",
    "workflow:studies",
  ]) {
    const result = await client.searchImages({ query: "path", scope });
    assert.equal(result.index.state, "indexing");
    assert.equal(
      JSON.parse(requests.at(-1).options.body).scope,
      scope || "all",
    );
  }
  assert.equal((await client.searchStatus()).state, "indexing");
  assert.equal(requests.at(-1).url, "http://localhost:4310/api/search/status");
  assert.equal(requests.at(-1).options.method, undefined);
  await client.searchRetry();
  assert.equal(requests.at(-1).url, "http://localhost:4310/api/search/retry");
  assert.equal(requests.at(-1).options.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {});
  await assert.rejects(
    client.searchImages({ query: "invalid" }),
    (error) =>
      error instanceof FlowError &&
      error.status === 400 &&
      /too long/.test(error.message),
  );
  const cancelled = new FlowClient({
    fetch: (_url, { signal }) => {
      signal.throwIfAborted();
      throw new Error("should not fetch an aborted request");
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    cancelled.searchImages({ query: "path" }, { signal: controller.signal }),
    (error) => error.name === "AbortError",
  );
});

test("the search CLI searches the discovered project without its default workflow and only narrows explicit filters", async (t) => {
  const { createServer } = await import("node:http");
  const { mkdtemp, writeFile, rm, realpath } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "flow-search-cli-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/projects/quoture")
      return response.end(
        JSON.stringify({
          id: "quoture",
          root: directory,
          defaultWorkflowId: "default-studies",
        }),
      );
    if (request.url !== "/api/gallery/search") {
      response.statusCode = 404;
      return response.end(JSON.stringify({ error: "Unexpected route" }));
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.end(
      JSON.stringify({ items: [], total: 0, index: { state: "ready" } }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://localhost:${server.address().port}`;
  await writeFile(
    join(directory, "flow.project.json"),
    JSON.stringify({
      version: 1,
      projectId: "quoture",
      serverUrl: url,
      defaultWorkflowId: "default-studies",
    }),
  );
  const cli = resolve(import.meta.dirname, "../cli/flow.mjs");
  const run = promisify(execFile);
  const { stdout } = await run(
    process.execPath,
    [cli, "search", "quiet companionship", "--json"],
    {
      cwd: directory,
      env: { ...process.env, FLOW_URL: url },
    },
  );
  assert.equal(JSON.parse(stdout).index.state, "ready");
  assert.deepEqual(requests[0], {
    query: "quiet companionship",
    scope: "project:quoture",
  });
  await run(
    process.execPath,
    [
      cli,
      "search",
      "classical thinker",
      "--workflow",
      "explicit-studies",
      "--run",
      "run-id",
      "--provider",
      "codex",
      "--count",
      "20",
      "--json",
    ],
    {
      cwd: directory,
      env: { ...process.env, FLOW_URL: url },
    },
  );
  assert.deepEqual(requests[1], {
    query: "classical thinker",
    scope: "project:quoture",
    workflowId: "explicit-studies",
    runId: "run-id",
    providerId: "codex",
    limit: 20,
  });
  await assert.rejects(
    run(process.execPath, [cli, "search", "scene", "--count", "not-a-number"], {
      cwd: directory,
      env: { ...process.env, FLOW_URL: url },
    }),
    (error) => /--count/.test(error.stderr),
  );
  assert.equal(requests.length, 2, "invalid limits never submit a search");
});

test("run options and submission controls are strict before HTTP serialization", async () => {
  const { client, writes } = fixture({});
  for (const invalid of [{ count: NaN }, { copies: 3 }, { seed: 2147483648 }]) {
    for (const operation of ["plan", "run"])
      assert.throws(() => client[operation]("graph", invalid), {
        code: "INVALID_ARGUMENT",
      });
  }
  for (const invalid of [
    { concurrency: NaN },
    { unknown: true },
    { requestId: "" },
  ])
    assert.throws(() => client.run("graph", {}, invalid), {
      code: "INVALID_ARGUMENT",
    });
  assert.equal(writes.length, 0);
  await client.run(
    "graph",
    { count: 3 },
    { requestId: "task.2", concurrency: 1 },
  );
  assert.deepEqual(writes, [
    {
      workflowId: "graph",
      options: { count: 3 },
      requestId: "task.2",
      concurrency: 1,
    },
  ]);
});

test("a wait deadline aborts a real pending HTTP body and preserves the run ID", async (t) => {
  const { createServer } = await import("node:http");
  const api = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write("{");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    api.closeAllConnections();
    return new Promise((resolve) => api.close(resolve));
  });
  const client = new FlowClient({
    url: `http://127.0.0.1:${api.address().port}`,
  });
  await assert.rejects(
    client.wait("queued-run", {
      timeout: 0.05,
      signal: AbortSignal.timeout(3000),
    }),
    {
      code: "RUN_WAIT_TIMEOUT",
      status: 408,
      runId: "queued-run",
      timeoutSeconds: 0.05,
    },
  );
  for (const interval of [NaN, 0, -1])
    await assert.rejects(client.wait("queued-run", { interval }), {
      code: "INVALID_ARGUMENT",
    });
  const reason = new Error("caller stopped waiting");
  await assert.rejects(
    client.wait("queued-run", { signal: AbortSignal.abort(reason) }),
    (error) => error === reason,
  );
});

test("bound clients can upload, import, save and plan a detached graph in their project", async () => {
  const graph = createImageWorkflow({ id: "detached", prompt: "A pear" });
  const { client, writes } = fixture({ ...graph, projectId: "one" }, "one");
  const file = toFlowFile(graph);
  for (const input of [graph, file]) {
    assert.equal((await client.createWorkflow(input)).projectId, "one");
    assert.equal((await client.saveWorkflow(input)).id, graph.id);
    assert.equal((await client.plan(input)).workflow.projectId, "one");
    assert.equal((await client.run(input)).workflow.projectId, "one");
    assert.equal(
      (await client.previewPromptItem(input, "prompts", "item")).workflow
        .projectId,
      "one",
    );
  }
  assert.equal(Object.hasOwn(graph, "projectId"), false);
  assert.equal(Object.hasOwn(file.workflow, "projectId"), false);
  for (const projectId of [null, "other"]) {
    const foreign = toFlowFile({ ...graph, projectId });
    const before = writes.length;
    assert.throws(() => client.createWorkflow(foreign), {
      code: "PROJECT_SCOPE_MISMATCH",
    });
    assert.throws(() => client.run(foreign), {
      code: "PROJECT_SCOPE_MISMATCH",
    });
    await assert.rejects(client.saveWorkflow(foreign), {
      code: "PROJECT_SCOPE_MISMATCH",
    });
    assert.equal(writes.length, before);
  }
  const upload = new FlowClient({
    projectId: "one",
    fetch: async (_url, { body, headers }) => {
      assert.equal(body.get("projectId"), "one");
      assert.equal(body.get("images").name, "seed.png");
      assert.equal(new Headers(headers).has("Content-Type"), false);
      return Response.json([]);
    },
  });
  await upload.upload([{ name: "seed.png", data: new Uint8Array([1]) }]);
});

test("recorded runs without a saved workflow open snapshot nodes and fork by run ID", async () => {
  const urls = [];
  const run = {
    id: "run",
    workflowId: "inline",
    projectId: "one",
    graph: createImageWorkflow({ id: "inline", projectId: "one" }),
  };
  const client = new FlowClient({
    url: "http://127.0.0.1:4310",
    fetch: async (url, options) => {
      urls.push(url);
      const path = new URL(url).pathname;
      if (path === "/api/runs/run") return Response.json(run);
      if (path === "/api/workflows/inline")
        return Response.json({}, { status: 404 });
      if (path === "/api/workflows/inline/fork")
        return Response.json(JSON.parse(options.body));
      throw new Error("Unexpected " + path);
    },
  });
  assert.equal(
    (await client.viewer({ runId: run.id, nodeId: "prompt" })).url,
    "http://127.0.0.1:4310/project/one/workflow/inline/run/run/node/prompt",
  );
  await assert.rejects(
    client.viewer({ runId: run.id, nodeId: "missing" }),
    /does not exist/,
  );
  await assert.rejects(client.viewer({ workflowId: "inline" }), {
    status: 404,
  });
  const bound = new FlowClient({
    url: client.url,
    fetch: client.fetch,
    projectId: "one",
  });
  assert.deepEqual(await bound.fork("inline", { runId: "run" }), {
    runId: "run",
    projectId: "one",
  });
  assert.equal(new URL(urls.at(-1)).searchParams.get("projectId"), "one");
  assert.throws(
    () => bound.fork("inline", { runId: "run", workflow: run.graph }),
    { code: "INVALID_ARGUMENT" },
  );
});

test("HTTP errors retain status, request headers and caller cancellation", async (t) => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { promise: started, resolve: markStarted } = Promise.withResolvers();
  const api = createServer((request, response) => {
    if (request.url === "/headers")
      return response.end(JSON.stringify(request.headers["x-sdk-header"]));
    response.writeHead(503, { "Content-Type": "application/json" });
    if (request.url === "/null") return response.end("null");
    response.write("{");
    markStarted();
  }).listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(() => {
    api.closeAllConnections();
    return new Promise((resolve) => api.close(resolve));
  });
  const client = new FlowClient({
    url: `http://127.0.0.1:${api.address().port}`,
  });
  for (const headers of [
    new Headers({ "x-sdk-header": "value" }),
    [["x-sdk-header", "value"]],
  ])
    assert.equal(await client.request("/headers", { headers }), "value");
  await assert.rejects(client.request("/null"), {
    name: "FlowError",
    status: 503,
  });
  const controller = new AbortController(),
    reason = new Error("Stop waiting for search");
  const pending = client.searchImages(
    { query: "apple" },
    { signal: controller.signal },
  );
  await started;
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
});

test("recipe templates substitute shared direction and an empty dataset never generates a fallback job", () => {
  const record = { id: "s", fields: { scene: "a pear" } };
  const prompt = { id: "s", label: "Study", scene: "a pear" };
  for (const inputs of [{ prompts: [prompt] }, { records: [record] }]) {
    const graph = createImageWorkflow({
      prompt: "warm light",
      template: "Paint {{scene}} in {{input}}.",
      ...inputs,
    });
    assert.equal(
      planWorkflow(graph).jobs[0].prompt,
      "Paint a pear in warm light.",
    );
  }
  assert.throws(
    () => createImageWorkflow({ prompt: "a pear", records: [] }),
    /at least one record/,
  );
});

test("media recipes choose fal endpoints using per-scene references and retain explicit comparison settings", async () => {
  const { FalMedia } = await import("../harness-integrations/fal/index.mjs");
  const fal = new FalMedia({ dataRoot: import.meta.dirname, env: {} });
  const image = "/assets/seed.png";
  const prompts = [
    { id: "pear", label: "Pear", scene: "A pear", images: [image] },
    { id: "disabled", label: "Disabled", scene: "", enabled: false },
  ];
  const records = [{ id: "pear", fields: { fruit: "pear" }, images: [image] }];
  for (const inputs of [{ prompts }, { records }]) {
    const imageJob = planWorkflow(
      createImageWorkflow({ providerId: "fal-image", ...inputs }),
    ).jobs[0];
    assert.match(imageJob.model, /\/edit$/);
    fal.preflight(imageJob);
    const videoJob = planWorkflow(
      createVideoWorkflow({ providerId: "fal-video", ...inputs }),
    ).jobs[0];
    assert.equal(fal.preflight(videoJob).settings.mode, "image");
    assert.equal(videoJob.ratio, "auto");
  }
  assert.throws(
    () =>
      createImageWorkflow({
        providerId: "fal-image",
        prompts: [...prompts, { id: "plain", label: "Plain", scene: "A tree" }],
      }),
    /text-only scenes/,
  );
  const compared = planWorkflow(
    createImageWorkflow({
      prompt: "A pear",
      image: { resolution: "2k" },
      modes: [
        { id: "fal", providerId: "fal-image" },
        { id: "grok", providerId: "grok-image", quality: "low" },
      ],
    }),
  ).jobs;
  assert.ok(compared.every((job) => job.image.resolution === "2k"));
  assert.equal(compared[1].quality, "low");
  const comparedVideos = planWorkflow(
    createVideoWorkflow({
      prompt: "A pear",
      providerId: "fal-video",
      images: [image],
      video: { resolution: "720p", durationSeconds: 12, mode: "reference" },
      modes: [
        { id: "shared", providerId: "fal-video" },
        {
          id: "first",
          providerId: "fal-video",
          video: { resolution: "1080p" },
        },
      ],
    }),
  ).jobs;
  assert.equal(fal.preflight(comparedVideos[0]).settings.mode, "reference");
  assert.equal(comparedVideos[0].video.durationSeconds, 12);
  assert.equal(fal.preflight(comparedVideos[1]).settings.mode, "image");
  assert.equal(comparedVideos[1].video.durationSeconds, 8);
});
