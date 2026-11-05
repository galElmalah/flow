import { Worker } from "node:worker_threads";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { galleryItems, imageDocument, matchesSearch } from "./documents.mjs";

const transient = (message, code) =>
  Object.assign(new Error(message), { code });
function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export class GallerySearch {
  constructor({ store, dataRoot }) {
    this.store = store;
    this.dataRoot = dataRoot;
    this.pending = new Map();
    this.sequence = 0;
    this.generation = 0;
    this.state = {
      state: "loading",
      indexed: 0,
      total: 0,
      model: "Xenova/all-MiniLM-L6-v2",
    };
  }
  async start({ allowDownload = false } = {}) {
    const generation = this.generation;
    this.closing = false;
    await mkdir(path.join(this.dataRoot, "models"), { recursive: true });
    if (generation !== this.generation || this.closing)
      throw transient("Local search stopped during startup.", "SEARCH_CLOSED");
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: {
        filename: path.join(this.dataRoot, "search.sqlite"),
        cacheDir: path.join(this.dataRoot, "models"),
        allowDownload,
      },
    });
    this.worker = worker;
    worker.on("message", (message) => {
      if (this.worker !== worker || this.closing) return;
      if (message.event === "status") {
        this.state = message.status;
        return;
      }
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);
      task.cleanup();
      message.error
        ? task.reject(new Error(message.error))
        : task.resolve(message.result);
    });
    worker.on("error", (error) => {
      if (this.worker === worker && !this.closing) this.fail(error);
    });
    worker.on("exit", (code) => {
      if (this.worker === worker && !this.closing)
        this.fail(
          new Error(
            `Local search worker stopped (${code}). Retry search setup.`,
          ),
        );
    });
    this.refresh();
  }
  fail(error) {
    this.state = { ...this.state, state: "error", error: error.message };
    for (const task of this.pending.values()) {
      task.cleanup();
      task.reject(error);
    }
    this.pending.clear();
  }
  rpc(message, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.closing || !this.worker)
      return Promise.reject(
        transient("Local search is restarting.", "SEARCH_CLOSED"),
      );
    if (
      ["error", "setup-required"].includes(this.state.state) &&
      message.kind !== "catalog"
    )
      return Promise.reject(new Error(this.state.error));
    if (this.pending.size >= 32)
      return Promise.reject(
        transient("Search is busy. Try again shortly.", "SEARCH_BUSY"),
      );
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const worker = this.worker;
      const cancel = (error) => {
        if (!this.pending.delete(id)) return;
        cleanup();
        try {
          worker.postMessage({ kind: "cancel", requestId: id });
        } catch {}
        reject(error);
      };
      const abort = () => cancel(signal.reason);
      const timer = setTimeout(() => {
        cancel(
          transient(
            "Local search setup timed out. Retry search setup.",
            "SEARCH_TIMEOUT",
          ),
        );
      }, 120000);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        worker.postMessage({ ...message, id });
      } catch (error) {
        this.pending.delete(id);
        cleanup();
        reject(error);
      }
    });
  }
  snapshot() {
    return galleryItems(this.store.listRuns({ archived: "active" })).map(
      (item) => ({
        item,
        document: imageDocument(item),
      }),
    );
  }
  catalog(snapshot) {
    const documents = snapshot.map(({ document }) => document);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(documents))
      .digest("hex");
    if (this.catalogFingerprint === fingerprint && this.catalogTask)
      return this.catalogTask;
    const generation = this.generation;
    const previous = this.catalogTask || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(() => {
        if (generation !== this.generation)
          throw transient("Local search is restarting.", "SEARCH_CLOSED");
        return this.rpc({ kind: "catalog", documents });
      });
    this.catalogFingerprint = fingerprint;
    this.catalogTask = task;
    // Failed catalogues can be retried; successful identical ones need no writes.
    void task.catch(() => {
      if (this.catalogTask === task) {
        this.catalogTask = null;
        this.catalogFingerprint = null;
      }
    });
    return task;
  }
  refresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () =>
        this.catalog(this.snapshot()).catch((e) => {
          if (["SEARCH_BUSY", "SEARCH_TIMEOUT"].includes(e.code))
            this.refresh();
          else if (e.code !== "SEARCH_CLOSED") this.fail(e);
        }),
      150,
    );
    this.refreshTimer.unref();
  }
  status() {
    return this.state;
  }
  async search(request, { signal } = {}) {
    signal?.throwIfAborted();
    const snapshot = this.snapshot();
    await withSignal(this.catalog(snapshot), signal);
    if (["setup-required", "loading"].includes(this.state.state))
      return { items: [], total: 0, index: this.status() };
    const ranked = await this.rpc({ kind: "query", request }, { signal });
    const current = new Map(
      this.snapshot()
        .filter(({ item }) => matchesSearch(item, request))
        .map((entry) => [entry.document.key, entry]),
    );
    const items = ranked.matches.flatMap((hit) => {
      const entry = current.get(hit.key);
      return entry?.document.sourceHash === hit.sourceHash
        ? [
            {
              ...entry.item,
              similarity: hit.similarity,
              searchExcerpt: hit.excerpt,
            },
          ]
        : [];
    });
    return { items, total: ranked.total, index: this.status() };
  }
  retry() {
    if (this.retryTask) return this.retryTask;
    const task = (async () => {
      await this.close();
      this.state = {
        state: "loading",
        indexed: 0,
        total: 0,
        model: this.state.model,
      };
      await this.start({ allowDownload: true });
      return this.status();
    })();
    this.retryTask = task;
    void task
      .finally(() => {
        if (this.retryTask === task) this.retryTask = null;
      })
      .catch(() => {});
    return task;
  }
  close() {
    if (this.closeTask) return this.closeTask;
    clearTimeout(this.refreshTimer);
    this.closing = true;
    this.generation++;
    this.fail(new Error("Local search is restarting."));
    const worker = this.worker;
    this.worker = null;
    this.catalogTask = null;
    this.catalogFingerprint = null;
    const task = Promise.resolve(worker?.terminate());
    this.closeTask = task;
    void task
      .finally(() => {
        if (this.closeTask === task) this.closeTask = null;
      })
      .catch(() => {});
    return task;
  }
}
