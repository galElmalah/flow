import test from "node:test";
import assert from "node:assert/strict";
import { canvasIdentity, canvasShortcut } from "../src/canvas/shortcuts.mjs";

test("Tab and Space preserve focused button behavior and dialogs do not open the node picker", () => {
  assert.equal(canvasShortcut({ key: "Tab" }), "add");
  assert.equal(
    canvasShortcut({ key: "Tab" }, { interactiveFocus: true }),
    null,
  );
  assert.equal(canvasShortcut({ key: "Tab" }, { dialogOpen: true }), null);
  assert.equal(
    canvasShortcut({ key: " ", code: "Space" }, { interactiveFocus: true }),
    null,
  );
  assert.equal(canvasShortcut({ key: " ", code: "Space" }), "pan");
  assert.equal(canvasShortcut({ key: "Tab" }, { editing: true }), null);
  assert.equal(
    canvasShortcut({ key: "Escape" }, { dialogOpen: true, editing: true }),
    "escape",
  );
});

test("recorded canvases allow navigation but block editing shortcuts", () => {
  for (const event of [
    { key: "d", metaKey: true },
    { key: "z", ctrlKey: true },
    { key: "Delete" },
    { key: "Enter", metaKey: true },
    { key: "Tab" },
  ])
    assert.equal(canvasShortcut(event, { readOnly: true }), null);
  assert.equal(
    canvasShortcut({ key: " ", code: "Space" }, { readOnly: true }),
    "pan",
  );
  assert.equal(
    canvasShortcut({ key: "!", shiftKey: true }, { readOnly: true }),
    "fit",
  );
  assert.notEqual(
    canvasIdentity({ workflow: { id: "a" } }),
    canvasIdentity({ workflow: { id: "a" }, viewingRun: { id: "recorded" } }),
  );
});
