import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { Queue } from "../server/queue.mjs";
import { ImageEditors } from "../server/image-editor/service.mjs";
import { galleryItems } from "../server/search/documents.mjs";
import { editRequestSchema } from "../shared/image-editor.mjs";

const root = path.resolve(import.meta.dirname, "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pixels = (file) => sharp(file).rotate().ensureAlpha().raw().toBuffer();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function completed(store, runId) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const run = store.runs.get(runId);
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      assert.equal(run.status, "completed", JSON.stringify(run.jobs));
      return run;
    }
    await sleep(10);
  }
  assert.fail("Image-version fixture run did not complete.");
}

function assertOnlyMaskChanged(before, after, mask) {
  assert.equal(after.length, before.length);
  let changed = 0;
  for (let i = 0; i < mask.length; i++) {
    const oldPixel = before.subarray(i * 4, i * 4 + 4);
    const newPixel = after.subarray(i * 4, i * 4 + 4);
    if (!mask[i]) assert.deepEqual(newPixel, oldPixel, `Outside pixel ${i}`);
    else if (!oldPixel.equals(newPixel)) changed++;
  }
  assert.ok(changed > 0, "The selected pixels actually changed.");
}

test("queued image versions preserve outside pixels, frozen editable regions and a durable project family", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "flow-versions-"));
  const dataRoot = path.join(temporary, ".flow");
  let store = new Store(dataRoot);
  await store.init();
  let projects = new ProjectService(store);
  const projectId = "image-versions";
  const projectRoot = path.join(temporary, "project");
  await mkdir(projectRoot);
  await projects.create({
    id: projectId,
    name: "Version fixture",
    root: projectRoot,
  });
  const assetPath = (url) => {
    if (
      !/^\/files\/(?:uploads\/source\.png|editors\/[a-f0-9]{32}\/[a-zA-Z0-9-]+\.png|runs\/[a-f0-9-]+\/[a-f0-9-]+\/output\.png)$/.test(
        url,
      )
    )
      throw new Error("Only local fixture assets are allowed.");
    return path.join(dataRoot, url.slice("/files/".length));
  };
  const providers = new ProviderRegistry({
    root,
    dataRoot,
    definitions: [],
    codexHealth: async () => ({
      ready: false,
      auth: "No fixture authentication",
    }),
  });
  await providers.reload();
  const width = 24,
    height = 16;
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const lightness = 70 + (i % 100);
    raw.set([lightness, lightness, lightness, i % 11 ? 255 : 120], i * 4);
  }
  const source = "/files/uploads/source.png";
  const sourceFile = assetPath(source);
  await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(sourceFile);
  const originalBytes = await readFile(sourceFile);
  const originalPixels = await pixels(sourceFile);
  const originalHash = digest(originalBytes);
  const mask = Buffer.alloc(width * height);
  for (let y = 3; y < 13; y++)
    for (let x = 5; x < 17; x++) mask[y * width + x] = 255;
  const regionId = `region-${randomUUID()}`;
  let samCalls = 0;
  const model = {
    status: async () => ({ ready: true, model: "sam2-fixture" }),
    async run({ directory }) {
      samCalls++;
      await mkdir(directory, { recursive: true });
      await sharp(mask, { raw: { width, height, channels: 1 } })
        .png()
        .toFile(path.join(directory, `${regionId}.png`));
      return {
        width,
        height,
        model: "sam2-fixture",
        device: "fixture",
        regions: [
          {
            id: regionId,
            file: `${regionId}.png`,
            path: "M5 3L17 3L17 13L5 13Z",
            bbox: [5, 3, 12, 10],
            area: 120,
            score: 0.99,
          },
        ],
      };
    },
  };
  let queue = new Queue(store, {
    concurrency: 2,
    resolveAsset: assetPath,
    adapter: (context) => providers.run(context),
  });
  let editors = new ImageEditors({
    store,
    projects,
    assetPath,
    dataRoot,
    model,
    queue,
    providers,
  });
  t.after(async () => {
    await editors.close();
    await queue.stop();
    await store.close();
    await rm(temporary, { recursive: true, force: true });
  });
  const prepare = (id, input) =>
    editors.request(
      id,
      editRequestSchema.parse({
        revision: editors.get(id, projectId).revision,
        ...input,
      }),
      projectId,
    );
  const send = async (editorId, requestId) => {
    const sent = await editors.send(editorId, requestId, projectId);
    return completed(store, sent.run.id);
  };
  const openOutput = (run) =>
    editors.open({
      source: run.jobs[0].output,
      runId: run.id,
      jobId: run.jobs[0].id,
      projectId,
    });
  let original = await editors.open({ source, projectId });
  await editors.segment(original.id, { names: false }, projectId);
  await editors.pending;
  original = editors.get(original.id, projectId);
  original = editors.patch(
    original.id,
    {
      revision: original.revision,
      layer: { id: regionId, label: "Cycling jersey" },
    },
    projectId,
  );
  original = editors.patch(
    original.id,
    {
      revision: original.revision,
      comment: {
        regionIds: [regionId],
        text: "Try a different fabric next.",
        anchor: { x: 0.4, y: 0.5 },
      },
    },
    projectId,
  );
  original = editors.patch(
    original.id,
    {
      revision: original.revision,
      comment: { regionIds: [regionId], text: "Earlier resolved direction." },
    },
    projectId,
  );
  original = editors.patch(
    original.id,
    {
      revision: original.revision,
      resolve: { id: original.comments[1].id, resolved: true },
    },
    projectId,
  );
  const frozenComments = structuredClone(original.comments);
  const recolor = await prepare(original.id, {
    mode: "recolor",
    regionIds: [regionId],
    color: "#ee3697",
    strength: 1,
  });
  assert.equal(store.runs.size, 0, "Preparation does not run a provider.");
  let changedParent = editors.patch(
    original.id,
    {
      revision: recolor.editor.revision,
      layer: { id: regionId, label: "Later parent rename" },
    },
    projectId,
  );
  changedParent = editors.patch(
    original.id,
    {
      revision: changedParent.revision,
      comment: {
        regionIds: [regionId],
        text: "Added after preparing the recolor.",
      },
    },
    projectId,
  );
  const recolorRun = await send(original.id, recolor.request.id);
  assert.equal(recolorRun.jobs[0].providerId, "local-recolor");
  const recolored = await pixels(assetPath(recolorRun.jobs[0].output));
  assertOnlyMaskChanged(originalPixels, recolored, mask);
  assert.equal(digest(await readFile(sourceFile)), originalHash);
  let child = await openOutput(recolorRun);
  assert.equal(child.parentEditorId, original.id);
  assert.equal(child.familyId, original.id);
  assert.equal(child.original.editorId, original.id);
  assert.equal(child.original.url, source);
  assert.equal(child.segmentation.status, "ready");
  assert.equal(child.segmentation.inheritedFrom, original.id);
  assert.deepEqual(child.inheritedSelection, [regionId]);
  assert.equal(child.regions[0].id, regionId);
  assert.equal(child.regions[0].label, "Cycling jersey");
  assert.equal(child.regions[0].labelSource, "manual");
  assert.deepEqual(
    child.comments,
    frozenComments,
    "Local recolor consumes no natural-language comments.",
  );
  assert.equal(
    samCalls,
    1,
    "Recolor regions are immediately editable without another SAM pass.",
  );
  assert.deepEqual(
    await pixels(await editors.file(child.id, child.regions[0].file)),
    await pixels(assetPath(original.regions[0].mask)),
    "Child masks are readable from its own asset allowlist.",
  );
  child = editors.patch(
    child.id,
    {
      revision: child.revision,
      layer: { id: regionId, label: "Pink jersey" },
    },
    projectId,
  );
  assert.equal(
    (await openOutput(recolorRun)).regions[0].label,
    "Pink jersey",
    "Repeated open preserves edits.",
  );
  const region = await prepare(child.id, {
    mode: "region",
    regionIds: [regionId],
    instructions: "Change the jersey fabric.",
    providerId: "local-color",
    model: "monochrome",
  });
  const regionRun = await send(child.id, region.request.id);
  const regionOutput = await pixels(assetPath(regionRun.jobs[0].output));
  assertOnlyMaskChanged(recolored, regionOutput, mask);
  const grandchild = await openOutput(regionRun);
  assert.equal(grandchild.parentEditorId, child.id);
  assert.equal(grandchild.familyId, original.id);
  assert.equal(grandchild.regions[0].id, regionId);
  assert.equal(grandchild.regions[0].label, "Pink jersey");
  assert.equal(grandchild.segmentation.needsReview, true);
  assert.deepEqual(
    grandchild.comments.map((comment) => comment.id),
    frozenComments.map((comment) => comment.id),
  );
  assert.ok(
    grandchild.comments.every((comment) => comment.resolved),
    "Applied region comments stay in history as resolved.",
  );
  assert.equal(samCalls, 1);
  const whole = await prepare(grandchild.id, {
    regionIds: [grandchild.regions[0].id],
    instructions: "Make the selected object pink without pasted edges.",
    providerId: "local-color",
    model: "duotone",
  });
  assert.equal(whole.request.mode, "whole");
  assert.equal(whole.request.preserveOutsideMask, false);
  assert.equal(whole.request.inheritance, undefined);
  const wholeReferences = whole.workflow.nodes.find(
    (node) => node.type === "image",
  ).data.images;
  assert.equal(
    wholeReferences.length,
    2,
    "Original and location guide, without a binary compositing mask.",
  );
  assert.match(whole.request.prompt, /location guidance only/);
  const wholeRun = await send(grandchild.id, whole.request.id);
  const wholeOutput = await sharp(
    assetPath(wholeRun.jobs[0].output),
  ).metadata();
  assert.notEqual(
    wholeOutput.width,
    width,
    "Whole mode publishes provider framing without region compositing.",
  );
  const wholeEditor = await openOutput(wholeRun);
  assert.equal(wholeEditor.familyId, original.id);
  assert.equal(wholeEditor.parentEditorId, grandchild.id);
  assert.equal(
    wholeEditor.regions.length,
    0,
    "Whole generation cannot reuse possibly misaligned masks.",
  );
  assert.notEqual(wholeEditor.segmentation.status, "ready");
  const expectedRequests = [
    recolor.request.id,
    region.request.id,
    whole.request.id,
  ].sort();
  for (const id of [original.id, child.id, grandchild.id, wholeEditor.id]) {
    assert.deepEqual(
      editors
        .variations(id, projectId)
        .map((item) => item.requestId)
        .sort(),
      expectedRequests,
    );
  }
  const gallery = galleryItems([...store.runs.values()]);
  assert.equal(gallery.length, 3);
  assert.ok(
    gallery.every(
      (item) =>
        item.projectId === projectId && item.edit.familyId === original.id,
    ),
  );
  assert.equal(
    (await editors.send(original.id, recolor.request.id, projectId)).run.id,
    recolorRun.id,
  );
  assert.equal(
    store.runs.size,
    3,
    "Sending an existing request is idempotent.",
  );
  assert.equal(digest(await readFile(sourceFile)), originalHash);

  // Simulate a crash after queue persistence but before the editor saves runId.
  const missingReceipt = editors.get(original.id, projectId);
  delete missingReceipt.requests.find(
    (request) => request.id === recolor.request.id,
  ).runId;
  editors.save(missingReceipt, missingReceipt.revision);
  const recoveredVariation = editors
    .variations(child.id, projectId)
    .find((item) => item.requestId === recolor.request.id);
  assert.equal(
    recoveredVariation.runId,
    recolorRun.id,
    "Family history recovers the durable run when its editor receipt is missing.",
  );
  assert.equal(recoveredVariation.status, "completed");

  await editors.close();
  await queue.stop();
  await store.close();
  store = new Store(dataRoot);
  await store.init();
  projects = new ProjectService(store);
  queue = new Queue(store, {
    resolveAsset: assetPath,
    adapter: (context) => providers.run(context),
  });
  editors = new ImageEditors({
    store,
    projects,
    assetPath,
    dataRoot,
    model,
    queue,
    providers,
  });
  assert.equal(
    editors.get(child.id, projectId).regions[0].label,
    "Pink jersey",
  );
  assert.deepEqual(editors.get(child.id, projectId).comments, frozenComments);
  assert.deepEqual(
    editors
      .variations(wholeEditor.id, projectId)
      .map((item) => item.requestId)
      .sort(),
    expectedRequests,
  );
  assert.equal(
    (await editors.send(original.id, recolor.request.id, projectId)).run.id,
    recolorRun.id,
  );
  const pending = await prepare(original.id, {
    mode: "whole",
    providerId: "local-color",
    model: "duotone",
  });
  await writeFile(sourceFile, Buffer.from("modified fixture source"));
  await assert.rejects(
    prepare(original.id, { mode: "whole", providerId: "local-color" }),
    /source file changed/i,
  );
  await assert.rejects(
    editors.send(original.id, pending.request.id, projectId),
    /source file changed/i,
  );
  assert.equal(
    store.runs.size,
    3,
    "Changed source never schedules another generation.",
  );
});

test("image-version request modes reject ambiguous or invalid local recolors", () => {
  const base = { revision: 0, regionIds: ["region-fixture"] };
  assert.equal(editRequestSchema.parse(base).mode, "whole");
  assert.equal(
    editRequestSchema.parse({ revision: 0, mode: "whole" }).mode,
    "whole",
  );
  for (const invalid of [
    { ...base, mode: "region", regionIds: [] },
    { ...base, mode: "recolor", color: "pink" },
    { ...base, mode: "recolor", color: "#ff00aa", strength: 2 },
    { ...base, mode: "recolor", color: "#ff00aa", count: 2 },
    { ...base, mode: "recolor", color: "#ff00aa", regionIds: [] },
  ])
    assert.equal(editRequestSchema.safeParse(invalid).success, false);
});

test("CLI exposes image-version modes, color and strength in scoped prepare requests", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "flow-version-cli-"));
  const requests = [];
  const editorId = "a".repeat(32);
  const api = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    response.setHeader("content-type", "application/json");
    if (request.method === "GET")
      return response.end(JSON.stringify({ id: editorId, revision: 5 }));
    const body = JSON.parse(raw);
    requests.push({ url: request.url, body });
    response.end(JSON.stringify({ request: body }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => api.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const execute = promisify(execFile);
  const invoke = async (...args) =>
    JSON.parse(
      (
        await execute(
          process.execPath,
          [
            path.join(root, "cli/flow.mjs"),
            "editor",
            "prepare",
            editorId,
            "--project",
            "fixture",
            "--url",
            `http://127.0.0.1:${api.address().port}`,
            "--json",
            ...args,
          ],
          { cwd: directory },
        )
      ).stdout,
    );
  const recolor = await invoke(
    "--mode",
    "recolor",
    "--regions",
    "one,two",
    "--color",
    "#ee3697",
    "--strength",
    "0.6",
  );
  assert.deepEqual(recolor.request, {
    revision: 5,
    regionIds: ["one", "two"],
    instructions: "",
    mode: "recolor",
    color: "#ee3697",
    strength: 0.6,
  });
  assert.equal(
    requests[0].url,
    `/api/image-editors/${editorId}/requests?projectId=fixture`,
  );
  const whole = await invoke(
    "--mode",
    "whole",
    "--provider",
    "local-color",
    "--model",
    "duotone",
  );
  assert.deepEqual(whole.request, {
    revision: 5,
    regionIds: [],
    instructions: "",
    providerId: "local-color",
    model: "duotone",
    mode: "whole",
  });
  const input = path.join(directory, "edit.json");
  await writeFile(
    input,
    JSON.stringify({
      revision: 3,
      mode: "region",
      regionIds: ["saved"],
      instructions: "Saved",
    }),
  );
  const override = await invoke(
    "--from",
    input,
    "--regions",
    "override",
    "--prompt",
    "New direction",
  );
  assert.equal(
    override.request.revision,
    3,
    "Explicit snapshots retain optimistic concurrency revision.",
  );
  assert.deepEqual(override.request.regionIds, ["override"]);
  assert.equal(override.request.instructions, "New direction");
});
