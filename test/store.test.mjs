import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.mjs";
import { starter } from "./fixtures/paper-workflow.mjs";

async function temporary(t) {
  const root = await mkdtemp(path.join(tmpdir(), "flow-db-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("SQLite imports existing JSON once, preserves lineage and prompts, and remains authoritative on reopen", async (t) => {
  const root = await temporary(t);
  await mkdir(path.join(root, "workflows"));
  await mkdir(path.join(root, "runs", "legacy"), { recursive: true });
  const graph = {
    ...structuredClone(starter),
    forkedFrom: {
      workflowId: "original",
      name: "Original",
      createdAt: new Date().toISOString(),
    },
  };
  const run = {
    id: "legacy",
    workflowId: graph.id,
    createdAt: new Date().toISOString(),
    status: "completed",
    graph,
    jobs: [
      {
        id: "text",
        nodeId: "writer",
        kind: "text",
        status: "completed",
        resultText: "A scene for the quote",
        records: [{ id: "quote-1", fields: { quote: "Be curious" } }],
      },
    ],
  };
  const graphFile = path.join(root, "workflows", graph.id + ".json");
  await writeFile(graphFile, JSON.stringify(graph));
  await writeFile(
    path.join(root, "runs", "legacy", "run.json"),
    JSON.stringify(run),
  );
  const first = new Store(root);
  await first.init();
  assert.deepEqual(first.workflows.get(graph.id), graph);
  assert.deepEqual(first.runs.get(run.id), run);
  assert.equal(first.storageInfo().engine, "sqlite");
  await first.saveWorkflow({ ...graph, name: "New database version" });
  await first.close();
  // Old files must never overwrite newer database records on startup.
  await writeFile(graphFile, JSON.stringify(graph));
  const second = new Store(root);
  await second.init();
  assert.equal(second.workflows.get(graph.id).name, "New database version");
  assert.deepEqual(second.runs.get(run.id), run);
  const db = new DatabaseSync(path.join(root, "flow.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  const job = db
    .prepare("SELECT document FROM jobs WHERE run_id=? AND id=?")
    .get(run.id, "text");
  assert.equal(JSON.parse(job.document).resultText, run.jobs[0].resultText);
  assert.equal(
    db.prepare("SELECT parent_id FROM workflows WHERE id=?").get(graph.id)
      .parent_id,
    "original",
  );
  db.close();
  await second.close();
});
test("a failed migration can retry without losing or partially importing old records", async (t) => {
  const root = await temporary(t);
  await mkdir(path.join(root, "workflows"));
  const valid = path.join(root, "workflows", "a.json"),
    broken = path.join(root, "workflows", "b.json");
  await writeFile(valid, JSON.stringify(starter));
  await writeFile(broken, "{ broken json");
  const first = new Store(root);
  await assert.rejects(first.init(), SyntaxError);
  assert.equal(
    first.db.prepare("SELECT count(*) AS count FROM workflows").get().count,
    0,
  );
  assert.equal(await readFile(broken, "utf8"), "{ broken json");
  await first.close();
  await writeFile(broken, JSON.stringify({ ...starter, id: "repaired" }));
  const second = new Store(root);
  await second.init();
  assert.equal(second.workflows.size, 2);
  await second.close();
});
test("database write failure cannot add a workflow only to the in-memory cache", async (t) => {
  const root = await temporary(t),
    store = new Store(root);
  await store.init();
  await store.close();
  await assert.rejects(store.saveWorkflow({ ...starter, id: "unsaved" }));
  assert.equal(store.workflows.has("unsaved"), false);
});
