import test from "node:test";
import assert from "node:assert/strict";
import { fitImage, zoomImage } from "../src/media/image-view-state.mjs";

test("large and portrait images fit the viewport without stretching or enlarging small originals", () => {
  assert.deepEqual(
    fitImage({ width: 2000, height: 1000 }, { width: 1000, height: 700 }),
    { zoom: 0.5, x: 0, y: 0 },
  );
  assert.deepEqual(
    fitImage({ width: 1000, height: 2000 }, { width: 1000, height: 700 }),
    { zoom: 0.35, x: 0, y: 0 },
  );
  assert.deepEqual(
    fitImage({ width: 200, height: 100 }, { width: 1000, height: 700 }),
    { zoom: 1, x: 0, y: 0 },
  );
  assert.deepEqual(fitImage({ width: 0, height: 0 }, { width: 0, height: 0 }), {
    zoom: 1,
    x: 0,
    y: 0,
  });
});

test("scroll zoom keeps the same image pixel under the pointer after panning", () => {
  const before = { zoom: 0.5, x: 120, y: -80 },
    point = { x: 250, y: 190 };
  const pixel = {
    x: (point.x - before.x) / before.zoom,
    y: (point.y - before.y) / before.zoom,
  };
  const after = zoomImage(before, 1.25, point);
  assert.equal(after.x + pixel.x * after.zoom, point.x);
  assert.equal(after.y + pixel.y * after.zoom, point.y);
  assert.deepEqual(zoomImage(after, 0.5, point), before);
});

test("zoom bounds retain a fitted very large image while allowing actual-size inspection", () => {
  const fit = fitImage(
    { width: 40000, height: 20000 },
    { width: 800, height: 600 },
  );
  const minimum = Math.min(0.05, fit.zoom);
  assert.equal(zoomImage(fit, 0.001, undefined, minimum).zoom, 0.02);
  assert.equal(zoomImage(fit, 1, undefined, minimum).zoom, 1);
  assert.equal(zoomImage(fit, 100, undefined, minimum).zoom, 8);
});
