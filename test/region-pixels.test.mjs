import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { Queue } from "../server/queue.mjs";
import { Store } from "../server/store.mjs";
import { galleryItems } from "../server/search/documents.mjs";
import {
  recolorPixels,
  compositePixels,
  decodeRegionSource,
  prepareRegionInputs,
  writeRegionImage,
} from "../image-tools/region-edit.mjs";

const source = {
  width: 2,
  height: 2,
  data: Buffer.from([
    220, 220, 220, 255, 64, 64, 64, 180, 12, 34, 56, 0, 70, 80, 90, 77,
  ]),
};
const mask = Buffer.from([255, 255, 0, 0]);
const root = path.resolve(import.meta.dirname, "..");
async function fixtures(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "weft-region-pixels-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.png");
  const candidatePath = path.join(directory, "candidate.png");
  const maskPath = path.join(directory, "mask.png");
  await writeRegionImage(source, sourcePath);
  await writeRegionImage(
    { ...source, data: Buffer.alloc(16, 140) },
    candidatePath,
  );
  await sharp(mask, { raw: { width: 2, height: 2, channels: 1 } })
    .png()
    .toFile(maskPath);
  const sourceHash = createHash("sha256")
    .update(await readFile(sourcePath))
    .digest("hex");
  const images = ["source", "candidate", "mask"].map((asset) => ({ asset }));
  const edit = {
    mode: "region",
    source: "source",
    overlay: "candidate",
    mask: "mask",
    sourceHash,
  };
  const imagePaths = [sourcePath, candidatePath, maskPath];
  return {
    directory,
    sourcePath,
    candidatePath,
    maskPath,
    imagePaths,
    images,
    edit,
  };
}
function registryFor(directory) {
  return new ProviderRegistry({
    root,
    dataRoot: directory,
    codexHealth: async () => ({ ready: false }),
    definitions: [
      {
        id: "fixture-image",
        name: "Fixture image",
        kind: "command",
        models: ["fixture"],
        command: [
          process.execPath,
          "-e",
          "let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const r=JSON.parse(b);require('node:fs').copyFileSync(r.images[1],r.output)})",
        ],
      },
    ],
  });
}
function context(f, mode, providerId = "fixture-image") {
  return {
    job: {
      id: "image",
      providerId,
      model: providerId === "local-recolor" ? "recolor" : "fixture",
      kind: "image",
      prompt: "Change the selected jersey",
      images: f.images,
      ratio: "1:1",
      edit: { ...f.edit, mode, color: "#ed78a4", strength: 1 },
    },
    imagePaths: f.imagePaths,
    directory: path.join(f.directory, `${mode}-${providerId}`),
    signal: new AbortController().signal,
  };
}

test("recolor changes achromatic fabric to pink while retaining shadows, alpha and outside pixels", () => {
  const output = recolorPixels(source, mask, "#ed78a4");
  assert.ok(
    output.data[0] > output.data[1] + 20,
    "bright gray must visibly become pink",
  );
  assert.ok(
    output.data[4] > output.data[5] + 20,
    "dark fabric must retain pink chroma",
  );
  assert.ok(output.data[0] > output.data[4], "shadows remain darker");
  const luminance = (data, offset) =>
    data[offset] * 0.2126 +
    data[offset + 1] * 0.7152 +
    data[offset + 2] * 0.0722;
  assert.ok(Math.abs(luminance(output.data, 0) - 220) < 1);
  assert.ok(Math.abs(luminance(output.data, 4) - 64) < 1);
  assert.equal(output.data[7], 180);
  assert.deepEqual(output.data.subarray(8), source.data.subarray(8));
  assert.deepEqual(recolorPixels(source, mask, "#ed78a4", 0).data, source.data);
  assert.throws(() => recolorPixels(source, mask, "pink"), /#RRGGBB/);
});

test("compositor preserves every outside RGBA channel, including fully transparent RGB", () => {
  const candidate = { ...source, data: Buffer.alloc(16, 200) };
  const output = compositePixels(source, candidate, mask);
  assert.deepEqual(output.data.subarray(0, 8), candidate.data.subarray(0, 8));
  assert.deepEqual(output.data.subarray(8), source.data.subarray(8));
});

test("registry composites region edits, retains raw candidate and bypasses compositing for whole and legacy runs", async (t) => {
  const f = await fixtures(t),
    registry = registryFor(f.directory);
  await registry.reload();
  for (const mode of ["region", "whole", undefined]) {
    const input = context(f, mode);
    const result = await registry.run(input);
    const actual = await decodeRegionSource(result.path);
    if (mode === "region") {
      assert.deepEqual(actual.data.subarray(8), source.data.subarray(8));
      assert.equal(result.metadata.outsidePixelsPreserved, true);
    } else assert.deepEqual(actual.data, Buffer.alloc(16, 140));
    assert.deepEqual(
      await readFile(path.join(input.directory, result.metadata.originalFile)),
      await readFile(f.candidatePath),
    );
    assert.equal(result.metadata.width, 2);
  }
});

test("reserved local recolor runs through command protocol without credentials and saves edit options", async (t) => {
  const f = await fixtures(t),
    registry = registryFor(f.directory);
  await registry.reload();
  const input = context(f, "recolor", "local-recolor");
  const result = await registry.run(input);
  const actual = await decodeRegionSource(result.path);
  assert.deepEqual(actual.data.subarray(8), source.data.subarray(8));
  assert.ok(actual.data[0] > actual.data[1]);
  assert.equal(result.metadata.providerId, "local-recolor");
  const request = JSON.parse(
    await readFile(path.join(input.directory, "request.json"), "utf8"),
  );
  assert.equal(request.edit.color, "#ed78a4");
  await assert.rejects(
    registry.preflight([{ ...input.job, edit: { mode: "whole" } }]),
    /recolor request/,
  );
});

test("region validation rejects changed originals, wrong reference order and incompatible masks", async (t) => {
  const f = await fixtures(t);
  await assert.rejects(
    prepareRegionInputs(
      { images: f.images, edit: { ...f.edit, sourceHash: "0".repeat(64) } },
      f.imagePaths,
    ),
    /original image changed/,
  );
  await assert.rejects(
    prepareRegionInputs(
      { images: f.images.toReversed(), edit: f.edit },
      f.imagePaths,
    ),
    /in that order/,
  );
  await sharp({
    create: { width: 3, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toFile(f.maskPath);
  await assert.rejects(
    prepareRegionInputs({ images: f.images, edit: f.edit }, f.imagePaths),
    /mask dimensions/,
  );
});

test("local recolor completes a normal durable queue job and appears in the shared gallery projection", async (t) => {
  const f = await fixtures(t),
    registry = registryFor(f.directory);
  await registry.reload();
  const store = new Store(f.directory);
  await store.init();
  try {
    const queue = new Queue(store, {
      adapter: (input) => registry.run(input),
      resolveAsset: (asset) =>
        f.imagePaths[f.images.findIndex((image) => image.asset === asset)],
    });
    const job = {
      ...context(f, "recolor", "local-recolor").job,
      dependencies: [],
      status: "queued",
      attempts: 0,
    };
    job.edit.rootEditorId = "root-editor";
    const graph = {
      id: "region-test",
      name: "Region recolor",
      nodes: [],
      edges: [],
    };
    const run = await queue.create(graph, {}, { graph, jobs: [job] });
    const deadline = Date.now() + 5000;
    while (run.status === "running" && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await store.flush();
    assert.equal(run.status, "completed", run.jobs[0].error);
    const gallery = galleryItems([run]);
    assert.equal(gallery.length, 1);
    assert.equal(gallery[0].edit.rootEditorId, "root-editor");
    assert.match(gallery[0].output, /\/files\/runs\/.+\/image\/output.png$/);
    const actual = await decodeRegionSource(
      path.join(f.directory, "runs", run.id, "image", "output.png"),
    );
    assert.deepEqual(actual.data.subarray(8), source.data.subarray(8));
  } finally {
    store.db.close();
  }
});

test("region source orientation and same-framing candidate resizing use the original coordinate frame", async (t) => {
  const f = await fixtures(t);
  const oriented = await sharp({
    create: { width: 3, height: 2, channels: 3, background: "#abc" },
  })
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer();
  const decoded = await decodeRegionSource(oriented);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 3);
  const registry = registryFor(f.directory);
  await registry.reload();
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: "pink" },
  })
    .png()
    .toFile(f.candidatePath);
  const result = await registry.run(context(f, "region"));
  assert.equal(result.metadata.width, 2);
  assert.equal(result.metadata.height, 2);
  const actual = await decodeRegionSource(result.path);
  assert.deepEqual(actual.data.subarray(8), source.data.subarray(8));
});

test("region compositing rejects major reframing instead of silently stretching the patch", async (t) => {
  const f = await fixtures(t),
    registry = registryFor(f.directory);
  await registry.reload();
  await sharp({
    create: { width: 4, height: 2, channels: 3, background: "pink" },
  })
    .png()
    .toFile(f.candidatePath);
  await assert.rejects(
    registry.run(context(f, "region")),
    /changed the framing/,
  );
});
