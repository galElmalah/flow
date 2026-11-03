import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { Sam2 } from "../image-tools/segmentation/sam2.mjs";
import { registerImageEditorRoutes } from "../server/routes/image-editors.mjs";
import { FlowClient } from "../client/index.mjs";
import { shouldDetectRegions } from "../src/image-editor/model-state.mjs";

async function environment(
  t,
  { missingUv = false, missingPython = false } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "flow-sam-setup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let downloads = 0,
    loads = 0,
    invalidCheckpoint = false;
  const commands = [];
  const model = new Sam2(root, {
    executeCommand: async (command, args, options) => {
      commands.push({ command, args });
      if (
        (command === "uv" && missingUv) ||
        (command === "python3" && missingPython)
      )
        throw Object.assign(new Error("Executable not found"), {
          code: "ENOENT",
        });
      if (args.includes("venv")) {
        await mkdir(path.dirname(model.python), { recursive: true });
        await writeFile(model.python, "fixture runtime");
      }
      options?.onProgress?.("fixture dependency progress");
      if (args[0] === "-c" && args[1].includes("device='cpu'")) {
        loads++;
        if (invalidCheckpoint) throw new Error("fixture corrupt checkpoint");
      }
      return "";
    },
    download: async (url, file, progress) => {
      downloads++;
      progress({ downloadedBytes: 4, totalBytes: 8, percent: 50 });
      await writeFile(file, "weights!");
      progress({ downloadedBytes: 8, totalBytes: 8, percent: 100 });
    },
  });
  return {
    root,
    model,
    commands,
    get downloads() {
      return downloads;
    },
    get loads() {
      return loads;
    },
    corrupt(value) {
      invalidCheckpoint = value;
    },
  };
}

test("empty SAM setup API installs once, verifies checkpoint loading, and survives restart", async (t) => {
  const fixture = await environment(t);
  const { model, root } = fixture;
  const app = express();
  app.use(express.json());
  registerImageEditorRoutes(app, { editors: { model } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new FlowClient({
    url: `http://127.0.0.1:${server.address().port}`,
  });
  assert.equal(
    (await client.request("/api/image-editors/status")).status,
    "not-installed",
  );
  const started = await client.post("/api/image-editors/setup", {});
  assert.equal(started.status, "installing");
  await client.post("/api/image-editors/setup", {});
  await model.installation;
  const ready = await client.request("/api/image-editors/status");
  assert.equal(ready.ready, true);
  assert.equal(ready.components.verification.ready, true);
  assert.equal(ready.components.checkpoint.bytes, 8);
  assert.equal(fixture.downloads, 1);
  assert.equal(fixture.loads, 1);
  assert.equal((await new Sam2(root).status()).ready, true);
  await model.setup();
  assert.equal(fixture.downloads, 1);
  assert.equal(fixture.loads, 1);
  await writeFile(model.checkpoint, "changed checkpoint");
  assert.equal((await model.status()).status, "incomplete");
  assert.equal((await new Sam2(root).status()).ready, false);
  assert.equal(
    (await new Sam2(root, { variant: "tiny" }).status()).ready,
    false,
  );
});

test("failed checkpoint verification is retryable and never marks SAM ready", async (t) => {
  const fixture = await environment(t);
  fixture.corrupt(true);
  await fixture.model.setup();
  const failed = await fixture.model.status();
  assert.equal(failed.ready, false);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /Retry setup/);
  assert.equal((await stat(fixture.model.checkpoint + ".invalid")).size, 8);
  await assert.rejects(
    readFile(path.join(fixture.model.directory, "ready.json")),
    { code: "ENOENT" },
  );
  fixture.corrupt(false);
  await fixture.model.setup();
  assert.equal((await fixture.model.status()).ready, true);
  assert.equal(fixture.downloads, 2);
});

test("SAM setup falls back to Python when uv is absent, and reports missing prerequisites", async (t) => {
  const fallback = await environment(t, { missingUv: true });
  await fallback.model.setup();
  assert.equal((await fallback.model.status()).ready, true);
  assert.ok(
    fallback.commands.some(
      ({ command, args }) => command === "python3" && args.includes("venv"),
    ),
  );
  assert.ok(
    fallback.commands.some(
      ({ command, args }) =>
        command === fallback.model.python &&
        args[0] === "-m" &&
        args[1] === "pip",
    ),
  );
  const missing = await environment(t, {
    missingUv: true,
    missingPython: true,
  });
  await missing.model.setup();
  const failed = await missing.model.status();
  assert.equal(failed.status, "failed");
  assert.equal(failed.ready, false);
  assert.match(failed.error, /Install uv/);
});

test("editor resumes automatic detection after setup without rerunning inherited or failed masks", () => {
  const editor = {
    id: "editor",
    regions: [],
    segmentation: { status: "idle" },
  };
  const model = {
    ready: false,
    status: "not-installed",
    model: "sam2.1-hiera-large",
  };
  assert.equal(shouldDetectRegions(editor, model), false);
  model.ready = true;
  assert.equal(shouldDetectRegions(editor, model), true);
  for (const status of ["running", "queued", "failed"])
    assert.equal(
      shouldDetectRegions({ ...editor, segmentation: { status } }, model),
      false,
    );
  assert.equal(
    shouldDetectRegions(
      { ...editor, segmentation: { status: "ready", inheritedFrom: "parent" } },
      model,
    ),
    false,
  );
  assert.equal(
    shouldDetectRegions(
      {
        ...editor,
        regions: [{ id: "mask" }],
        segmentation: { status: "ready", autoModel: model.model },
      },
      model,
    ),
    false,
  );
  assert.equal(
    shouldDetectRegions(
      {
        ...editor,
        regions: [{ id: "mask" }],
        segmentation: { status: "ready", autoModel: "older-model" },
      },
      model,
    ),
    true,
  );
});
