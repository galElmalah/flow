export class WorkflowSaver {
  constructor({ save, onState = () => {}, delay = 650 }) {
    this.save = save;
    this.onState = onState;
    this.delay = delay;
    this.entries = new Map();
  }
  seed(graph, { fresh = false } = {}) {
    const entry = this.entries.get(graph.id);
    if (
      !entry ||
      (fresh && !entry.promise && entry.saved === entry.serialized)
    ) {
      const serialized = JSON.stringify(graph);
      this.entries.set(graph.id, {
        graph: structuredClone(graph),
        serialized,
        saved: serialized,
        timer: null,
        promise: null,
        error: null,
      });
    }
    return this.draft(graph.id);
  }
  draft(id) {
    return structuredClone(this.entries.get(id)?.graph);
  }
  status(id) {
    const entry = this.entries.get(id);
    return entry?.error
      ? "error"
      : entry && entry.serialized !== entry.saved
        ? "saving"
        : "saved";
  }
  emit(id) {
    const entry = this.entries.get(id);
    this.onState({
      id,
      graph: this.draft(id),
      status: this.status(id),
      error: entry.error,
    });
  }
  stage(graph) {
    const previous = this.entries.get(graph.id);
    if (previous?.graph.revision !== undefined)
      graph = { ...graph, revision: previous.graph.revision };
    const serialized = JSON.stringify(graph);
    let entry = this.entries.get(graph.id);
    if (entry?.serialized === serialized) return;
    if (!entry) {
      entry = { saved: "", timer: null, promise: null };
      this.entries.set(graph.id, entry);
    }
    entry.graph = structuredClone(graph);
    entry.serialized = serialized;
    entry.error = null;
    clearTimeout(entry.timer);
    if (entry.saved !== serialized) {
      entry.timer = setTimeout(
        () => this.flush(graph.id).catch(() => {}),
        this.delay,
      );
      entry.timer.unref?.();
    }
    this.emit(graph.id);
  }
  flush(id) {
    const entry = this.entries.get(id);
    if (!entry) return Promise.resolve();
    clearTimeout(entry.timer);
    if (entry.promise) return entry.promise;
    if (entry.saved === entry.serialized) return Promise.resolve();
    entry.error = null;
    this.emit(id);
    entry.promise = (async () => {
      try {
        while (entry.saved !== entry.serialized) {
          const snapshot = entry.serialized;
          const result = await this.save(JSON.parse(snapshot));
          if (Number.isInteger(result?.revision)) {
            entry.graph = { ...entry.graph, revision: result.revision };
            entry.serialized = JSON.stringify(entry.graph);
            entry.saved = JSON.stringify({
              ...JSON.parse(snapshot),
              revision: result.revision,
            });
          } else entry.saved = snapshot;
          this.emit(id);
        }
      } catch (error) {
        entry.error = error;
        this.emit(id);
        throw error;
      } finally {
        entry.promise = null;
      }
    })();
    return entry.promise;
  }
  flushAll() {
    return Promise.allSettled(
      [...this.entries.keys()].map((id) => this.flush(id)),
    );
  }
  hasPending() {
    return [...this.entries.values()].some(
      (entry) => entry.saved !== entry.serialized,
    );
  }
}
