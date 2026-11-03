import test from "node:test";
import assert from "node:assert/strict";
import {
  filterOptions,
  nextEnabled,
  popupPosition,
  findChoice,
  childChoices,
} from "../src/components/autocomplete-options.mjs";

test("autocomplete searches all query words across accents, labels and keywords", () => {
  const options = [
    { value: "one", label: "Café scenes", keywords: "French evening" },
    { value: "two", label: "Mountain morning" },
  ];
  assert.deepEqual(filterOptions(options, "CAFE french"), [options[0]]);
  assert.deepEqual(filterOptions(options, "mountain evening"), []);
  assert.deepEqual(filterOptions(options, "  "), options);
});

test("nested choices search models across harnesses and keep a parent query's entire submenu", () => {
  const options = [
    {
      value: "codex",
      label: "Codex",
      children: [
        { value: "a", label: "Fast model" },
        { value: "b", label: "Deep model" },
      ],
    },
    {
      value: "claude",
      label: "Claude Code",
      children: [{ value: "c", label: "Creative model" }],
    },
  ];
  assert.deepEqual(filterOptions(options, "deep"), [options[0]]);
  assert.deepEqual(childChoices(options[0], "deep"), [options[0].children[1]]);
  assert.deepEqual(childChoices(options[0], "codex deep"), [
    options[0].children[1],
  ]);
  assert.deepEqual(childChoices(options[0], "codex"), options[0].children);
  assert.equal(findChoice(options, "b"), options[0].children[1]);
  assert.equal(findChoice(options, "unknown"), undefined);
  assert.deepEqual(childChoices(undefined, "fast"), []);
});

test("keyboard selection skips disabled choices and wraps in either direction", () => {
  const options = [{ disabled: true }, {}, { disabled: true }, {}];
  assert.equal(nextEnabled(options, -1, 1), 1);
  assert.equal(nextEnabled(options, 1, 1), 3);
  assert.equal(nextEnabled(options, 3, 1), 1);
  assert.equal(nextEnabled(options, 0, -1), 3);
  assert.equal(nextEnabled([{ disabled: true }], -1, 1), -1);
  assert.equal(nextEnabled([], -1, 1), -1);
});

test("popup flips near viewport bottom and clamps horizontally without clipping", () => {
  const rect = { left: 760, right: 880, width: 120, top: 550, bottom: 580 };
  const position = popupPosition(rect, { width: 800, height: 600 }, 250);
  assert.equal(position.left, 612);
  assert.equal(position.width, 180);
  assert.equal(position.top, 295);
  assert.equal(position.maxHeight, 300);
  const below = popupPosition(
    { ...rect, left: 20, top: 20, bottom: 50 },
    { width: 800, height: 600 },
    100,
  );
  assert.equal(below.top, 55);
  assert.equal(below.left, 20);
});

test("autocomplete ranks visible label matches ahead of hidden IDs and keeps ties stable", () => {
  const options = [
    { value: "workflow:quoture-study", label: "This workflow · all history" },
    { value: "other", label: "Other project", keywords: "quoture" },
    { value: "suffix", label: "An unquotable scene" },
    { value: "word", label: "The Quoture studies" },
    { value: "project:quoture", label: "Quoture" },
    { value: "project:quoture-next", label: "Quoture next" },
  ];
  assert.deepEqual(
    filterOptions(options, "Quot").map((o) => o.value),
    [
      "project:quoture",
      "project:quoture-next",
      "word",
      "suffix",
      "other",
      "workflow:quoture-study",
    ],
  );
  assert.equal(filterOptions(options, " "), options);
});
