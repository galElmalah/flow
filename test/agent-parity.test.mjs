import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WeftClient, createImageWorkflow } from "../client/index.mjs";

// Exercise public commands against isolated HTTP state, never the user's platform.
test("agent CLI covers durable UI actions through the supported API with scoped exports", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "weft-agent-parity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  let graph = createImageWorkflow({
    id: "fixture",
    name: "Fixture",
    projectId: "qa",
    prompt: "Base prompt",
  });
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body =
      request.headers["content-type"]?.includes("application/json") && text
        ? JSON.parse(text)
        : null;
    requests.push({ method: request.method, url: request.url, body, text });
    const send = (value) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(value));
    };
    if (request.url === "/api/projects/qa")
      return send({ id: "qa", root: directory, name: "QA", ...(body || {}) });
    if (request.url.split("?")[0] === "/api/workflows/fixture") {
      if (request.method === "PUT") graph = body;
      return send(graph);
    }
    if (request.url === "/api/workflows/fixture/fork")
      return send({ ...body.workflow, id: "forked", name: body.name });
    if (request.url === "/api/gallery?projectId=qa")
      return send([
        {
          id: "image",
          projectId: "qa",
          prompt: "Exact image prompt",
          images: [],
        },
      ]);
    if (request.url.split("?")[0] === "/api/workflows/fixture/results")
      return send({
        generate: [{ id: "image", prompt: "Exact image prompt" }],
      });
    if (request.url.split("?")[0] === "/api/runs/run")
      return send({
        id: "run",
        workflowId: "fixture",
        projectId: "qa",
        jobs: [],
        graph: { ...graph, name: "Recorded snapshot" },
      });
    if (request.url.split("?")[0] === "/api/runs/foreign")
      return send({ id: "foreign", projectId: "other", jobs: [] });
    if (request.url.split("?")[0] === "/api/runs/run/download")
      return response.end(Buffer.from("test-archive"));
    if (request.url === "/api/uploads") {
      assert.match(
        request.headers["content-type"],
        /^multipart\/form-data; boundary=/,
      );
      assert.match(text, /name="images"; filename="seed.png"/);
      return send([{ url: "/files/uploads/seed.png", name: "seed.png" }]);
    }
    if (
      request.url === "/api/providers/connections" ||
      request.url === "/api/providers/connections/api-test"
    )
      return send([{ id: "api-test", hasApiKey: true }]);
    if (request.url === "/api/providers/connections/api-test/test")
      return send({ models: ["fixture-model"] });
    if (
      request.url === "/api/providers/reload" ||
      request.url === "/api/providers/example"
    )
      return send([]);
    if (
      request.url === "/api/search/status" ||
      request.url === "/api/search/retry"
    )
      return send({ state: "ready" });
    response.statusCode = 404;
    send({ error: "Unknown fixture route" });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const url = `http://localhost:${server.address().port}`;
  const cli = resolve(import.meta.dirname, "../cli/weft.mjs");
  const run = promisify(execFile);
  const command = async (...args) => {
    const { stdout } = await run(
      process.execPath,
      [cli, ...args, "--project", "qa", "--json", "--url", url],
      { cwd: directory },
    );
    return JSON.parse(stdout);
  };
  await writeFile(
    join(directory, "seed.png"),
    await readFile(
      resolve(import.meta.dirname, "../public/assets/paper-seed.png"),
    ),
  );
  assert.equal(
    (await command("upload", "seed.png"))[0].url,
    "/files/uploads/seed.png",
  );
  assert.equal((await command("gallery"))[0].prompt, "Exact image prompt");
  assert.equal((await command("results", "fixture")).generate[0].id, "image");
  assert.equal((await command("manifest", "run")).graph.id, "fixture");
  assert.equal(
    (await command("project", "update", "--name", "Renamed", "--clear-default"))
      .defaultWorkflowId,
    null,
  );
  const connection = {
    name: "Test",
    baseUrl: "http://localhost:9999/v1",
    models: [{ id: "fixture-model", capabilities: ["text"] }],
    apiKey: { action: "replace", value: "secret-not-returned" },
  };
  await writeFile(
    join(directory, "private-connection.json"),
    JSON.stringify(connection),
  );
  const created = await command(
    "providers",
    "create",
    "--from",
    "private-connection.json",
  );
  assert.equal(JSON.stringify(created).includes("secret-not-returned"), false);
  assert.equal(requests.at(-1).body.apiKey.value, "secret-not-returned");
  await command(
    "providers",
    "save",
    "api-test",
    "--from",
    "private-connection.json",
  );
  assert.equal(requests.at(-1).method, "PUT");
  assert.equal(
    (await command("providers", "test", "api-test")).models[0],
    "fixture-model",
  );
  await command("providers", "remove", "api-test");
  assert.equal(requests.at(-1).method, "DELETE");
  assert.equal((await command("search-status")).state, "ready");
  assert.equal((await command("search-retry")).state, "ready");
  // Full graph saving is the common API for every durable canvas edit.
  graph.nodes.find((node) => node.type === "prompt").data.text =
    "Changed through graph API";
  graph.nodes[0].position = { x: 123, y: 456 };
  await writeFile(join(directory, "graph.json"), JSON.stringify(graph));
  assert.equal(
    (await command("import", "--from", "graph.json")).nodes[0].position.x,
    123,
  );
  const snapshotFork = await command(
    "fork",
    "fixture",
    "--run",
    "run",
    "--name",
    "From recorded run",
  );
  assert.equal(snapshotFork.id, "forked");
  assert.equal(requests.at(-1).body.workflow.name, "Recorded snapshot");
  const client = new WeftClient({ url, projectId: "qa" });
  assert.equal(
    new TextDecoder().decode(await client.download("run")),
    "test-archive",
  );
  const before = requests.length;
  await assert.rejects(client.download("foreign"), /belongs to other/);
  assert.equal(requests.length, before + 1);
  assert.equal(
    requests.some((r) => r.url === "/api/runs/foreign/download"),
    false,
  );
  await assert.rejects(command("providers", "typo"), /Use providers/);
  await assert.rejects(
    command("project", "update", "--workflow", "fixture", "--clear-default"),
    /Choose --workflow/,
  );
  assert.equal(
    requests.some((r) => r.url === "/api/runs" && r.method === "POST"),
    false,
    "No inference submission",
  );
});
