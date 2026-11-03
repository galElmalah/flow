import { mkdir, readFile, writeFile, rename, readdir, stat, copyFile, chmod } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { builtInRules, ruleTemplateSchema } from "../shared/rule-templates.mjs";
import { jobResultScope } from "../shared/job-results.mjs";
export class Store {
  constructor(root) {
    this.root = root;
    this.workflows = new Map();
    this.runs = new Map();
    this.projects = new Map();
    this.writes = new Map();
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    for (const name of ["workflows", "runs", "uploads"])
      await mkdir(path.join(this.root, name), { recursive: true });
    this.databasePath = path.join(this.root, "flow.sqlite");
    const legacyDatabase = path.join(this.root, "weft.sqlite");
    const present = async (file) => Boolean(await stat(file).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    }));
    if (await present(legacyDatabase) || await present(legacyDatabase + "-wal") || await present(legacyDatabase + "-shm")) {
      if (await present(legacyDatabase) && await present(this.databasePath))
        throw new Error("Both legacy and Flow databases exist. Resolve the storage conflict before starting.");
      const backup = path.join(this.root, "migration-backup", "database");
      await mkdir(backup, { recursive: true, mode: 0o700 });
      for (const suffix of ["", "-wal", "-shm"]) {
        if (!(await present(legacyDatabase + suffix))) continue;
        if (await present(this.databasePath + suffix))
          throw new Error("Conflicting database sidecars found; neither database was opened.");
        await copyFile(legacyDatabase + suffix, path.join(backup, "legacy.sqlite" + suffix));
        await rename(legacyDatabase + suffix, this.databasePath + suffix);
      }
    }
    this.db = new DatabaseSync(this.databasePath);
    await chmod(this.databasePath, 0o600);
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (version > 3) {
      this.db.close();
      throw new Error("This database needs a newer Flow server.");
    }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
        updated_at TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document))
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, workflow_id TEXT, status TEXT NOT NULL,
        created_at TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document))
      );
      CREATE INDEX IF NOT EXISTS runs_workflow_created ON runs(workflow_id, created_at);
      CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
      CREATE VIEW IF NOT EXISTS jobs AS
        SELECT runs.id AS run_id, json_extract(job.value, '$.id') AS id,
          json_extract(job.value, '$.nodeId') AS node_id,
          json_extract(job.value, '$.kind') AS kind,
          json_extract(job.value, '$.status') AS status, job.value AS document
        FROM runs, json_each(runs.document, '$.jobs') AS job;
    `);
    if (version < 2) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
          CREATE TABLE projects (
            id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            document TEXT NOT NULL CHECK(json_valid(document))
          );
          ALTER TABLE workflows ADD COLUMN project_id TEXT;
          ALTER TABLE runs ADD COLUMN project_id TEXT;
          CREATE INDEX workflows_project ON workflows(project_id);
          CREATE INDEX runs_project_created ON runs(project_id, created_at);
          PRAGMA user_version = 2;
        `);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, project_id TEXT, url TEXT NOT NULL,
        created_at TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document))
      );
      CREATE INDEX IF NOT EXISTS assets_project_url ON assets(project_id, url);
      CREATE TABLE IF NOT EXISTS asset_annotations (
        asset_id TEXT PRIMARY KEY REFERENCES assets(id), revision INTEGER NOT NULL,
        document TEXT NOT NULL CHECK(json_valid(document))
      );
      PRAGMA user_version = 3;
      COMMIT;
    `);
    this.workflowWrite = this.db
      .prepare(`INSERT INTO workflows (id, name, parent_id, updated_at, document, project_id)
        VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_id=excluded.parent_id,
        updated_at=excluded.updated_at, document=excluded.document, project_id=excluded.project_id`);
    this.runWrite = this.db
      .prepare(`INSERT INTO runs (id, workflow_id, status, created_at, document, project_id)
        VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET workflow_id=excluded.workflow_id,
        status=excluded.status, created_at=excluded.created_at, document=excluded.document,
        project_id=excluded.project_id`);
    this.projectWrite = this.db.prepare(`INSERT INTO projects
        (id, root, name, created_at, updated_at, document) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET root=excluded.root, name=excluded.name,
        updated_at=excluded.updated_at, document=excluded.document`);
    if (
      !this.db
        .prepare("SELECT value FROM metadata WHERE key='json_imported'")
        .get()
    ) {
      // Read everything before the transaction: a failed import leaves JSON untouched.
      const workflows = [],
        runs = [];
      for (const file of await readdir(path.join(this.root, "workflows")))
        if (file.endsWith(".json"))
          workflows.push(
            JSON.parse(
              await readFile(path.join(this.root, "workflows", file), "utf8"),
            ),
          );
      for (const dir of await readdir(path.join(this.root, "runs"))) {
        try {
          runs.push(
            JSON.parse(
              await readFile(
                path.join(this.root, "runs", dir, "run.json"),
                "utf8",
              ),
            ),
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const g of workflows) this.persistWorkflow(g);
        for (const run of runs) this.persistRun(run);
        this.db
          .prepare(
            "INSERT INTO metadata (key, value) VALUES ('json_imported', ?)",
          )
          .run(new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    for (const row of this.db.prepare("SELECT document FROM projects").all()) {
      const project = JSON.parse(row.document);
      this.projects.set(project.id, project);
    }
    for (const row of this.db.prepare("SELECT document FROM workflows").all()) {
      const g = JSON.parse(row.document);
      this.workflows.set(g.id, g);
    }
    const archived = this.db
      .prepare("SELECT value FROM metadata WHERE key='workspace_archive'")
      .get();
    this.archived = new Map(
      (archived ? JSON.parse(archived.value) : []).map((entry) => [
        `${entry.kind}:${entry.id}`,
        entry,
      ]),
    );
    for (const row of this.db.prepare("SELECT document FROM runs").all()) {
      const run = JSON.parse(row.document);
      let interrupted = false,
        migrated = false;
      for (const j of run.jobs) {
        j.kind ||= "image";
        if (j.videoOperation) {
          const { interactionId, ...operation } = j.videoOperation;
          j.providerOperation = {
            ...operation,
            providerId: j.providerId || "gemini-video",
            ...(interactionId && { id: interactionId }),
          };
          delete j.videoOperation;
          migrated = true;
        }
        if (["running", "queued", "retrying"].includes(j.status)) {
          j.status = "interrupted";
          interrupted = true;
        }
      }
      if (interrupted) {
        run.status = "interrupted";
        run.error =
          "The server stopped during this run. Resume to continue unfinished jobs.";
      }
      this.runs.set(run.id, run);
      if (interrupted || migrated) await this.saveRun(run);
    }
  }
  persistWorkflow(g) {
    this.workflowWrite.run(
      g.id,
      g.name,
      g.forkedFrom?.workflowId || null,
      new Date().toISOString(),
      JSON.stringify(g),
      g.projectId || null,
    );
  }
  persistRun(run) {
    this.runWrite.run(
      run.id,
      run.workflowId || null,
      run.status,
      run.createdAt,
      JSON.stringify(run),
      run.projectId || null,
    );
  }
  storageInfo() {
    return {
      engine: "sqlite",
      path: this.databasePath,
      schemaVersion: 3,
      projects: this.projects.size,
      workflows: this.workflows.size,
      runs: this.runs.size,
    };
  }
  setArchived(kind, ids, archived, reason) {
    const entries = new Map(this.archived);
    for (const id of ids) {
      const key = `${kind}:${id}`;
      if (archived && !entries.has(key))
        entries.set(key, {
          kind,
          id,
          archivedAt: new Date().toISOString(),
          ...(reason && { reason }),
        });
      else if (!archived) entries.delete(key);
    }
    this.db
      .prepare(
        "INSERT INTO metadata (key,value) VALUES ('workspace_archive',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify([...entries.values()]));
    this.archived = entries;
  }
  isProjectArchived(id) {
    return Boolean(id) && this.archived.has(`project:${id}`);
  }
  isWorkflowArchived(id) {
    if (!id) return false;
    return (
      this.archived.has(`workflow:${id}`) ||
      this.isProjectArchived(this.workflows.get(id)?.projectId)
    );
  }
  listWorkflows(archived = "active") {
    return [...this.workflows.values()].filter(
      (graph) =>
        archived === "all" ||
        this.isWorkflowArchived(graph.id) === (archived === "archived"),
    );
  }
  styleLibraryState() {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key = 'style_library'")
      .get();
    return row ? JSON.parse(row.value) : {};
  }
  saveStyleLibraryEntry(id, changes) {
    const state = this.styleLibraryState();
    state[id] = { ...(state[id] || {}), ...changes };
    this.db
      .prepare(
        "INSERT INTO metadata (key,value) VALUES ('style_library',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(state));
    return state[id];
  }
  listRuleTemplates() {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key = 'rule_templates'")
      .get();
    return row ? JSON.parse(row.value) : [];
  }
  saveRuleTemplate(input) {
    const template = ruleTemplateSchema.parse(input);
    if (builtInRules.some((rule) => rule.id === template.id))
      throw new Error(
        "Built-in rules cannot be overwritten. Save a custom rule with a new ID.",
      );
    const rules = this.listRuleTemplates();
    const index = rules.findIndex((rule) => rule.id === template.id);
    if (index >= 0) rules[index] = template;
    else {
      if (rules.length >= 500)
        throw new Error(
          "The local rule library can contain at most 500 custom rules.",
        );
      rules.push(template);
    }
    this.db
      .prepare(
        "INSERT INTO metadata (key, value) VALUES ('rule_templates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify(rules));
    return template;
  }
  imageEditRequest(editorId, requestId) {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get(`image_editor:${editorId}`);
    if (!row) return null;
    const editor = JSON.parse(row.value),
      request = editor.requests?.find((request) => request.id === requestId);
    return request
      ? { projectId: editor.projectId || editor.source?.projectId, request }
      : null;
  }
  assetRecords({ projectId, url } = {}) {
    return this.db
      .prepare(
        "SELECT document FROM assets WHERE (?=0 OR project_id IS ?) AND (? IS NULL OR url=?) ORDER BY created_at DESC",
      )
      .all(
        projectId === undefined ? 0 : 1,
        projectId ?? null,
        url ?? null,
        url ?? null,
      )
      .map((row) => JSON.parse(row.document));
  }
  assetRecord(id) {
    const row = this.db
      .prepare("SELECT document FROM assets WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.document) : null;
  }
  saveAssetRecord(asset) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO assets (id,project_id,url,created_at,document) VALUES (?,?,?,?,?)",
      )
      .run(
        asset.id,
        asset.projectId ?? null,
        asset.url,
        asset.createdAt,
        JSON.stringify(asset),
      );
    return this.assetRecord(asset.id);
  }
  assetAnnotations(id) {
    const row = this.db
      .prepare("SELECT document FROM asset_annotations WHERE asset_id=?")
      .get(id);
    return row
      ? JSON.parse(row.document)
      : {
          revision: 0,
          caption: "",
          tags: [],
          decision: "unreviewed",
          training: { allowed: false, rights: "unknown", notes: "" },
        };
  }
  saveAssetAnnotations(id, revision, annotations) {
    if (revision === 0)
      return (
        this.db
          .prepare(
            "INSERT OR IGNORE INTO asset_annotations (asset_id,revision,document) VALUES (?,?,?)",
          )
          .run(id, annotations.revision, JSON.stringify(annotations))
          .changes === 1
      );
    return (
      this.db
        .prepare(
          "UPDATE asset_annotations SET revision=?,document=? WHERE asset_id=? AND revision=?",
        )
        .run(annotations.revision, JSON.stringify(annotations), id, revision)
        .changes === 1
    );
  }
  async write(file, data) {
    const snapshot = JSON.stringify(data, null, 2);
    const previous = this.writes.get(file) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file + ".tmp", snapshot);
        await rename(file + ".tmp", file);
      });
    this.writes.set(file, task);
    try {
      await task;
    } finally {
      if (this.writes.get(file) === task) this.writes.delete(file);
    }
  }
  async saveWorkflow(g) {
    this.persistWorkflow(g);
    this.workflows.set(g.id, g);
    await this.write(path.join(this.root, "workflows", g.id + ".json"), g);
    return g;
  }
  async saveProject(project) {
    this.projectWrite.run(
      project.id,
      project.root,
      project.name,
      project.createdAt,
      project.updatedAt,
      JSON.stringify(project),
    );
    this.projects.set(project.id, project);
    return project;
  }
  async saveRun(run) {
    this.persistRun(run);
    this.runs.set(run.id, run);
    await this.write(path.join(this.root, "runs", run.id, "run.json"), run);
  }
  listRuns({ archived } = {}) {
    return [...this.runs.values()]
      .filter(
        (run) =>
          !archived ||
          archived === "all" ||
          (this.isWorkflowArchived(run.workflowId) ||
            this.isProjectArchived(run.projectId)) ===
            (archived === "archived"),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async flush() {
    await Promise.all([...this.writes.values()]);
  }
  async close() {
    await this.flush();
    this.db?.close();
  }
}
export function summarize(run) {
  const counts = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    blocked: 0,
    interrupted: 0,
    retrying: 0,
  };
  run.jobs.forEach((j) => counts[j.status]++);
  const nodes = Object.create(null);
  for (const job of run.jobs) {
    const node = (nodes[job.nodeId] ||= {});
    node[job.status] = (node[job.status] || 0) + 1;
  }
  return {
    nodes,
    id: run.id,
    name: run.name,
    workflowId: run.workflowId,
    projectId: run.projectId,
    project: run.project,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    total: run.jobs.length,
    textJobs: run.jobs.filter((j) => j.kind === "text").length,
    imageJobs: run.jobs.filter((j) => (j.kind || "image") === "image").length,
    videoJobs: run.jobs.filter((j) => j.kind === "video").length,
    counts,
    provider: run.provider,
  };
}

export function latestNodeJobs(runs, workflow) {
  const ids = new Set(workflow.nodes.map((n) => n.id)),
    seen = new Set(),
    jobs = [];
  for (const run of [...runs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )) {
    if (run.workflowId !== workflow.id) continue;
    const scopes = [
      ...new Set(run.jobs.filter((j) => ids.has(j.nodeId)).map(jobResultScope)),
    ].filter((scope) => !seen.has(scope));
    for (const scope of scopes) {
      seen.add(scope);
      jobs.push(
        ...run.jobs
          .filter((j) => jobResultScope(j) === scope)
          .map((j) => ({
            ...j,
            runId: run.id,
            runName: run.name,
            projectId: run.projectId ?? null,
            workflowId: run.workflowId,
          })),
      );
    }
  }
  return jobs;
}
