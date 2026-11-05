import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AutoConfig, env } from "@huggingface/transformers";
import { loadSearchModel, model, revision } from "../server/search/model.mjs";

test("search reuses cached model configuration offline and only explicit setup allows downloads", async (t) => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "flow-search-cache-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const modelDirectory = path.join(cacheDir, model, revision);
  await mkdir(modelDirectory, { recursive: true });
  await writeFile(
    path.join(modelDirectory, "config.json"),
    JSON.stringify({ model_type: "bert", hidden_size: 8 }),
  );
  const originalFetch = env.fetch;
  let requests = 0;
  env.fetch = async () => {
    requests++;
    throw new Error("Network must not be used for cached models");
  };
  t.after(() => {
    env.fetch = originalFetch;
  });
  const calls = [];
  const load = async (...args) => {
    calls.push({ args, remote: env.allowRemoteModels, cache: env.cacheDir });
    const config = await AutoConfig.from_pretrained(args[1], args[2]);
    return async () => config.hidden_size;
  };
  for (const allowDownload of [undefined, true, false]) {
    const extractor = await loadSearchModel({
      cacheDir,
      ...(allowDownload !== undefined && { allowDownload }),
      load,
    });
    assert.equal(await extractor(), 8);
  }
  assert.equal(requests, 0);
  assert.deepEqual(
    calls.map((call) => call.remote),
    [false, true, false],
  );
  for (const [i, call] of calls.entries()) {
    assert.equal(call.cache, cacheDir);
    assert.deepEqual(call.args.slice(0, 2), ["feature-extraction", model]);
    assert.equal(call.args[2].revision, revision);
    assert.equal(call.args[2].local_files_only, i !== 1);
  }
});

test(
  "cold galleries never fetch models; explicit setup eagerly downloads and failed attempts remain retryable",
  { timeout: 20000 },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "flow-search-setup-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const guard = path.join(directory, "block-network.mjs");
    const networkLog = path.join(directory, "network.jsonl");
    await writeFile(
      guard,
      `
    import { appendFileSync } from "node:fs";
    globalThis.fetch = async (url) => {
      appendFileSync(${JSON.stringify(networkLog)}, JSON.stringify(String(url)) + "\\n");
      throw new Error("External fetch blocked by search setup test");
    };
  `,
    );
    const searchModule = new URL("../server/search/index.mjs", import.meta.url)
      .href;
    const code = `
    import assert from "node:assert/strict";
    import { readFile, readdir } from "node:fs/promises";
    import { setTimeout } from "node:timers/promises";
    import { GallerySearch } from ${JSON.stringify(searchModule)};
    const dataRoot = ${JSON.stringify(directory)};
    const network = async () => (await readFile(${JSON.stringify(networkLog)}, "utf8").catch(() => "")).trim();
    const store = { listRuns: () => [{ id: "run", jobs: [{ id: "image", kind: "image", status: "completed", output: "/files/output.png", prompt: "A violet paper study" }] }] };
    let search = new GallerySearch({ store, dataRoot });
    const until = async (state, total) => {
      for (let i = 0; i < 400; i++) {
        if (search.status().state === state && (total === undefined || search.status().total === total)) return;
        await setTimeout(20);
      }
      throw new Error("Search did not reach " + state + ": " + JSON.stringify(search.status()));
    };
    try {
      await search.start();
      await search.catalog(search.snapshot());
      await until("setup-required", 1);
      assert.equal(search.status().total, 1);
      assert.match(search.status().error, /flow search-retry/);
      assert.equal((await search.search({ query: "violet" })).index.state, "setup-required");
      assert.equal(await network(), "", "startup, gallery indexing and queries cannot download weights");
      await search.close();
      search = new GallerySearch({ store: { listRuns: () => [] }, dataRoot });
      await search.start();
      await until("setup-required");
      const a = search.retry();
      assert.equal(search.retry(), a);
      await a;
      await until("error");
      assert.match(search.status().error, /setup failed.*External fetch blocked/);
      const firstAttempt = await network();
      assert.match(firstAttempt, /huggingface.co/);
      await search.retry();
      await until("error");
      const attempts = await network();
      assert(attempts.length > firstAttempt.length, "failed downloads can be retried without restarting the app");
      await search.close();
      search = new GallerySearch({ store, dataRoot });
      await search.start();
      await until("setup-required");
      assert.equal(await network(), attempts, "a later normal start has no download permission");
      assert.deepEqual(await readdir(dataRoot + "/models"), []);
    } finally { await search.close(); }
  `;
    const script = path.join(directory, "trial.mjs");
    await writeFile(script, code);
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", guard, script],
      { timeout: 18000 },
    );
    assert.equal(result.stdout, "");
  },
);
