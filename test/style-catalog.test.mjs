import test from "node:test";
import assert from "node:assert/strict";
import { builtInStyles } from "../shared/styles/catalog.mjs";

test("built-in style library offers 257 distinct reusable styles with baseline scenes", () => {
  assert.equal(builtInStyles.length, 257);
  assert.equal(
    new Set(builtInStyles.map(({ id }) => id)).size,
    builtInStyles.length,
  );
  assert.equal(
    new Set(builtInStyles.map(({ name }) => name.toLowerCase())).size,
    builtInStyles.length,
  );
  assert.equal(
    new Set(builtInStyles.map(({ prompt }) => prompt)).size,
    builtInStyles.length,
  );
  const categories = new Map();
  for (const style of builtInStyles) {
    assert.match(style.id, /^[a-z0-9][a-z0-9-]{0,99}$/);
    for (const field of [
      "name",
      "category",
      "description",
      "prompt",
      "scene",
      "referencePrompt",
    ]) {
      assert.equal(typeof style[field], "string", `${style.id}.${field}`);
      assert.ok(style[field].trim().length > 0, `${style.id}.${field}`);
    }
    assert.ok(
      style.description.length < 110,
      `${style.id}: concise description`,
    );
    assert.ok(
      style.prompt.startsWith("Use "),
      `${style.id}: reusable direction`,
    );
    assert.ok(style.tags.length >= 2);
    assert.equal(new Set(style.tags).size, style.tags.length);
    assert.ok(style.tags.every((tag) => typeof tag === "string" && tag.trim()));
    categories.set(style.category, (categories.get(style.category) ?? 0) + 1);
  }
  assert.equal(categories.size, 14);
  assert.ok([...categories.values()].every((count) => count >= 15));
  assert.equal(categories.get("Photography"), 20);
  for (const id of [
    "realist-painting",
    "brutalism",
    "neo-brutalism",
    "analytic-cubism",
    "synthetic-cubism",
    "sports-performance-ad",
    "app-device-hero-ad",
    "fitness-app-ad",
    "pointillism",
    "chaekgeori",
    "cameo-glass",
    "warp-ikat",
    "pochoir",
    "double-exposure",
    "pinscreen-animation",
    "schlieren-flow",
  ])
    assert.ok(
      builtInStyles.some((style) => style.id === id),
      id,
    );
});

test("every reference brief is a unique concrete new artwork with consistent rendering constraints", () => {
  const scenes = new Set();
  for (const style of builtInStyles) {
    const words = style.referencePrompt.split(/\s+/).length;
    assert.ok(words >= 80 && words <= 130, `${style.id}: ${words} words`);
    assert.match(style.referencePrompt, /square 1:1/);
    assert.ok(
      style.referencePrompt.includes(style.prompt),
      `${style.id}: style fidelity`,
    );
    assert.match(
      style.referencePrompt,
      /Do not add lettering, labels, numbers, signatures, watermarks or logos/,
    );
    assert.match(
      style.referencePrompt,
      /invent anonymous faces with distinct features/,
    );
    assert.match(style.referencePrompt, /newly generated style demonstration/);
    assert.doesNotMatch(
      style.referencePrompt,
      /original museum|public domain photograph|authentic archival photograph/i,
    );
    const concreteScene = style.referencePrompt.split(style.prompt)[0];
    assert.ok(
      concreteScene.split(/\s+/).length > 18,
      `${style.id}: concrete scene`,
    );
    assert.ok(!scenes.has(concreteScene), `${style.id}: distinct scene`);
    scenes.add(concreteScene);
  }
});

test("Quoture's engraving preset preserves its medium without binding future subjects to quotes", () => {
  const quoture = builtInStyles.find(({ id }) => id === "quoture-engraving");
  assert.ok(quoture);
  assert.equal(quoture.category, "Printmaking");
  assert.match(quoture.prompt, /copperplate and woodcut collage/);
  assert.match(quoture.prompt, /warm ivory subjects/);
  assert.match(quoture.prompt, /crosshatching/);
  assert.match(quoture.prompt, /spare open composition/);
  assert.doesNotMatch(quoture.prompt, /quote|reading|chair|friends|column/i);
});
