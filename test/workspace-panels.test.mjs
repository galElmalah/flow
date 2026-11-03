import test from "node:test";
import assert from "node:assert/strict";
import {
  changeWorkspacePanel,
  workspacePanelVisibility,
} from "../src/studio/workspace-panels.mjs";
import { tooltipPosition } from "../src/components/tooltip-position.mjs";

test("opening another workspace panel replaces the previous panel instead of stacking menus", () => {
  let active = null;
  for (const target of [
    "library",
    "workflows",
    "guide",
    "workflows",
    "runs",
    "library",
    "properties",
  ]) {
    active = changeWorkspacePanel(active, target, true);
    const visible = workspacePanelVisibility(active);
    assert.equal(Object.values(visible).filter(Boolean).length, 1);
    assert.equal(active, target);
  }
  assert.deepEqual(workspacePanelVisibility("workflows"), {
    library: false,
    flowMenu: true,
    panel: null,
  });
});

test("queued close operations for an old panel cannot close the newly opened panel", () => {
  let active = changeWorkspacePanel("workflows", "guide", true);
  active = changeWorkspacePanel(active, "workflows", false);
  active = changeWorkspacePanel(active, "library", false);
  assert.equal(active, "guide");
  assert.equal(changeWorkspacePanel(active, "guide", false), null);
  assert.equal(
    changeWorkspacePanel("library", "library", (open) => !open),
    null,
  );
  assert.equal(
    changeWorkspacePanel("runs", "library", (open) => !open),
    "library",
  );
});

test("hover labels flip away from viewport edges and stay inside the window", () => {
  const tip = { width: 180, height: 32 },
    screen = { width: 390, height: 844 };
  const rail = {
    left: 10,
    top: 120,
    right: 50,
    bottom: 160,
    width: 40,
    height: 40,
  };
  const beside = tooltipPosition(rail, tip, screen, "right");
  assert.equal(beside.side, "right");
  assert.equal(beside.left, 59);
  const nearRight = tooltipPosition(
    { ...rail, left: 340, right: 380 },
    tip,
    screen,
    "right",
  );
  assert.equal(nearRight.side, "left");
  assert.ok(nearRight.left >= 8);
  const nearTop = tooltipPosition(
    { ...rail, top: 10, bottom: 50 },
    tip,
    screen,
  );
  assert.equal(nearTop.side, "bottom");
  assert.equal(nearTop.top, 59);
  const nearBottom = tooltipPosition(
    { ...rail, top: 800, bottom: 840 },
    tip,
    screen,
    "bottom",
  );
  assert.equal(nearBottom.side, "top");
  assert.ok(nearBottom.top + tip.height <= 836);
});
