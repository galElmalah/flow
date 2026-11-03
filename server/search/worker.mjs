import { parentPort, workerData } from "node:worker_threads";
import { pipeline, env } from "@huggingface/transformers";
import { VectorIndex } from "./vectors.mjs";
import { projectionVersion } from "./documents.mjs";

const model = "Xenova/all-MiniLM-L6-v2";
const revision = "751bff37182d3f1213fa05d7196b954e230abad9";
const version = `${model}@${revision}:q8:mean:normalized:projection-${projectionVersion}`;
env.cacheDir = workerData.cacheDir;
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
      state: failure ? "error" : state,
      indexed: coverage.indexed || 0,
      total: coverage.total,
      model,
      version,
      ...(failure ? { error: failure } : {}),
    },
  });
}
async function embed(texts) {
  if (!modelPromise) {
    status("loading");
    modelPromise = pipeline("feature-extraction", model, {
      revision,
      dtype: "q8",
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    });
  }
  extractor ||= await modelPromise;
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}
async function pump() {
  if (pumping || failure) return;
  pumping = true;
  try {
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
    failure = `Local semantic search: ${e.message}`;
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
    if (failure) throw new Error(failure);
    if (message.kind === "catalog") {
      index.reconcile(message.documents);
      parentPort.postMessage({ id: message.id, result: true });
    } else queries.push(message);
    void pump();
  } catch (e) {
    parentPort.postMessage({ id: message.id, error: e.message });
  }
});
status("loading");
