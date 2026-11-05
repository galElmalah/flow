import { parentPort, workerData } from "node:worker_threads";
import { VectorIndex } from "./vectors.mjs";
import { projectionVersion } from "./documents.mjs";
import { loadSearchModel, model, revision } from "./model.mjs";

const version = `${model}@${revision}:q8:mean:normalized:projection-${projectionVersion}`;
const index = new VectorIndex(workerData.filename, version);
const queries = [],
  cache = new Map();
let extractor,
  modelPromise,
  pumping = false,
  failure = null;
function status(state) {
  const coverage = index.coverage();
  parentPort.postMessage({
    event: "status",
    status: {
      state: failure
        ? workerData.allowDownload
          ? "error"
          : "setup-required"
        : state,
      indexed: coverage.indexed || 0,
      total: coverage.total,
      model,
      version,
      ...(failure ? { error: failure } : {}),
    },
  });
}
async function prepare() {
  if (!modelPromise) {
    status("loading");
    modelPromise = loadSearchModel({
      cacheDir: workerData.cacheDir,
      allowDownload: workerData.allowDownload,
    });
  }
  extractor ||= await modelPromise;
  return extractor;
}
async function embed(texts) {
  await prepare();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}
async function pump() {
  if (pumping || failure) return;
  pumping = true;
  try {
    await prepare();
    for (;;) {
      const query = queries.shift();
      if (query) {
        try {
          let vector = cache.get(query.request.query);
          if (!vector) {
            [vector] = await embed([query.request.query]);
            if (cache.size >= 64) cache.delete(cache.keys().next().value);
            cache.set(query.request.query, vector);
          }
          parentPort.postMessage({
            id: query.id,
            result: index.search(vector, query.request),
          });
        } catch (e) {
          parentPort.postMessage({ id: query.id, error: e.message });
          throw e;
        }
      } else {
        const next = index.pending();
        if (!next) {
          status("ready");
          break;
        }
        const doc = JSON.parse(next.document);
        status("indexing");
        const vectors = [];
        for (let i = 0; i < doc.chunks.length; i += 8)
          vectors.push(...(await embed(doc.chunks.slice(i, i + 8))));
        index.commit(doc, vectors);
        status("indexing");
      }
      // Let catalog changes and interactive queries enter between inference batches.
      await new Promise((resolve) => setImmediate(resolve));
    }
  } catch (e) {
    failure = workerData.allowDownload
      ? `Local search setup failed: ${e.message}. Run flow search-retry to retry the model download.`
      : "Local search model is not available in the cache. Download it with flow search-retry or Download search model in the gallery.";
    for (const query of queries.splice(0))
      parentPort.postMessage({ id: query.id, error: failure });
    status("error");
  } finally {
    pumping = false;
  }
}
parentPort.on("message", (message) => {
  try {
    if (message.kind === "cancel") {
      const position = queries.findIndex(
        (query) => query.id === message.requestId,
      );
      if (position >= 0) queries.splice(position, 1);
      return;
    }
    if (message.kind === "catalog") {
      index.reconcile(message.documents);
      parentPort.postMessage({ id: message.id, result: true });
      if (failure) status("error");
    } else {
      if (failure) throw new Error(failure);
      queries.push(message);
    }
    void pump();
  } catch (e) {
    parentPort.postMessage({ id: message.id, error: e.message });
  }
});
status("loading");
void pump();
