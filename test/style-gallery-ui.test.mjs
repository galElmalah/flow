import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  interleaveStyles,
  referencePresentation,
  styleCategories,
} from "../src/styles/style-gallery-state.mjs";

const styles = [
  {
    id: "photo",
    name: "Quiet realism",
    category: "Photography",
    description: "Natural portraits",
    tags: ["daylight", "documentary"],
    prompt: "Skin texture",
    favorite: true,
  },
  {
    id: "ink",
    name: "Copper engraving",
    category: "Printmaking",
    description: "Etched fine lines",
    tags: ["ink"],
    prompt: "Crosshatched paper",
    favorite: false,
  },
];
test("style categories stay complete, unique and sorted while the result set is filtered", () => {
  assert.deepEqual(
    styleCategories(styles.slice(0, 1), [
      "Photography",
      "Painting",
      "Printmaking",
    ]),
    ["Painting", "Photography", "Printmaking"],
  );
});
test("default style browsing interleaves categories without losing, duplicating, or changing order within a category", () => {
  const styles = [
    { id: "photo-1", category: "Photography" },
    { id: "photo-2", category: "Photography" },
    { id: "paint-1", category: "Painting" },
    { id: "paint-2", category: "Painting" },
    { id: "paint-3", category: "Painting" },
    { id: "print-1", category: "Printmaking" },
  ];
  const result = interleaveStyles(styles);
  assert.deepEqual(
    result.map((style) => style.id),
    ["photo-1", "paint-1", "print-1", "photo-2", "paint-2", "paint-3"],
  );
  assert.equal(new Set(result).size, styles.length);
  assert.deepEqual(
    styles.map((style) => style.id),
    ["photo-1", "photo-2", "paint-1", "paint-2", "paint-3", "print-1"],
  );
  assert.deepEqual(interleaveStyles([]), []);
});
test("reference placeholders report actual queue and failure states without claiming missing work is underway", () => {
  assert.equal(referencePresentation("queued").label, "Reference queued");
  assert.equal(referencePresentation("running").label, "Generating reference");
  assert.equal(referencePresentation("retrying").active, true);
  assert.match(referencePresentation("failed").label, /failed/);
  assert.match(referencePresentation("interrupted").label, /stopped/);
  assert.equal(referencePresentation("missing").active, false);
  assert.equal(
    referencePresentation("missing").label,
    "No reference image yet",
  );
});

let vite, StyleGallery;
before(async () => {
  vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  ({ StyleGallery } = await vite.ssrLoadModule("/src/styles/StyleGallery.jsx"));
});
after(async () => vite?.close());
test("style library exposes discoverable search, autocomplete, favorite and canvas-return controls", () => {
  const html = renderToStaticMarkup(
    React.createElement(StyleGallery, {
      project: { id: "quoture", name: "Quoture" },
      onStart() {},
      onClose() {},
    }),
  );
  assert.match(html, /aria-label="Style library"/);
  assert.match(html, /aria-label="Search styles"/);
  assert.match(html, /role="combobox"[^>]*aria-label="Style category"/);
  assert.match(html, /aria-pressed="false"[^>]*>/);
  assert.match(html, /aria-label="Back to canvas"/);
  assert.match(html, /Add your own/);
  assert.match(html, /role="status"[^>]*>[\s\S]*Loading styles…/);
});
