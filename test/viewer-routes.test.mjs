import test from "node:test";
import assert from "node:assert/strict";
import { viewerPath, viewerParams } from "../shared/viewer-routes.mjs";

const parse = (path) =>
  Object.fromEntries(viewerParams(new URL(path, "http://localhost:4310")));

test("canonical viewer paths preserve ordered project, workflow, run, library, node and editor targets", () => {
  for (const [target, path, decoded] of [
    [{}, "/projects", { view: "projects" }],
    [
      { view: "projects", project: "sports" },
      "/project/sports",
      { project: "sports", view: "projects" },
    ],
    [
      { project: "sports", workflow: "motion", view: "canvas" },
      "/project/sports/workflow/motion",
      { project: "sports", workflow: "motion" },
    ],
    [
      { workflow: "unassigned" },
      "/workflow/unassigned",
      { workflow: "unassigned" },
    ],
    [
      { run: "historic", gallery: true },
      "/run/historic/gallery",
      { run: "historic", gallery: "1" },
    ],
    [{ view: "gallery" }, "/gallery", { gallery: "1" }],
    [{ view: "styles" }, "/styles", { view: "styles" }],
    [
      {
        project: "sports",
        workflow: "motion",
        run: "historic",
        gallery: "1",
        node: "brief",
        editor: "mask",
      },
      "/project/sports/workflow/motion/run/historic/gallery/node/brief/editor/mask",
      {
        project: "sports",
        workflow: "motion",
        run: "historic",
        gallery: "1",
        node: "brief",
        editor: "mask",
      },
    ],
    [
      { project: "sports", workflow: "motion", view: "styles", node: "brief" },
      "/project/sports/workflow/motion/styles/node/brief",
      { project: "sports", workflow: "motion", view: "styles", node: "brief" },
    ],
    [
      { editor: "mask", view: "projects" },
      "/editor/mask",
      { editor: "mask", view: "projects" },
    ],
    [
      { project: "sports", editor: "mask", view: "projects" },
      "/project/sports/editor/mask",
      { project: "sports", editor: "mask", view: "projects" },
    ],
    [
      { project: "sports", node: "default-brief" },
      "/project/sports/node/default-brief",
      { project: "sports", node: "default-brief" },
    ],
  ]) {
    assert.equal(viewerPath(target), path);
    assert.deepEqual(parse(path), decoded);
    assert.equal(viewerPath(viewerParams(path)), path);
    assert.equal(new URL(path, "http://localhost:4310").search, "");
  }
  assert.deepEqual(parse("/project/sports/workflow/motion/"), {
    project: "sports",
    workflow: "motion",
  });
});

test("viewer identifiers encode once, including slash, percent, Unicode, question and hash characters", () => {
  const target = {
    project: "project & /",
    workflow: "flow? # /%2F",
    run: "🏃 / #",
    node: "field/%2F?",
    editor: "selected & regions",
  };
  const path = viewerPath(target);
  assert.match(path, /^\/project\/project%20%26%20%2F\/workflow\//);
  assert.deepEqual(parse(path), target);
  assert.equal(viewerPath(viewerParams(path)), path);
});

test("legacy query targets remain readable and normalize to query-free paths", () => {
  const legacy =
    "/?project=sports&workflow=motion&node=brief&gallery=1&utm_source=old-link";
  assert.deepEqual(parse(legacy), {
    project: "sports",
    workflow: "motion",
    node: "brief",
    gallery: "1",
  });
  assert.equal(
    viewerPath(viewerParams(legacy)),
    "/project/sports/workflow/motion/gallery/node/brief",
  );
  assert.deepEqual(parse("/?view=projects&editor=mask"), {
    view: "projects",
    editor: "mask",
  });
  assert.equal(
    viewerPath(viewerParams("/?view=projects&editor=mask")),
    "/editor/mask",
  );
  assert.deepEqual(parse("/"), {});
});

test("malformed or ambiguously ordered paths fail explicitly instead of opening another target", () => {
  for (const path of [
    "/unknown",
    "/project",
    "/workflow",
    "/workflow/%20",
    "/project//workflow/motion",
    "/workflow/motion/project/sports",
    "/node/brief/workflow/motion",
    "/node/brief",
    "/workflow/first/workflow/second",
    "/styles/styles",
    "/gallery/styles",
    "/styles/gallery",
    "/projects/workflow/motion",
    "/project/sports/projects",
    "/editor/mask/node/brief",
    "/workflow/%E0%A4%A",
    "/workflow/motion?workflow=other",
    "/workflow/motion#node=brief",
    "/?workflow=one&workflow=two",
    "/__proto__",
  ]) {
    const params = viewerParams(path);
    assert.equal(params.has("__routeError"), true, path);
    assert.equal(
      params.size,
      1,
      "Invalid routes must not expose partially parsed targets",
    );
  }
  for (const target of [
    { workflow: "" },
    { workflow: ".." },
    { node: "brief" },
    { workflow: 7 },
    { view: "unknown" },
    { gallery: "maybe" },
    { view: "styles", gallery: true },
    { view: "projects", workflow: "motion" },
    new URLSearchParams("workflow=one&workflow=two"),
  ])
    assert.throws(() => viewerPath(target));
});
