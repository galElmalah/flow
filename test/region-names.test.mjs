import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import express from "express";
import { Store } from "../server/store.mjs";
import { ProjectService } from "../server/projects.mjs";
import { ImageEditors } from "../server/image-editor/service.mjs";
import { registerImageEditorRoutes } from "../server/routes/image-editors.mjs";
import { FlowClient } from "../client/index.mjs";
import { needsRegionName } from "../shared/image-editor.mjs";
import {
  parseRegionNames,
  regionContactSheet,
} from "../server/image-editor/region-names.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("vision names persist, preserve concurrent manual renames, cache successful names and expose cancel/retry through the scoped API", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-region-names-"));
  const store = new Store(root);
  await store.init();
  const projects = new ProjectService(store);
  for (const id of ["photos", "other"]) {
    await mkdir(path.join(root, id));
    await projects.create({ id, name: id, root: path.join(root, id) });
  }
  const source = path.join(root, "uploads", "photo.png");
  const original = await sharp({
    create: { width: 20, height: 12, channels: 3, background: "#789" },
  })
    .png()
    .toBuffer();
  await writeFile(source, original);
  const assetPath = (url) =>
    url.startsWith("/files/uploads/") ? source : path.join(root, url.slice(7));
  const model = {
    status: async () => ({ ready: true, model: "sam-fixture" }),
    async run({ directory }) {
      await mkdir(directory, { recursive: true });
      const regions = [];
      for (let i = 0; i < 2; i++) {
        const id = `region-${randomUUID()}`,
          alpha = Buffer.alloc(240);
        for (let y = 2; y < 10; y++)
          for (let x = i * 10; x < i * 10 + 9; x++) alpha[y * 20 + x] = 255;
        await sharp(alpha, { raw: { width: 20, height: 12, channels: 1 } })
          .png()
          .toFile(path.join(directory, id + ".png"));
        regions.push({
          id,
          file: id + ".png",
          path: `M${i * 10} 2L${i * 10 + 9} 2L${i * 10 + 9} 10L${i * 10} 10Z`,
          bbox: [i * 10, 2, 9, 8],
          area: 72,
          score: 0.99,
        });
      }
      return {
        model: "sam-fixture",
        device: "fixture",
        width: 20,
        height: 12,
        regions,
      };
    },
  };
  let calls = 0,
    entered = deferred(),
    gate = deferred(),
    failure = null,
    cancel = false;
  const providers = {
    async run({ job, imagePaths, signal }) {
      calls++;
      assert.equal(
        job.kind,
        "text",
        "region naming never requests image generation",
      );
      assert.equal(imagePaths.length, 2);
      const sheet = await sharp(imagePaths[1]).metadata();
      assert.equal(sheet.width, 984);
      assert.equal(sheet.height, 220);
      entered.resolve();
      if (cancel)
        await new Promise((resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        );
      await gate.promise;
      if (failure) throw new Error(failure);
      const cards = JSON.parse(
        job.prompt.match(/Card number to stable ID: (\[[^\n]+\])/)[1],
      );
      return {
        kind: "text",
        text: JSON.stringify({
          regions: cards.map((card, i) => ({
            id: card.id,
            label: i ? "Rear wheel" : "Cycling jersey",
          })),
        }),
        metadata: { model: "vision-fixture" },
      };
    },
  };
  const editors = new ImageEditors({
    store,
    projects,
    assetPath,
    dataRoot: root,
    model,
    providers,
  });
  const app = express();
  app.use(express.json());
  registerImageEditorRoutes(app, { editors });
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const client = new FlowClient({
    url: `http://127.0.0.1:${server.address().port}`,
    projectId: "photos",
  });
  const foreign = new FlowClient({ url: client.url, projectId: "other" });
  t.after(async () => {
    gate.resolve();
    await editors.close();
    await new Promise((r) => server.close(r));
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const open = async (name) => {
    const doc = await client.openImageEditor({
      source: `/files/uploads/${name}.png`,
    });
    await client.segmentImage(doc.id, { names: false });
    await editors.pending;
    return client.imageEditor(doc.id);
  };
  const doc = await open("photo");
  assert.equal(
    calls,
    0,
    "local-only segmentation never invokes a vision harness",
  );
  await assert.rejects(foreign.nameImageRegions(doc.id), /ownership/);
  const queued = await client.nameImageRegions(doc.id);
  assert.equal(queued.naming.status, "queued");
  await entered.promise;
  assert.equal(
    (await client.nameImageRegions(doc.id)).naming.status,
    "running",
  );
  let current = await client.imageEditor(doc.id);
  const manual = current.regions[0].id;
  current = await client.patchImageEditor(doc.id, {
    revision: current.revision,
    layer: { id: manual, label: "My custom jersey" },
  });
  const pending = editors.naming.get(doc.id).promise;
  gate.resolve();
  await pending;
  current = await client.imageEditor(doc.id);
  assert.equal(current.naming.status, "ready");
  assert.equal(current.naming.completed, 2);
  assert.equal(
    current.regions.find((r) => r.id === manual).label,
    "My custom jersey",
  );
  assert.equal(
    current.regions.find((r) => r.id === manual).labelSource,
    "manual",
  );
  assert.equal(
    current.regions.find((r) => r.id !== manual).label,
    "Rear wheel",
  );
  await client.nameImageRegions(doc.id);
  assert.equal(calls, 1, "cached or manual labels are never inferred again");
  assert.deepEqual(await readFile(source), original);
  const other = await open("second");
  entered = deferred();
  cancel = true;
  await client.nameImageRegions(other.id);
  await entered.promise;
  const stopped = editors.naming.get(other.id).promise;
  await client.cancelImageNaming(other.id);
  await stopped;
  assert.equal((await client.imageEditor(other.id)).naming.status, "cancelled");
  assert.ok(
    (await client.imageEditor(other.id)).regions.every(needsRegionName),
  );
  cancel = false;
  failure = "Vision provider unavailable";
  await client.nameImageRegions(other.id);
  await editors.naming.get(other.id).promise;
  assert.equal((await client.imageEditor(other.id)).naming.status, "failed");
  assert.equal(
    (await client.imageEditor(other.id)).segmentation.status,
    "ready",
  );
  failure = null;
  await client.nameImageRegions(other.id);
  await editors.naming.get(other.id).promise;
  assert.equal((await client.imageEditor(other.id)).naming.status, "ready");
  const third = await client.openImageEditor({
    source: "/files/uploads/automatic.png",
  });
  await client.segmentImage(third.id);
  await editors.pending;
  const automatic = editors.naming.get(third.id)?.promise;
  if (automatic) await automatic;
  assert.equal(
    (await client.imageEditor(third.id)).naming.status,
    "ready",
    "new SAM masks are automatically named",
  );
  const restarted = new ImageEditors({
    store,
    projects,
    assetPath,
    dataRoot: root,
    model,
    providers,
  });
  assert.equal(
    restarted.get(doc.id).regions.find((r) => r.id === manual).label,
    "My custom jersey",
  );
  let interrupted = restarted.get(other.id);
  restarted.save(
    { ...interrupted, naming: { ...interrupted.naming, status: "running" } },
    interrupted.revision,
  );
  const recovered = new ImageEditors({
    store,
    projects,
    assetPath,
    dataRoot: root,
    model,
    providers,
  });
  assert.equal(recovered.get(other.id).naming.status, "failed");
  assert.match(recovered.get(other.id).naming.error, /interrupted/);
  assert.equal(recovered.get(other.id).segmentation.status, "ready");
  await recovered.close();
  await restarted.close();
});

test("region names require exact stable IDs and preserve explicitly manual generic names", () => {
  const regions = [{ id: "a" }, { id: "b" }];
  const reply =
    '{"regions":[{"id":"a","label":"Front wheel"},{"id":"b","label":"Rear wheel"}]}';
  assert.equal(
    parseRegionNames("```json\n" + reply + "\n```", regions)[0].label,
    "Front wheel",
  );
  for (const bad of [
    reply.replace('"b"', '"a"'),
    reply.replace('"b"', '"unknown"'),
    reply.replace("Front wheel", "Region 1"),
    '{"regions":[]}',
  ])
    assert.throws(() => parseRegionNames(bad, regions));
  assert.equal(
    needsRegionName({ label: "Region 1", labelSource: "manual" }),
    false,
  );
  assert.equal(needsRegionName({ label: "Region 1", locked: true }), false);
  assert.equal(needsRegionName({ label: "Region 1" }), true);
  assert.equal(needsRegionName({ label: "Helmet" }), false);
});

test("large source images produce aligned contact sheets without compositing an original-size mask onto a thumbnail", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-contact-sheet-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const width = 600,
    height = 300;
  const source = path.join(root, "source.png"),
    mask = path.join(root, "mask.png");
  await sharp({ create: { width, height, channels: 3, background: "#000000" } })
    .png()
    .toFile(source);
  const alpha = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width / 2; x++) alpha[y * width + x] = 255;
  await sharp(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toFile(mask);
  const file = await regionContactSheet({
    source,
    directory: root,
    width,
    height,
    maskPath: () => mask,
    regions: [
      { id: "left", bbox: [0, 0, 300, 300], path: "M0 0L300 0L300 300L0 300Z" },
    ],
  });
  const image = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(image.info.width, 984);
  assert.equal(image.info.height, 220);
  const pixel = (x, y) => [
    ...image.data.subarray((y * 984 + x) * 3, (y * 984 + x) * 3 + 3),
  ];
  assert.ok(
    pixel(195, 116)[0] > 50,
    "left half of context thumbnail highlights selected pixels",
  );
  assert.deepEqual(
    pixel(300, 116),
    [0, 0, 0],
    "unselected right half stays unhighlighted",
  );
  assert.deepEqual(
    pixel(80, 116),
    [0, 0, 0],
    "masked crop retains source colors rather than the annotation tint",
  );
});
