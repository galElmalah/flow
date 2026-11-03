import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GallerySearch } from "../server/search/index.mjs";

const emptyStore = { listRuns: () => [] };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("concurrent retries share one replacement worker and close leaves no worker alive", async (t) => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "flow-search-lifecycle-"));
  const search = new GallerySearch({ store: emptyStore, dataRoot });
  const workers = [];
  const start = search.start.bind(search);
  search.start = async () => {
    await start();
    workers.push(search.worker);
  };
  t.after(async () => {
    await search.close();
    await Promise.all(workers.map((worker) => worker.terminate()));
    await rm(dataRoot, { recursive: true, force: true });
  });
  await search.start();
  await search.catalog([]);
  const first = search.retry(),
    second = search.retry();
  assert.equal(first, second);
  await Promise.all([first, second]);
  await search.catalog([]);
  assert.equal(
    workers.length,
    2,
    "only the initial and replacement worker were started",
  );
  assert.equal(workers[0].threadId, -1);
  assert.notEqual(workers[1].threadId, -1);
  const close = search.close();
  assert.equal(search.close(), close);
  await close;
  assert(workers.every((worker) => worker.threadId === -1));
  assert.equal(search.worker, null);
  assert.equal(search.pending.size, 0);
});

test("canceling query RPCs frees capacity, removes listeners and tells the worker which request ended", async () => {
  const search = new GallerySearch({ store: emptyStore, dataRoot: "/unused" });
  const messages = [];
  search.worker = { postMessage: (message) => messages.push(message) };
  for (let i = 0; i < 64; i++) {
    const controller = new AbortController();
    const pending = search.rpc(
      { kind: "query", request: { query: "scene" } },
      { signal: controller.signal },
    );
    const id = messages.at(-1).id;
    assert.equal(search.pending.size, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    controller.abort();
    await assert.rejects(pending, (error) => error.name === "AbortError");
    assert.equal(search.pending.size, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.deepEqual(messages.at(-1), { kind: "cancel", requestId: id });
  }
  const controller = new AbortController();
  controller.abort();
  const before = messages.length;
  await assert.rejects(
    search.rpc({ kind: "query" }, { signal: controller.signal }),
    (error) => error.name === "AbortError",
  );
  assert.equal(
    messages.length,
    before,
    "already aborted calls do not enter the worker queue",
  );
});

test("one search can abort a shared catalog wait without canceling another search", async () => {
  const search = new GallerySearch({ store: emptyStore, dataRoot: "/unused" });
  const catalog = deferred();
  const messages = [];
  search.rpc = async (message) => {
    messages.push(message);
    return message.kind === "catalog"
      ? catalog.promise
      : { matches: [], total: 0 };
  };
  const controller = new AbortController();
  const canceled = search.search(
    { query: "scene" },
    { signal: controller.signal },
  );
  const continued = search.search({ query: "scene" });
  controller.abort();
  await assert.rejects(canceled, (error) => error.name === "AbortError");
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  catalog.resolve(true);
  assert.deepEqual((await continued).items, []);
  assert.equal(
    messages.filter((message) => message.kind === "catalog").length,
    1,
  );
  assert.equal(
    messages.filter((message) => message.kind === "query").length,
    1,
  );
});

test("catalogs reuse identical snapshots and serialize changed ownership and content", async () => {
  const search = new GallerySearch({ store: emptyStore, dataRoot: "/unused" });
  const first = deferred();
  const messages = [];
  search.rpc = async (message) => {
    messages.push(message);
    return messages.length === 1 ? first.promise : true;
  };
  const initial = [
    { document: { key: "r/j", sourceHash: "one", projectId: "first" } },
  ];
  const changedOwner = [
    { document: { ...initial[0].document, projectId: "second" } },
  ];
  const changedContent = [
    { document: { ...changedOwner[0].document, sourceHash: "two" } },
  ];
  const a = search.catalog(initial);
  assert.equal(search.catalog(initial), a);
  const b = search.catalog(changedOwner);
  const c = search.catalog(changedContent);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    messages.length,
    1,
    "newer catalogs wait for the current reconciliation",
  );
  first.resolve(true);
  await Promise.all([a, b, c]);
  assert.deepEqual(
    messages.map((message) => message.documents[0].projectId),
    ["first", "second", "second"],
  );
  assert.deepEqual(
    messages.map((message) => message.documents[0].sourceHash),
    ["one", "one", "two"],
  );
  await search.catalog(changedContent);
  assert.equal(
    messages.length,
    3,
    "unchanged successful catalog does not rewrite the index",
  );
});

test("a transient catalog capacity error can be retried without poisoning search state", async () => {
  const search = new GallerySearch({ store: emptyStore, dataRoot: "/unused" });
  search.state = { ...search.state, state: "ready" };
  let calls = 0;
  search.rpc = async () => {
    if (++calls === 1)
      throw Object.assign(new Error("Search is busy"), { code: "SEARCH_BUSY" });
    return true;
  };
  await assert.rejects(search.catalog([]), /Search is busy/);
  await search.catalog([]);
  assert.equal(calls, 2);
  assert.equal(search.status().state, "ready");
});

test("background refresh retries transient capacity errors instead of failing the index", async (t) => {
  const search = new GallerySearch({ store: emptyStore, dataRoot: "/unused" });
  search.state = { ...search.state, state: "ready" };
  const refreshed = deferred();
  let calls = 0;
  search.catalog = async () => {
    if (++calls === 1)
      throw Object.assign(new Error("Search is busy"), { code: "SEARCH_BUSY" });
    refreshed.resolve();
  };
  t.after(() => search.close());
  const timeout = setTimeout(
    () => refreshed.reject(new Error("Refresh did not retry")),
    1500,
  );
  t.after(() => clearTimeout(timeout));
  search.refresh();
  await refreshed.promise;
  assert.equal(calls, 2);
  assert.equal(search.status().state, "ready");
});
