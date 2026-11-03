import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlow } from "@xyflow/react";
import { createServer } from "vite";

let vite, StudioContext, nodeTypes, ImageTray, ProviderPicker, AgentAccess;
before(async () => {
  vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  ({ StudioContext } = await vite.ssrLoadModule("/src/studio/context.jsx"));
  ({ nodeTypes } = await vite.ssrLoadModule("/src/nodes/index.mjs"));
  ({ ImageTray } = await vite.ssrLoadModule("/src/panels/ImageTray.jsx"));
  ({ AgentAccess } = await vite.ssrLoadModule("/src/panels/AgentAccess.jsx"));
  ({ ProviderPicker } = await vite.ssrLoadModule(
    "/src/panels/ProviderPicker.jsx",
  ));
});
after(async () => vite?.close());

function context(readOnly, starting = false) {
  return {
    readOnly,
    starting,
    providers: [],
    jobs: [],
    activeNodeIds: new Set(),
    outputSources: {},
    promptOrigins: new Map(),
  };
}
function canvas(readOnly, starting = false) {
  const nodes = [
    ["generate", { label: "Images" }],
    ["prompt-generate", { label: "Scene writer" }],
    ["image", { label: "Reference" }],
    ["variations", { label: "Directions", lines: "One\nTwo" }],
    [
      "filter",
      { label: "Quotes", filterField: "role", filterValues: ["quote"] },
    ],
    [
      "dataset",
      {
        label: "Records",
        records: [{ id: "row", fields: { scene: "Quiet study" } }],
      },
    ],
    ["output", { label: "Collection" }],
  ].map(([type, data], i) => ({
    id: `node-${i}`,
    type,
    data,
    position: { x: i * 400, y: 0 },
    width: 360,
    height: 500,
  }));
  return renderToStaticMarkup(
    React.createElement(
      StudioContext.Provider,
      { value: context(readOnly, starting) },
      React.createElement(ReactFlow, {
        width: 3000,
        height: 700,
        nodes,
        nodeTypes,
      }),
    ),
  );
}
const labelled = (html, label) => {
  const tag = html.match(new RegExp(`<[^>]+aria-label="${label}"[^>]*>`))?.[0];
  assert.ok(tag, `Missing control: ${label}`);
  return tag;
};

test("recorded-run canvas prevents mutations while live controls remain usable", () => {
  const recorded = canvas(true),
    live = canvas(false);
  for (const label of [
    "image generation mode 1",
    "Choose provider for Scene writer",
    "Aspect ratio for mode 1",
    "Model for Scene writer",
    "Run Collection",
  ]) {
    assert.match(labelled(recorded, label), /disabled=""/, label);
    assert.doesNotMatch(labelled(live, label), /disabled=""/, label);
  }
  for (const label of [
    "Copies for mode 1",
    "Variation label for mode 1",
    "Scene writer instructions",
    "Directions variations",
    "Quotes field",
    "Quotes values",
    "row scene",
  ]) {
    assert.match(labelled(recorded, label), /readOnly=""/, label);
    assert.doesNotMatch(labelled(live, label), /readOnly=""/, label);
  }
  assert.equal(
    (recorded.match(/class="node-run nodrag"[^>]*disabled=""/g) || []).length,
    3,
  );
  assert.match(recorded, /<input[^>]*disabled=""[^>]*type="file"/);
  assert.match(recorded, /<button[^>]*disabled=""[^>]*class="dataset-remove"/);
  assert.match(recorded, /<button[^>]*class="upload-empty"[^>]*disabled=""/);
});

test("recorded image inspector keeps download available and disables adding a seed", () => {
  const image = { output: "/assets/example.png" };
  const render = (readOnly) =>
    renderToStaticMarkup(
      React.createElement(
        StudioContext.Provider,
        { value: context(readOnly) },
        React.createElement(ImageTray, { image, providerName: (id) => id }),
      ),
    );
  assert.match(
    render(true),
    /<button[^>]*class="secondary-button"[^>]*disabled=""/,
  );
  assert.doesNotMatch(
    render(false),
    /<button[^>]*class="secondary-button"[^>]*disabled=""/,
  );
  assert.match(render(true), /href="\/assets\/example.png" download="/);
});

test("provider and seed labels preserve actual provenance and empty search is explained", () => {
  const renderNode = (type, data) =>
    renderToStaticMarkup(
      React.createElement(
        StudioContext.Provider,
        { value: context(false) },
        React.createElement(ReactFlow, {
          width: 1000,
          height: 700,
          nodeTypes,
          nodes: [
            {
              id: "node",
              type,
              data,
              position: { x: 0, y: 0 },
              width: 360,
              height: 500,
            },
          ],
        }),
      ),
    );
  const prompt = renderNode("prompt-generate", {
    label: "Writer",
    providerId: "my-offline-endpoint",
  });
  assert.match(prompt, /my-offline-endpoint/);
  assert.match(prompt, /Setup required/);
  const seed = renderNode("image", {
    label: "Seed",
    images: ["/assets/quoture-cast.jpg"],
  });
  assert.match(seed, /title="quoture-cast.jpg"/);
  assert.match(seed, /src="\/assets\/quoture-cast.jpg"/);
  assert.doesNotMatch(seed, /paper-study.png/);
  const picker = renderToStaticMarkup(
    React.createElement(ProviderPicker, { providers: [], operation: "text" }),
  );
  assert.match(picker, /role="status">No matching prompt providers/);
});

test("all node run buttons prevent duplicate submissions while workflow submission is pending", () => {
  const pending = canvas(false, true),
    ready = canvas(false, false);
  assert.equal(
    (pending.match(/class="node-run nodrag"[^>]*disabled=""/g) || []).length,
    3,
  );
  assert.equal(
    (ready.match(/class="node-run nodrag"[^>]*disabled=""/g) || []).length,
    0,
  );
  assert.doesNotMatch(labelled(pending, "Copies for mode 1"), /readOnly=""/);
});

test("recorded-run agent commands fork the saved graph before any plan or run", () => {
  const props = {
    workflow: { id: "original-workflow", projectId: "current-owner" },
    project: { id: "current-owner", name: "Project", root: "/tmp/project" },
    concurrency: 4,
  };
  const recorded = renderToStaticMarkup(
    React.createElement(AgentAccess, {
      ...props,
      recordedRun: {
        id: "saved-run",
        workflowId: "original-workflow",
        projectId: "original-owner",
      },
    }),
  );
  assert.match(
    recorded,
    /fork original-workflow --run saved-run --project original-owner --json/,
  );
  assert.match(
    recorded,
    /plan --workflow FORK_ID --project original-owner --json/,
  );
  assert.match(
    recorded,
    /run --workflow FORK_ID --project original-owner --concurrency 4 --wait --json/,
  );
  assert.match(
    recorded,
    /open original-workflow --run saved-run --gallery --project original-owner/,
  );
  assert.doesNotMatch(recorded, /(?:plan|run) --workflow original-workflow/);
  assert.doesNotMatch(recorded, /--project current-owner/);
  const live = renderToStaticMarkup(React.createElement(AgentAccess, props));
  assert.match(
    live,
    /plan --workflow original-workflow --project current-owner --json/,
  );
  assert.match(
    live,
    /run --workflow original-workflow --project current-owner/,
  );
  assert.doesNotMatch(live, /FORK_ID|--run saved-run/);
});
