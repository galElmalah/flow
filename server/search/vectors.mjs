import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";

export class VectorIndex {
  constructor(filename, version, dimensions = 384) {
    this.version = version;
    this.dimensions = dimensions;
    this.db = new DatabaseSync(filename, { allowExtension: true });
    sqliteVec.load(this.db);
    this.db.enableLoadExtension(false);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (
        key TEXT PRIMARY KEY, source_hash TEXT NOT NULL, document TEXT NOT NULL,
        project_id TEXT, workflow_id TEXT, run_id TEXT NOT NULL, provider_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS search_scope ON documents(project_id, workflow_id, run_id, provider_id);
      CREATE TABLE IF NOT EXISTS chunks (
        document_key TEXT NOT NULL, source_hash TEXT NOT NULL, version TEXT NOT NULL,
        ordinal INTEGER NOT NULL, text TEXT NOT NULL, vector BLOB NOT NULL, weight REAL NOT NULL DEFAULT 1,
        PRIMARY KEY(document_key, ordinal));`);
    if (
      !this.db
        .prepare("PRAGMA table_info(chunks)")
        .all()
        .some((column) => column.name === "weight")
    )
      this.db.exec(
        "ALTER TABLE chunks ADD COLUMN weight REAL NOT NULL DEFAULT 1",
      );
  }
  reconcile(documents) {
    const keys = new Set(documents.map((d) => d.key));
    const write = this.db.prepare(`INSERT INTO documents VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET source_hash=excluded.source_hash, document=excluded.document,
      project_id=excluded.project_id, workflow_id=excluded.workflow_id,
      run_id=excluded.run_id, provider_id=excluded.provider_id`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const d of documents)
        write.run(
          d.key,
          d.sourceHash,
          JSON.stringify(d),
          d.projectId,
          d.workflowId,
          d.runId,
          d.providerId,
        );
      for (const { key } of this.db.prepare("SELECT key FROM documents").all())
        if (!keys.has(key))
          this.db.prepare("DELETE FROM documents WHERE key=?").run(key);
      this.db
        .prepare(
          `DELETE FROM chunks WHERE version<>? OR NOT EXISTS
        (SELECT 1 FROM documents d WHERE d.key=chunks.document_key AND d.source_hash=chunks.source_hash)`,
        )
        .run(this.version);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  pending() {
    return this.db
      .prepare(
        `SELECT document FROM documents d WHERE NOT EXISTS
      (SELECT 1 FROM chunks c WHERE c.document_key=d.key AND c.source_hash=d.source_hash AND c.version=?) LIMIT 1`,
      )
      .get(this.version);
  }
  commit(document, vectors) {
    const current = this.db
      .prepare("SELECT source_hash FROM documents WHERE key=?")
      .get(document.key);
    if (current?.source_hash !== document.sourceHash) return false;
    if (vectors.length !== document.chunks.length)
      throw new Error("Embedding batch is incomplete.");
    const encoded = vectors.map((values) => {
      if (
        values.length !== this.dimensions ||
        !Array.from(values).every(Number.isFinite) ||
        !Array.from(values).some((v) => v !== 0)
      )
        throw new Error("Invalid local embedding vector.");
      return new Uint8Array(Float32Array.from(values).buffer);
    });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM chunks WHERE document_key=?")
        .run(document.key);
      const write = this.db.prepare(
        "INSERT INTO chunks VALUES (?,?,?,?,?,?,?)",
      );
      document.chunks.forEach((text, i) =>
        write.run(
          document.key,
          document.sourceHash,
          this.version,
          i,
          text,
          encoded[i],
          document.weights?.[i] ?? 1,
        ),
      );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return true;
  }
  coverage() {
    return this.db
      .prepare(
        `SELECT count(*) total, sum(EXISTS
      (SELECT 1 FROM chunks c WHERE c.document_key=d.key AND c.source_hash=d.source_hash AND c.version=?)) AS "indexed"
      FROM documents d`,
      )
      .get(this.version);
  }
  search(vector, request) {
    const {
      query,
      scope = "all",
      workflowId,
      runId,
      providerId,
      limit = 100,
    } = request;
    const where = ["c.version=?", "c.source_hash=d.source_hash"];
    const args = [
      new Uint8Array(Float32Array.from(vector).buffer),
      this.version,
    ];
    if (scope === "unassigned") where.push("d.project_id IS NULL");
    else if (scope.startsWith("project:")) {
      where.push("d.project_id=?");
      args.push(scope.slice(8));
    } else if (scope.startsWith("workflow:")) {
      where.push("d.workflow_id=?");
      args.push(scope.slice(9));
    }
    for (const [name, value] of [
      ["workflow_id", workflowId],
      ["run_id", runId],
      ["provider_id", providerId],
    ])
      if (value) {
        where.push(`d.${name}=?`);
        args.push(value);
      }
    // SQL filters eligibility before cosine ranking; best passage wins per image.
    const rows = this.db
      .prepare(
        `SELECT d.key, d.source_hash sourceHash, d.document, c.text excerpt,
      1-vec_distance_cosine(c.vector,?) similarity, c.weight FROM chunks c JOIN documents d ON d.key=c.document_key
      WHERE ${where.join(" AND ")} ORDER BY similarity*c.weight DESC`,
      )
      .all(...args);
    const best = new Map();
    const needle = query.toLowerCase();
    for (const row of rows) {
      if (best.has(row.key)) continue;
      const exact = JSON.parse(row.document).exact.includes(needle);
      if (row.similarity < 0.23 && !exact) continue;
      best.set(row.key, {
        key: row.key,
        sourceHash: row.sourceHash,
        similarity: row.similarity,
        score: row.similarity * row.weight + (exact ? 0.16 : 0),
        excerpt: row.excerpt,
      });
    }
    const matches = [...best.values()].sort(
      (a, b) => b.score - a.score || a.key.localeCompare(b.key),
    );
    return { matches: matches.slice(0, limit), total: matches.length };
  }
  close() {
    this.db.close();
  }
}
