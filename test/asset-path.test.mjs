import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAssetPath } from "../server/asset-path.mjs";
import { Store } from "../server/store.mjs";
import { Assets } from "../server/assets.mjs";
import { Queue } from "../server/queue.mjs";
import { createImageWorkflow } from "../client/workflows.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "flow-asset-path-"));
  const dataRoot = path.join(root, "data");
  const store = new Store(dataRoot);
  await store.init();
  await mkdir(path.join(root, "public/assets"), { recursive: true });
  const assetPath = createAssetPath({ root, dataRoot, store });
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, dataRoot, store, assetPath };
}

test("asset references stay in their own directory and reject encoded, traversal and symlink escapes", async (t) => {
  const f = await fixture(t);
  for (const [file, url] of [
    [path.join(f.root, "public/assets/seed.png"), "/assets/seed.png"],
    [path.join(f.dataRoot, "uploads/seed.png"), "/files/uploads/seed.png"],
  ]) {
    await writeFile(file, "synthetic bytes");
    assert.equal(f.assetPath(url), file);
  }
  await writeFile(
    path.join(f.dataRoot, "connections.json"),
    "PRIVATE SYNTHETIC CANARY",
  );
  await writeFile(
    path.join(f.root, "public/private.json"),
    "PRIVATE SYNTHETIC CANARY",
  );
  for (const url of [
    "/files/uploads/../connections.json",
    "/files/uploads/./seed.png",
    "/files/uploads/%2e%2e/connections.json",
    "/files/uploads/%252e%252e/connections.json",
    "/files/uploads/..\\connections.json",
    "/files/uploads/seed.png?x=1",
    "/files/uploads/seed.png#fragment",
    "/assets/../private.json",
    "/assets/%2e%2e/private.json",
    "/assets//seed.png",
    "/files/uploads/seed.png\u0000",
    "https://example.test/seed.png",
  ])
    assert.throws(() => f.assetPath(url), /image|uploaded/i, url);
  for (const [link, target, url] of [
    [
      path.join(f.dataRoot, "uploads/link.png"),
      path.join(f.dataRoot, "connections.json"),
      "/files/uploads/link.png",
    ],
    [
      path.join(f.root, "public/assets/link.png"),
      path.join(f.root, "public/private.json"),
      "/assets/link.png",
    ],
  ]) {
    await symlink(target, link);
    assert.throws(() => f.assetPath(url), /Invalid image path/);
  }
});

test("completed outputs, original attempts, captured inputs and editor rasters retain their paths", async (t) => {
  const f = await fixture(t),
    runId = "aaaa-bbbb",
    jobId = "cccc-dddd",
    editorId = "a".repeat(32);
  const base = `/files/runs/${runId}/${jobId}`;
  const job = {
    id: jobId,
    status: "completed",
    kind: "image",
    output: `${base}/output.gif`,
    metadata: { originalFile: "original-attempt-1.gif" },
    lineage: {
      inputs: [
        { snapshotFile: "input-1.png", snapshotAssetId: "synthetic-asset" },
      ],
    },
  };
  f.store.runs.set(runId, { id: runId, jobs: [job] });
  f.store.assetRecord = () => ({ kind: "image", url: `${base}/input-1.png` });
  for (const [directory, file, url] of [
    [`runs/${runId}/${jobId}`, "output.gif", `${base}/output.gif`],
    [
      `runs/${runId}/${jobId}`,
      "original-attempt-1.gif",
      `${base}/original-attempt-1.gif`,
    ],
    [`runs/${runId}/${jobId}`, "input-1.png", `${base}/input-1.png`],
    [
      `editors/${editorId}`,
      "mask-1.png",
      `/files/editors/${editorId}/mask-1.png`,
    ],
  ]) {
    await mkdir(path.join(f.dataRoot, directory), { recursive: true });
    const filePath = path.join(f.dataRoot, directory, file);
    await writeFile(filePath, "synthetic bytes");
    assert.equal(f.assetPath(url), filePath);
  }
  job.status = "failed";
  assert.throws(() => f.assetPath(`${base}/output.gif`), /uploaded/);
  assert.equal(
    f.assetPath(`${base}/input-1.png`),
    path.join(f.dataRoot, "runs", runId, jobId, "input-1.png"),
  );
});

test("malicious imported references never create input snapshots or reach a provider", async (t) => {
  const f = await fixture(t),
    canary = "PRIVATE SYNTHETIC CANARY";
  await writeFile(path.join(f.dataRoot, "connections.json"), canary);
  const invalidPng = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(80),
  ]);
  await writeFile(path.join(f.dataRoot, "uploads/invalid.png"), invalidPng);
  let calls = 0;
  const queue = new Queue(f.store, {
    assets: new Assets({ store: f.store, resolveAsset: f.assetPath }),
    resolveAsset: f.assetPath,
    adapter: async () => {
      calls++;
      throw new Error("Provider must not run");
    },
  });
  t.after(() => queue.stop());
  for (const url of [
    "/files/uploads/../connections.json",
    "/files/uploads/invalid.png",
  ]) {
    const run = await queue.create(
      createImageWorkflow({
        prompt: "Synthetic test",
        images: [url],
        count: 1,
      }),
    );
    for (
      let attempt = 0;
      attempt < 500 && !["failed", "completed"].includes(run.status);
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(run.status, "failed");
    assert.ok(!run.jobs[0].lineage?.inputs.some((ref) => ref.snapshotFile));
    assert.deepEqual(
      await readdir(
        path.join(f.dataRoot, "runs", run.id, run.jobs[0].id),
      ).catch((error) =>
        error.code === "ENOENT" ? [] : Promise.reject(error),
      ),
      [],
    );
  }
  assert.equal(calls, 0);
  assert.equal(
    await readFile(path.join(f.dataRoot, "connections.json"), "utf8"),
    canary,
  );
});
