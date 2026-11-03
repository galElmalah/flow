import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { OllamaText } from "../harness-integrations/ollama/index.mjs";

async function fixture(
  t,
  { capabilities = ["completion"], thinking, remote = false, stream } = {},
) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = text && JSON.parse(text);
    calls.push({ url: req.url, body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags")
      res.end(
        JSON.stringify({
          models: [
            { name: "small:latest", digest: "sha256:test", size: 1234 },
            { name: "remote:cloud" },
          ],
        }),
      );
    else if (req.url === "/api/show")
      res.end(
        JSON.stringify({
          capabilities,
          ...(thinking && { thinking }),
          ...(remote
            ? { remote_model: "remote", remote_host: "https://ollama.com" }
            : {}),
        }),
      );
    else if (req.url === "/api/chat") {
      res.setHeader("content-type", "application/x-ndjson");
      if (stream) return stream(res);
      res.write(
        JSON.stringify({
          message: { content: "A cyclist ", thinking: "secret reasoning" },
        }) + "\n",
      );
      res.end(
        JSON.stringify({
          message: { content: "in motion." },
          model: "small:latest",
          done: true,
          done_reason: "stop",
          eval_count: 5,
          total_duration: 1000,
        }) + "\n",
      );
    } else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    adapter: new OllamaText({
      runtimes: {
        getConfig: async () => ({ baseUrl }),
        status: async () => ({ running: true, installed: false }),
      },
    }),
    calls,
  };
}
const job = {
  kind: "text",
  providerId: "ollama",
  model: "small:latest",
  prompt: "Describe a cyclist",
  images: [],
  seed: 17,
};
test("Ollama discovers local completion/vision facts and streams visible text with observed model lineage", async (t) => {
  const { adapter, calls } = await fixture(t, {
    capabilities: ["completion", "vision"],
  });
  const catalog = await adapter.catalog();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].acceptsImages, true);
  assert.equal(catalog[0].modelDigest, "sha256:test");
  const preview = [];
  const result = await adapter.run({
    job,
    onText: (text) => preview.push(text),
  });
  assert.equal(result.text, "A cyclist in motion.");
  assert.deepEqual(preview, ["A cyclist ", "A cyclist in motion."]);
  assert.equal(
    result.metadata.effectiveSettings.modelDigestObserved,
    "sha256:test",
  );
  assert.equal(result.metadata.usage.eval_count, 5);
  assert.ok(!JSON.stringify(result).includes("secret reasoning"));
  const request = calls.find((call) => call.url === "/api/chat").body;
  assert.equal(request.options.seed, 17);
  assert.equal(request.think, false);
  assert.equal(request.messages[0].content, job.prompt);
});
test("Ollama rejects cloud proxies, unsupported vision and embedding-only models before inference", async (t) => {
  const { adapter, calls } = await fixture(t);
  await assert.rejects(
    adapter.preflight({ ...job, images: [{}] }),
    /no vision/,
  );
  await assert.rejects(
    adapter.preflight({ ...job, model: "large:cloud" }),
    /cloud model/,
  );
  assert.equal(calls.filter((call) => call.url === "/api/chat").length, 0);
  const remote = await fixture(t, { remote: true });
  assert.deepEqual(await remote.adapter.catalog(), []);
  await assert.rejects(remote.adapter.preflight(job), /runs remotely/);
  const embeddings = await fixture(t, { capabilities: ["embedding"] });
  assert.deepEqual(await embeddings.adapter.catalog(), []);
});
test("Ollama incomplete and truncated answers remain failures with partial preview", async (t) => {
  const previews = [];
  const { adapter } = await fixture(t, {
    stream(res) {
      res.end(JSON.stringify({ message: { content: "Partial" } }) + "\n");
    },
  });
  await assert.rejects(
    adapter.run({ job, onText: (text) => previews.push(text) }),
    /before a complete answer/,
  );
  assert.deepEqual(previews, ["Partial"]);
  const truncated = await fixture(t, {
    stream(res) {
      res.end(
        JSON.stringify({
          message: { content: "Incomplete" },
          done: true,
          done_reason: "length",
        }) + "\n",
      );
    },
  });
  await assert.rejects(truncated.adapter.run({ job }), /did not complete/);
});

test("Ollama publishes exact model thinking controls and sends booleans, named levels or the model default", async (t) => {
  for (const [values, effort, expected] of [
    [[false, true], "on", true],
    [[false, true], "off", false],
    [["low", "medium", "high"], "high", "high"],
    [[false, true], "inherit", undefined],
  ]) {
    const { adapter, calls } = await fixture(t, {
      capabilities: ["completion", "thinking"],
      thinking: { values, default: values[0] },
    });
    const catalog = await adapter.catalog();
    assert.ok(catalog[0].reasoning.levels.length);
    await adapter.run({ job: { ...job, reasoningEffort: effort } });
    const request = calls.find((call) => call.url === "/api/chat").body;
    assert.equal(request.think, expected);
    assert.equal(Object.hasOwn(request, "think"), expected !== undefined);
  }
  const { adapter, calls } = await fixture(t, {
    capabilities: ["completion", "thinking"],
    thinking: { values: [false, true], default: true },
  });
  await assert.rejects(
    adapter.run({ job: { ...job, reasoningEffort: "high" } }),
    /does not support/,
  );
  assert.equal(
    calls.some((call) => call.url === "/api/chat"),
    false,
  );
});
