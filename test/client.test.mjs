import test from "node:test";
import assert from "node:assert/strict";
import {
  WeftClient,
  WeftError,
  createImageWorkflow,
} from "../client/index.mjs";
import { prepareWorkflow } from "../cli/workflow-input.mjs";
import { planWorkflow } from "../server/graph.mjs";

function fixture(graph, projectId) {
  const writes = [];
  const client = new WeftClient({
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
test("the client preserves intentional null ownership on create/save and refuses a foreign overwrite before writing", async () => {
  const graph = createImageWorkflow({
    id: "trial",
    projectId: "first",
    prompt: "Scenery",
  });
  const { client, writes } = fixture(graph, "first");
  assert.equal(
    (await client.createWorkflow({ ...graph, projectId: null })).projectId,
    null,
  );
  assert.equal(
    (await client.saveWorkflow({ ...graph, projectId: null })).projectId,
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
  assert.equal(writes.length, 2);
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
  const directory = await mkdtemp(join(tmpdir(), "weft-local-manifest-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, ".weft-project.json"),
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
  const client = new WeftClient({
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
      (error) => error instanceof WeftError && error.status === 409,
    );
  assert.equal(requests.length, 2, "invalid scopes never reach the server");
});

test("unbound search accepts explicit scopes and exposes index recovery without masking errors", async () => {
  const requests = [];
  const client = new WeftClient({
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
      error instanceof WeftError &&
      error.status === 400 &&
      /too long/.test(error.message),
  );
  const cancelled = new WeftClient({
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
    await mkdtemp(join(tmpdir(), "weft-search-cli-")),
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
    join(directory, ".weft-project.json"),
    JSON.stringify({
      version: 1,
      projectId: "quoture",
      serverUrl: url,
      defaultWorkflowId: "default-studies",
    }),
  );
  const cli = resolve(import.meta.dirname, "../cli/weft.mjs");
  const run = promisify(execFile);
  const { stdout } = await run(
    process.execPath,
    [cli, "search", "quiet companionship", "--json"],
    {
      cwd: directory,
      env: { ...process.env, WEFT_URL: url },
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
      env: { ...process.env, WEFT_URL: url },
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
      env: { ...process.env, WEFT_URL: url },
    }),
    (error) => /Search result count must be/.test(error.stderr),
  );
  assert.equal(requests.length, 2, "invalid limits never submit a search");
});
