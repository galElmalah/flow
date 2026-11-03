import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  viewerPath,
  viewerParams,
  settingsSections,
} from "../shared/viewer-routes.mjs";
import { resolveViewerTarget } from "../src/canvas/viewer-target.mjs";
import { Sam2 } from "../image-tools/segmentation/sam2.mjs";
import { downloadCheckpoint } from "../image-tools/segmentation/download.mjs";

test("settings links resolve each submenu without loading workflow state", async () => {
  for (const section of settingsSections) {
    const route = viewerPath({ view: "settings", section });
    assert.equal(route, `/settings/${section}`);
    const params = viewerParams(route);
    assert.deepEqual(await resolveViewerTarget(params, {}), {
      settings: true,
      section,
    });
  }
  assert.equal(viewerParams("/settings").get("section"), "workspace");
  for (const legacy of ["harnesses", "connections"]) {
    assert.equal(
      viewerParams(`/settings/${legacy}`).get("section"),
      "providers",
    );
    assert.equal(
      viewerPath({ view: "settings", section: legacy }),
      "/settings/providers",
    );
    assert.equal(
      viewerParams(`/?view=settings&section=${legacy}`).get("section"),
      "providers",
    );
  }
  assert.ok(!settingsSections.includes("harnesses"));
  assert.ok(!settingsSections.includes("connections"));
  assert.ok(viewerParams("/settings/unknown").has("__routeError"));
  assert.throws(() => viewerPath({ view: "settings", workflow: "x" }));
  await assert.rejects(
    resolveViewerTarget(
      new URLSearchParams({ view: "settings", section: "unknown" }),
      {},
    ),
  );
});

test("SAM status distinguishes partial weights, runtime, checkpoint and verification", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-sam-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const model = new Sam2(root);
  assert.equal((await model.status()).ready, false);
  await mkdir(path.dirname(model.python), { recursive: true });
  await writeFile(model.checkpoint + ".part", "partial");
  assert.equal((await model.status()).status, "incomplete");
  await writeFile(model.python, "runtime fixture");
  await writeFile(model.checkpoint, "checkpoint fixture");
  let status = await model.status();
  assert.equal(status.components.runtime.ready, true);
  assert.equal(status.components.checkpoint.ready, true);
  assert.equal(status.ready, false);
  await writeFile(path.join(model.directory, "ready.json"), "{}");
  status = await model.status();
  assert.equal(status.ready, false);
  assert.equal(status.status, "incomplete");
  assert.equal(status.components.verification.ready, false);
});

test("model download reports actual bytes and retries an unsuccessful transfer", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-model-download-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "weights.part");
  const progress = [];
  let attempts = 0;
  await downloadCheckpoint(
    "https://example.invalid/model",
    file,
    (value) => progress.push(value),
    async () => {
      attempts++;
      return attempts === 1
        ? new Response("", { status: 503 })
        : new Response("model bytes", { headers: { "content-length": "11" } });
    },
  );
  assert.equal(attempts, 2);
  assert.equal(await readFile(file, "utf8"), "model bytes");
  assert.deepEqual(progress.at(-1), {
    downloadedBytes: 11,
    totalBytes: 11,
    percent: 100,
  });
});
