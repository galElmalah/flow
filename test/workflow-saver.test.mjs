import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowSaver } from "../src/canvas/workflow-saver.mjs";

const graph = (id, name) => ({ id, name, nodes: [], edges: [] });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("switching workflows flushes pending edits and reopening uses the newest draft", async () => {
  const saved = new Map();
  const saver = new WorkflowSaver({
    delay: 60000,
    save: async (g) => saved.set(g.id, g),
  });
  const original = graph("a", "Original");
  saver.seed(original);
  saver.stage(graph("a", "Changed just before switching"));
  saver.seed(graph("b", "Another canvas"));
  await saver.flush("a");
  assert.equal(saved.get("a").name, "Changed just before switching");
  assert.equal(saver.seed(original).name, "Changed just before switching");
  assert.equal(saver.hasPending(), false);
});

test("overlapping saves cannot overwrite newer edits or the other workflow", async () => {
  const first = deferred(),
    second = deferred(),
    writes = [];
  const saver = new WorkflowSaver({
    delay: 60000,
    save: async (g) => {
      writes.push(g);
      if (g.id === "a")
        await (writes.filter((x) => x.id === "a").length === 1
          ? first.promise
          : second.promise);
    },
  });
  saver.seed(graph("a", "Original A"));
  saver.stage(graph("a", "First edit"));
  const writing = saver.flush("a");
  saver.stage(graph("a", "Latest edit"));
  saver.stage(graph("b", "B edit"));
  await saver.flush("b");
  assert.equal(saver.status("b"), "saved");
  first.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saver.status("a"), "saving");
  second.resolve();
  await writing;
  assert.deepEqual(
    writes.filter((g) => g.id === "a").map((g) => g.name),
    ["First edit", "Latest edit"],
  );
  assert.equal(saver.status("a"), "saved");
});

test("a failed save retains the draft and explicit retry writes the latest state", async () => {
  let offline = true;
  const writes = [];
  const saver = new WorkflowSaver({
    delay: 60000,
    save: async (g) => {
      if (offline) throw new Error("Server unavailable");
      writes.push(g);
    },
  });
  saver.seed(graph("a", "Original"));
  const draft = graph("a", "Unsaved prompt");
  saver.stage(draft);
  draft.name = "Mutation outside the saver";
  await assert.rejects(saver.flush("a"), /unavailable/);
  assert.equal(saver.status("a"), "error");
  assert.equal(saver.draft("a").name, "Unsaved prompt");
  assert.equal(saver.hasPending(), true);
  offline = false;
  await saver.flush("a");
  assert.equal(writes[0].name, "Unsaved prompt");
  assert.equal(saver.hasPending(), false);
});

test("opening fresh server data replaces a clean cache while preserving unsaved edits", async () => {
  const saver = new WorkflowSaver({ delay: 60000, save: async () => {} });
  saver.seed(graph("a", "Original"));
  saver.stage(graph("a", "Local edit"));
  await saver.flush("a");
  assert.equal(
    saver.seed(graph("a", "Agent edit"), { fresh: true }).name,
    "Agent edit",
  );
  assert.equal(saver.hasPending(), false);
  saver.stage(graph("a", "Unsaved local draft"));
  assert.equal(
    saver.seed(graph("a", "New agent edit"), { fresh: true }).name,
    "Unsaved local draft",
  );
  await saver.flush("a");
});

test("overlapping staged edits advance server revisions without restoring an older graph", async () => {
  const first = deferred(),
    second = deferred(),
    writes = [];
  const saver = new WorkflowSaver({
    delay: 60000,
    save: async (snapshot) => {
      writes.push(structuredClone(snapshot));
      await (writes.length === 1 ? first.promise : second.promise);
      return { ...snapshot, revision: snapshot.revision + 1 };
    },
  });
  saver.seed({ ...graph("a", "Original"), revision: 0 });
  saver.stage({ ...graph("a", "First edit"), revision: 0 });
  const saving = saver.flush("a");
  saver.stage({ ...graph("a", "Edit while first save runs"), revision: 0 });
  first.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    writes.map(({ name, revision }) => ({ name, revision })),
    [
      { name: "First edit", revision: 0 },
      { name: "Edit while first save runs", revision: 1 },
    ],
  );
  assert.equal(saver.draft("a").name, "Edit while first save runs");
  assert.equal(saver.draft("a").revision, 1);
  second.resolve();
  await saving;
  assert.equal(saver.draft("a").revision, 2);
  assert.equal(saver.status("a"), "saved");
  // App can still render its earlier graph object. Staging it must not undo the acknowledged revision.
  saver.stage({ ...graph("a", "Edit while first save runs"), revision: 0 });
  assert.equal(saver.status("a"), "saved");
  assert.equal(saver.draft("a").revision, 2);
  assert.equal(writes.length, 2);
});

test("a stale server revision preserves the user's draft and requires explicit reconciliation", async () => {
  const writes = [];
  const conflict = Object.assign(new Error("Workflow changed elsewhere"), {
    status: 409,
  });
  const saver = new WorkflowSaver({
    delay: 60000,
    save: async (snapshot) => {
      writes.push(snapshot);
      throw conflict;
    },
  });
  saver.seed({ ...graph("a", "Original"), revision: 3 });
  saver.stage({ ...graph("a", "Keep this local prompt"), revision: 3 });
  await assert.rejects(saver.flush("a"), (error) => error === conflict);
  assert.equal(saver.status("a"), "error");
  assert.equal(saver.hasPending(), true);
  assert.equal(saver.draft("a").name, "Keep this local prompt");
  assert.equal(saver.draft("a").revision, 3);
  assert.equal(
    saver.seed(
      { ...graph("a", "Other agent's prompt"), revision: 4 },
      { fresh: true },
    ).name,
    "Keep this local prompt",
  );
  assert.equal(writes.length, 1);
});
