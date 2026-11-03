import { viewerParams } from "../shared/viewer-routes.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const entry = fileURLToPath(new URL("../mcp/server.mjs", import.meta.url));
const sessionId = "0ec8f325-c969-467f-83b1-58d5712fc401";
const turnId = "cd7c6f4d-6965-45e2-80ee-aef2f636725c";
const graph = {
  id: "fixture",
  name: "MCP fixture",
  projectId: "qa",
  nodes: [],
  edges: [],
};

test("stdio MCP discovers tools, validates calls and preserves project ownership", async (t) => {
  const requests = [];
  const api = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body =
      text && req.headers["content-type"]?.includes("application/json")
        ? JSON.parse(text)
        : undefined;
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/providers/fal")
      return res.end(
        JSON.stringify({
          ready: Boolean(body?.apiKey),
          hasApiKey: Boolean(body?.apiKey),
          authenticated: null,
        }),
      );
    if (req.url.startsWith("/api/providers/codex"))
      return res.end(
        JSON.stringify({
          mode: body?.mode || "harness",
          hasApiKey: Boolean(body?.apiKey),
          login: {
            status: req.url.endsWith("cancel") ? "cancelled" : "pending",
          },
        }),
      );
    if (
      req.url === "/api/workflows/archive" ||
      req.url === "/api/projects/qa/archive"
    )
      return res.end(JSON.stringify(body));
    if (req.url === "/api/projects?search=quotes&archived=all")
      return res.end(JSON.stringify([{ id: "qa" }]));
    if (req.url === "/api/workflows?projectId=qa&archived=archived")
      return res.end(JSON.stringify([graph]));
    if (req.url.startsWith("/api/agent/sessions")) {
      const session = { id: sessionId, projectId: "qa", turns: [] };
      if (req.url.includes("/turns")) {
        const action = req.url.split("?")[0].split("/").at(-1);
        return res.end(
          JSON.stringify({
            session,
            turn: {
              ...(action === "turns" ? body : { id: turnId }),
              status:
                action === "cancel"
                  ? "cancelled"
                  : action === "turns"
                    ? "queued"
                    : "completed",
            },
            ...(["apply", "undo"].includes(action) && {
              workflow: { ...graph, revision: action === "apply" ? 1 : 2 },
            }),
          }),
        );
      }
      return res.end(JSON.stringify(session));
    }
    if (req.url.startsWith("/api/image-editors")) {
      const editor = {
        id: "a".repeat(32),
        source: { url: "/assets/seed.png", projectId: "qa" },
        revision: 1,
        regions: [],
        comments: [],
        requests: [],
      };
      if (req.url.includes("/status") || req.url.includes("/setup"))
        return res.end(JSON.stringify({ ready: true }));
      if (
        req.url.split("?")[0] === "/api/image-editors" &&
        req.method === "GET"
      )
        return res.end(JSON.stringify([editor]));
      if (req.url.includes("/requests"))
        return res.end(
          JSON.stringify({ editor, workflow: graph, request: body }),
        );
      return res.end(JSON.stringify(editor));
    }
    if (req.url.startsWith("/api/styles")) {
      if (req.url === "/api/styles" && req.method === "POST")
        return res.end(JSON.stringify({ ...body, custom: true }));
      if (req.url === "/api/styles/my-custom" && req.method === "PUT")
        return res.end(
          JSON.stringify({ id: "my-custom", ...body, custom: true }),
        );
      if (req.url === "/api/styles/engraving/workflows")
        return res.end(JSON.stringify({ ...graph, id: "styled", ...body }));
      if (req.url === "/api/styles/import-run")
        return res.end(JSON.stringify({ imported: 1, ...body }));
      if (req.url === "/api/styles/engraving/favorite")
        return res.end(JSON.stringify({ id: "engraving", ...body }));
      if (req.url === "/api/styles/engraving/references")
        return res.end(JSON.stringify({ id: "engraving", ...body }));
      if (req.url === "/api/styles/engraving")
        return res.end(JSON.stringify({ id: "engraving", name: "Engraving" }));
      return res.end(
        JSON.stringify({ styles: [{ id: "engraving" }], total: 180 }),
      );
    }
    if (req.url === "/api/gallery?projectId=qa")
      return res.end(
        JSON.stringify([{ id: "image", projectId: "qa", runId: "qa-run" }]),
      );
    if (req.url.split("?")[0] === "/api/workflows/fixture/results")
      return res.end(JSON.stringify({ generate: [{ id: "image" }] }));
    if (req.url === "/api/search/status" || req.url === "/api/search/retry")
      return res.end(JSON.stringify({ state: "ready" }));
    if (req.url === "/api/uploads")
      return res.end(JSON.stringify([{ url: "/files/uploads/fixture.png" }]));
    if (req.url === "/api/projects/qa" && req.method === "PUT")
      return res.end(JSON.stringify({ id: "qa", ...body }));
    if (req.url === "/api/projects" && req.method === "POST")
      return res.end(JSON.stringify(body));
    if (
      req.url === "/api/providers/connections" ||
      req.url === "/api/providers/connections/api-fixture"
    )
      return res.end(
        JSON.stringify([
          { id: "api-fixture", name: "Fixture", hasApiKey: true },
        ]),
      );
    if (req.url === "/api/providers/connections/api-fixture/test")
      return res.end(JSON.stringify({ models: ["fixture-model"] }));
    if (req.url.startsWith("/api/providers/usage"))
      return res.end(
        JSON.stringify({
          accounts: [{ id: "codex", windows: [{ usedPercent: 24 }] }],
        }),
      );
    if (
      req.url === "/api/providers/reload" ||
      req.url === "/api/providers/example"
    )
      return res.end(JSON.stringify([]));
    if (req.url === "/api/workflows/fixture/fork")
      return res.end(JSON.stringify({ id: "forked", ...body }));
    if (req.url === "/api/workflows/fixture/organize?projectId=qa")
      return res.end(
        JSON.stringify({
          workflow: graph,
          diagnostics: { estimatedNodeIds: [], warnings: [] },
        }),
      );
    if (req.url === "/api/rule-templates")
      return res.end(
        JSON.stringify(
          req.method === "POST"
            ? body
            : { builtIn: [], custom: [], presets: [] },
        ),
      );
    if (req.url === "/api/projects/qa")
      return res.end(
        JSON.stringify({ id: "qa", defaultWorkflowId: "fixture" }),
      );
    if (req.url.split("?")[0] === "/api/workflows/foreign")
      return res.end(
        JSON.stringify({ ...graph, id: "foreign", projectId: "other" }),
      );
    if (req.url.split("?")[0] === "/api/workflows/fixture")
      return res.end(JSON.stringify(graph));
    if (req.url === "/api/workflows?projectId=qa")
      return res.end(JSON.stringify([graph]));
    if (req.url === "/api/workflows" && req.method === "POST")
      return res.end(JSON.stringify(body));
    if (req.url === "/api/plan")
      return res.end(JSON.stringify({ imageJobs: 2, textJobs: 0, total: 2 }));
    if (req.url === "/api/runs" && req.method === "POST")
      return res.end(
        JSON.stringify({ id: "qa-run", projectId: "qa", status: "running" }),
      );
    if (req.url.split("?")[0] === "/api/runs/qa-run")
      return res.end(
        JSON.stringify({
          id: "qa-run",
          workflowId: "fixture",
          projectId: "qa",
          status: "completed",
          graph: { ...graph, name: "Recorded fixture" },
          jobs: [],
        }),
      );
    if (req.url.split("?")[0] === "/api/runs/other-run")
      return res.end(
        JSON.stringify({
          id: "other-run",
          projectId: "other",
          status: "completed",
        }),
      );
    if (req.url === "/api/gallery/search")
      return res.end(
        JSON.stringify({ items: [], total: 0, index: { state: "ready" } }),
      );
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Fixture not found." }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));
  const client = new Client({ name: "weft-test-agent", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: {
      ...process.env,
      WEFT_URL: `http://127.0.0.1:${api.address().port}`,
      WEFT_PROJECT: "qa",
    },
    stderr: "pipe",
  });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  for (const name of [
    "discover",
    "agent_context_schema",
    "open_agent_conversation",
    "read_agent_conversation",
    "ask_page_agent",
    "apply_agent_changes",
    "cancel_page_agent",
    "undo_agent_changes",
    "list_projects",
    "image_editor_status",
    "setup_image_editor",
    "list_image_editors",
    "open_image_editor",
    "read_image_editor",
    "segment_image",
    "patch_image_editor",
    "prepare_image_edit",
    "send_image_edit",
    "set_project_archived",
    "set_workflows_archived",
    "list_workflows",
    "read_workflow",
    "create_workflow",
    "save_workflow",
    "read_codex_connection",
    "configure_codex",
    "start_codex_login",
    "cancel_codex_login",
    "organize_workflow",
    "list_runs",
    "inspect_run",
    "control_run",
    "list_styles",
    "read_style",
    "create_style",
    "update_style",
    "start_style_workflow",
    "set_style_favorite",
    "add_style_references",
    "import_style_reference_run",
    "list_rule_templates",
    "save_rule_template",
    "fork_workflow",
    "create_image_workflow",
    "plan_workflow",
    "run_workflow",
    "wait_run",
    "viewer_url",
    "search_images",
    "create_project",
    "update_project",
    "upload_images",
    "list_gallery",
    "workflow_results",
    "run_download_url",
    "search_status",
    "retry_search_index",
    "provider_example",
    "reload_providers",
    "read_harness_usage",
    "save_provider_connection",
    "remove_provider_connection",
    "test_provider_connection",
  ])
    assert.ok(
      tools.some((tool) => tool.name === name),
      name,
    );
  assert.equal(
    tools.find((tool) => tool.name === "run_workflow").annotations.readOnlyHint,
    false,
  );
  assert.equal(
    tools.find((tool) => tool.name === "plan_workflow").annotations
      .readOnlyHint,
    true,
  );
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  assert.equal(
    (await call("read_codex_connection")).structuredContent.data.mode,
    "harness",
  );
  assert.equal(
    (await call("configure_codex", { mode: "api-key", apiKey: "fixture-key" }))
      .structuredContent.data.hasApiKey,
    true,
  );
  assert.deepEqual(requests.at(-1).body, {
    mode: "api-key",
    apiKey: "fixture-key",
  });
  assert.equal(
    (await call("configure_codex", { mode: "invalid" })).isError,
    true,
  );
  assert.equal(
    (await call("start_codex_login")).structuredContent.data.login.status,
    "pending",
  );
  assert.equal(
    (await call("cancel_codex_login")).structuredContent.data.login.status,
    "cancelled",
  );
  const contextSchema = await call("agent_context_schema");
  assert.equal(
    contextSchema.structuredContent.data.properties.workflowId.type,
    "string",
  );
  assert.ok(
    contextSchema.structuredContent.data.properties.page.enum.includes(
      "editor",
    ),
  );
  assert.equal(
    tools.find((tool) => tool.name === "ask_page_agent").annotations
      .readOnlyHint,
    false,
  );
  assert.equal(
    tools.find((tool) => tool.name === "ask_page_agent").annotations
      .idempotentHint,
    true,
  );
  assert.equal(
    (await call("open_agent_conversation")).structuredContent.data.id,
    sessionId,
  );
  assert.deepEqual(requests.at(-1).body, { projectId: "qa" });
  assert.equal(requests.at(-1).url, "/api/agent/sessions?projectId=qa");
  const ask = {
    sessionId,
    id: turnId,
    message: "Replace running with swimming",
    context: { page: "canvas", workflowId: "fixture", revision: 0 },
  };
  assert.equal(
    (await call("ask_page_agent", ask)).structuredContent.data.turn.id,
    turnId,
  );
  assert.equal(
    requests.at(-1).url,
    `/api/agent/sessions/${sessionId}/turns?projectId=qa`,
  );
  assert.deepEqual(requests.at(-1).body, {
    id: turnId,
    message: ask.message,
    providerId: "codex-text",
    model: "default",
    context: { ...ask.context, selectedNodeIds: [], regionIds: [] },
  });
  assert.equal(
    (await call("read_agent_conversation", { sessionId })).isError,
    undefined,
  );
  assert.equal(requests.at(-1).method, "GET");
  assert.equal(
    requests.at(-1).url,
    `/api/agent/sessions/${sessionId}?projectId=qa`,
  );
  for (const [tool, action] of [
    ["apply_agent_changes", "apply"],
    ["cancel_page_agent", "cancel"],
    ["undo_agent_changes", "undo"],
  ]) {
    assert.equal((await call(tool, { sessionId, turnId })).isError, undefined);
    assert.equal(
      requests.at(-1).url,
      `/api/agent/sessions/${sessionId}/turns/${turnId}/${action}?projectId=qa`,
    );
    assert.deepEqual(requests.at(-1).body, {});
  }
  const beforeInvalidAgent = requests.length;
  for (const [tool, args] of [
    ["ask_page_agent", { ...ask, context: { ...ask.context, revision: -1 } }],
    [
      "ask_page_agent",
      { ...ask, context: { ...ask.context, shell: "run commands" } },
    ],
    ["apply_agent_changes", { sessionId, turnId: "not-a-uuid" }],
    ["open_agent_conversation", { projectId: "other" }],
  ])
    assert.equal((await call(tool, args)).isError, true);
  assert.equal(
    requests.length,
    beforeInvalidAgent,
    "Invalid agent calls must not reach the local API",
  );
  assert.equal(
    (await call("list_projects", { search: "quotes", archived: "all" }))
      .isError,
    undefined,
  );
  assert.equal(
    (await call("list_workflows", { archived: "archived" })).isError,
    undefined,
  );
  assert.equal(
    (await call("set_workflows_archived", { ids: ["fixture"], archived: true }))
      .isError,
    undefined,
  );
  assert.deepEqual(requests.at(-1).body, {
    ids: ["fixture"],
    archived: true,
    projectId: "qa",
  });
  assert.equal(
    (await call("set_project_archived", { projectId: "other", archived: true }))
      .isError,
    true,
  );
  assert.equal(
    (await call("set_project_archived", { projectId: "qa", archived: false }))
      .isError,
    undefined,
  );
  const projectsView = await call("viewer_url", { projects: true });
  assert.equal(new URL(projectsView.structuredContent.data.url).search, "");
  assert.equal(
    viewerParams(new URL(projectsView.structuredContent.data.url)).get("view"),
    "projects",
  );
  for (const [tool, args] of [
    ["image_editor_status", {}],
    ["setup_image_editor", {}],
    ["list_image_editors", {}],
    ["open_image_editor", { source: "/assets/seed.png" }],
    ["read_image_editor", { editorId: "a".repeat(32) }],
    ["segment_image", { editorId: "a".repeat(32), point: { x: 0.4, y: 0.5 } }],
    [
      "patch_image_editor",
      {
        editorId: "a".repeat(32),
        change: {
          revision: 1,
          comment: {
            regionIds: ["region-a"],
            text: "Change this region",
            anchor: { x: 0.4, y: 0.6 },
          },
        },
      },
    ],
    [
      "prepare_image_edit",
      {
        editorId: "a".repeat(32),
        revision: 1,
        regionIds: ["region-a"],
        instructions: "Change this region",
      },
    ],
    ["viewer_url", { editorId: "a".repeat(32) }],
    [
      "send_image_edit",
      {
        editorId: "a".repeat(32),
        requestId: "40b79f41-ca21-403d-8b2b-50ada03a1674",
      },
    ],
  ])
    assert.equal((await call(tool, args)).isError, undefined, tool);
  assert.equal(
    requests.some((req) => req.url.includes("/segments?projectId=qa")),
    true,
  );
  assert.equal(
    (
      await call("segment_image", {
        editorId: "a".repeat(32),
        point: { x: 2, y: 0 },
      })
    ).isError,
    true,
  );
  const custom = await call("create_style", {
    id: "my-custom",
    name: "My style",
    prompt: "Graphite sketch",
    scene: "A lake",
  });
  assert.equal(custom.structuredContent.data.custom, true);
  assert.equal(custom.structuredContent.data.id, "my-custom");
  const edit = await call("update_style", {
    styleId: "my-custom",
    name: "My updated style",
  });
  assert.equal(edit.structuredContent.data.name, "My updated style");
  assert.deepEqual(
    requests.find(
      (request) =>
        request.method === "PUT" && request.url === "/api/styles/my-custom",
    ).body,
    { name: "My updated style" },
  );
  assert.equal(
    (await call("list_styles", { search: "engraving" })).structuredContent.data
      .total,
    180,
  );
  assert.equal(
    (await call("read_style", { styleId: "engraving" })).structuredContent.data
      .name,
    "Engraving",
  );
  assert.equal(
    (
      await call("start_style_workflow", {
        styleId: "engraving",
        subject: "A tree",
      })
    ).structuredContent.data.projectId,
    "qa",
  );
  assert.equal(
    (await call("set_style_favorite", { styleId: "engraving", favorite: true }))
      .structuredContent.data.favorite,
    true,
  );
  assert.equal(
    (await call("import_style_reference_run", { runId: "qa-run" }))
      .structuredContent.data.projectId,
    "qa",
  );
  assert.equal(
    (
      await call("start_style_workflow", {
        styleId: "engraving",
        projectId: "foreign",
      })
    ).isError,
    true,
  );
  assert.deepEqual((await call("list_rule_templates")).structuredContent.data, {
    builtIn: [],
    custom: [],
    presets: [],
  });
  assert.equal(
    (
      await call("save_rule_template", {
        id: "clear-horizon",
        title: "Clear horizon",
        text: "Keep the horizon clear.",
      })
    ).structuredContent.data.id,
    "clear-horizon",
  );
  assert.equal(
    (await call("list_workflows")).structuredContent.data[0].id,
    "fixture",
  );
  const foreign = await call("read_workflow", { workflowId: "foreign" });
  assert.equal(foreign.isError, true);
  assert.equal(foreign.structuredContent.error.status, 409);
  assert.equal(
    (await call("read_fal_connection")).structuredContent.data.authenticated,
    null,
  );
  assert.equal(
    (await call("configure_fal", { connection: { apiKey: "fixture-fal-key" } }))
      .structuredContent.data.hasApiKey,
    true,
  );
  assert.deepEqual(requests.at(-1), {
    method: "PUT",
    url: "/api/providers/fal",
    body: { apiKey: "fixture-fal-key" },
  });
  assert.equal(
    (
      await call("configure_fal", {
        connection: { endpoint: "https://evil.example" },
      })
    ).isError,
    true,
  );
  const organized = await call("organize_workflow", {
    workflowId: "fixture",
    revision: 0,
    preview: true,
  });
  assert.equal(organized.structuredContent.data.workflow.id, "fixture");
  assert.deepEqual(requests.at(-1), {
    method: "POST",
    url: "/api/workflows/fixture/organize?projectId=qa",
    body: { revision: 0, preview: true },
  });
  assert.equal(
    (await call("organize_workflow", { workflowId: "foreign", revision: 0 }))
      .isError,
    true,
  );
  assert.equal(
    (await call("create_workflow", { workflow: { ...graph, projectId: null } }))
      .isError,
    true,
  );
  const created = await call("create_image_workflow", {
    name: "New fixture",
    prompt: "Base scenery",
    providerId: "local-color",
    model: "color-study",
  });
  assert.equal(created.structuredContent.data.projectId, "qa");
  assert.equal(
    created.structuredContent.data.nodes.find((node) => node.id === "prompt")
      .data.text,
    "Base scenery",
  );
  assert.equal(
    (await call("plan_workflow", { workflowId: "fixture" })).structuredContent
      .data.imageJobs,
    2,
  );
  const snapshotFork = await call("fork_workflow", {
    workflowId: "fixture",
    runId: "qa-run",
    name: "Snapshot fork",
  });
  assert.equal(
    snapshotFork.structuredContent.data.workflow.name,
    "Recorded fixture",
  );
  assert.equal(requests.at(-1).body.workflow.id, "fixture");
  const beforeWrongFork = requests.length;
  assert.equal(
    (await call("fork_workflow", { workflowId: "foreign", runId: "qa-run" }))
      .isError,
    true,
  );
  assert.equal(
    requests.length,
    beforeWrongFork + 1,
    "Mismatched run must not submit a fork",
  );
  const beforeInvalid = requests.length;
  assert.equal(
    (await call("run_workflow", { workflowId: "fixture", concurrency: 999 }))
      .isError,
    true,
  );
  assert.equal(
    requests.length,
    beforeInvalid,
    "SDK validation prevents invalid HTTP calls",
  );
  const run = await call("run_workflow", {
    workflowId: "fixture",
    options: { count: 2 },
  });
  assert.equal(run.structuredContent.data.id, "qa-run");
  const waited = await call("wait_run", { runId: "qa-run", timeoutSeconds: 1 });
  assert.equal(waited.structuredContent.data.run.status, "completed");
  assert.equal(waited.structuredContent.data.timedOut, false);
  assert.equal(
    (await call("inspect_run", { runId: "other-run" })).isError,
    true,
  );
  assert.equal(
    (await call("control_run", { runId: "other-run", action: "cancel" }))
      .isError,
    true,
  );
  assert.equal(
    requests.some((request) => request.url === "/api/runs/other-run/cancel"),
    false,
  );
  const viewer = await call("viewer_url", {
    workflowId: "fixture",
    nodeId: "missing",
  });
  assert.equal(viewer.isError, true);
  const validViewer = await call("viewer_url", {
    workflowId: "fixture",
    gallery: true,
  });
  assert.equal(
    viewerParams(new URL(validViewer.structuredContent.data.url)).get(
      "gallery",
    ),
    "1",
  );
  assert.equal(new URL(validViewer.structuredContent.data.url).search, "");
  const styleViewer = await call("viewer_url", {
    workflowId: "fixture",
    styles: true,
  });
  assert.equal(
    viewerParams(new URL(styleViewer.structuredContent.data.url)).get("view"),
    "styles",
  );
  assert.equal(
    (await call("list_gallery")).structuredContent.data[0].projectId,
    "qa",
  );
  assert.equal(
    (await call("workflow_results", { workflowId: "fixture" }))
      .structuredContent.data.generate[0].id,
    "image",
  );
  const beforeForeignResults = requests.length;
  assert.equal(
    (await call("workflow_results", { workflowId: "foreign" })).isError,
    true,
  );
  assert.equal(requests.length, beforeForeignResults + 1);
  assert.equal(
    requests.some((r) => r.url === "/api/workflows/foreign/results"),
    false,
  );
  assert.equal(
    (await call("run_download_url", { runId: "other-run" })).isError,
    true,
  );
  assert.match(
    (await call("run_download_url", { runId: "qa-run" })).structuredContent.data
      .url,
    /qa-run\/download\?projectId=qa$/,
  );
  assert.equal(
    (await call("search_status")).structuredContent.data.state,
    "ready",
  );
  assert.equal(
    (await call("retry_search_index")).structuredContent.data.state,
    "ready",
  );
  assert.equal(
    (
      await call("update_project", {
        projectId: "qa",
        changes: { defaultWorkflowId: null },
      })
    ).structuredContent.data.defaultWorkflowId,
    null,
  );
  const beforeForeignProject = requests.length;
  assert.equal(
    (
      await call("update_project", {
        projectId: "other",
        changes: { name: "Forbidden" },
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await call("create_project", {
        id: "other",
        name: "Other",
        root: "/tmp/other",
      })
    ).isError,
    true,
  );
  assert.equal(requests.length, beforeForeignProject);
  assert.equal(
    (await call("create_project", { id: "qa", name: "QA", root: "/tmp/qa" }))
      .structuredContent.data.id,
    "qa",
  );
  assert.deepEqual((await call("provider_example")).structuredContent.data, []);
  assert.deepEqual((await call("reload_providers")).structuredContent.data, []);
  assert.equal(
    (await call("read_harness_usage", { refresh: true })).structuredContent.data
      .accounts[0].windows[0].usedPercent,
    24,
  );
  assert.ok(
    requests.some(
      (request) => request.url === "/api/providers/usage?refresh=1",
    ),
  );
  const connection = {
    name: "Fixture",
    baseUrl: "http://localhost:9999/v1",
    models: [{ id: "fixture-model", capabilities: ["text"] }],
    apiKey: { action: "replace", value: "test-write-only-secret" },
  };
  const savedConnection = await call("save_provider_connection", {
    connection,
  });
  assert.equal(savedConnection.isError, undefined);
  assert.equal(
    JSON.stringify(savedConnection).includes("test-write-only-secret"),
    false,
  );
  assert.equal(requests.at(-1).body.apiKey.value, "test-write-only-secret");
  assert.equal(
    (await call("test_provider_connection", { connectionId: "api-fixture" }))
      .structuredContent.data.models[0],
    "fixture-model",
  );
  assert.equal(
    (await call("remove_provider_connection", { connectionId: "api-fixture" }))
      .isError,
    undefined,
  );
  assert.equal(requests.at(-1).method, "DELETE");
  const imagePath = fileURLToPath(
    new URL("../public/assets/paper-seed.png", import.meta.url),
  );
  assert.equal(
    (await call("upload_images", { paths: [imagePath] })).structuredContent
      .data[0].url,
    "/files/uploads/fixture.png",
  );
  await call("search_images", {
    query: "quiet scenery",
    workflowId: "fixture",
    limit: 2,
  });
  assert.equal(requests.at(-1).body.scope, "project:qa");
});

test("agent CLI exposes scoped sessions, current workflow context and explicit apply/cancel/undo", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const exec = promisify(execFile),
    requests = [];
  const api = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/projects/qa")
      return res.end(JSON.stringify({ id: "qa" }));
    if (req.url === "/api/workflows/fixture?projectId=qa")
      return res.end(JSON.stringify({ ...graph, revision: 7 }));
    if (req.url.startsWith("/api/agent/sessions"))
      return res.end(JSON.stringify({ id: sessionId, body }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Fixture not found" }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(join(tmpdir(), "weft-agent-cli-"));
  t.after(async () => {
    await new Promise((resolve) => api.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${api.address().port}`;
  const cli = fileURLToPath(new URL("../cli/weft.mjs", import.meta.url));
  const invoke = async (...args) =>
    JSON.parse(
      (
        await exec(
          process.execPath,
          [cli, "agent", ...args, "--project", "qa", "--url", url, "--json"],
          { cwd: directory },
        )
      ).stdout,
    );
  assert.equal((await invoke("session")).id, sessionId);
  assert.deepEqual(requests.at(-1).body, { projectId: "qa" });
  await invoke(
    "ask",
    "--workflow",
    "fixture",
    "--prompt",
    "Use swimming",
    "--provider",
    "claude-code",
    "--model",
    "chosen-model",
    "--id",
    turnId,
  );
  assert.equal(
    requests.at(-1).url,
    `/api/agent/sessions/${sessionId}/turns?projectId=qa`,
  );
  assert.deepEqual(requests.at(-1).body, {
    id: turnId,
    message: "Use swimming",
    providerId: "claude-code",
    model: "chosen-model",
    context: {
      page: "canvas",
      workflowId: "fixture",
      revision: 7,
      selectedNodeIds: [],
      regionIds: [],
    },
  });
  const input = join(directory, "ask.json");
  await writeFile(
    input,
    JSON.stringify({
      id: turnId,
      message: "Explain this style",
      context: { page: "styles" },
    }),
  );
  await invoke("ask", sessionId, "--from", input);
  assert.equal(requests.at(-1).body.context.page, "styles");
  await invoke("read", sessionId);
  assert.equal(requests.at(-1).method, "GET");
  assert.equal(
    requests.at(-1).url,
    `/api/agent/sessions/${sessionId}?projectId=qa`,
  );
  for (const action of ["apply", "cancel", "undo"]) {
    await invoke(action, sessionId, turnId);
    assert.equal(
      requests.at(-1).url,
      `/api/agent/sessions/${sessionId}/turns/${turnId}/${action}?projectId=qa`,
    );
  }
  await assert.rejects(invoke("apply", sessionId), /assistant turn ID/);
  const beforeSchema = requests.length;
  assert.equal((await invoke("schema")).properties.page.type, "string");
  assert.equal(
    requests.length,
    beforeSchema,
    "Context schema discovery should work offline",
  );
});
