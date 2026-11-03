import test from "node:test";
import assert from "node:assert/strict";
import {
  harnessModelOptions,
  engineValue,
} from "../src/agent/harness-model-options.mjs";

test("one harness menu groups real text models, disabled harnesses, compatible endpoints and saved selections", () => {
  const providers = [
    {
      id: "codex-text",
      name: "Codex",
      ready: true,
      capabilities: ["text"],
      models: ["default"],
    },
    {
      id: "claude-code",
      name: "Claude Code",
      ready: false,
      status: "Not signed in",
      capabilities: ["text"],
      models: ["default"],
    },
    {
      id: "custom",
      name: "My endpoint",
      ready: true,
      managed: true,
      capabilities: ["text", "image"],
      modelDetails: [
        { id: "writer", capabilities: ["text"] },
        { id: "image-only", capabilities: ["image"] },
      ],
    },
    {
      id: "image",
      name: "Image only",
      ready: true,
      capabilities: ["image"],
      models: ["image"],
    },
  ];
  const snapshot = structuredClone(providers);
  assert.equal(
    harnessModelOptions(
      [{ ...providers[0], authMethod: "api-key" }],
      "codex-text",
      "default",
    )[0].description,
    "API billing",
  );
  const options = harnessModelOptions(providers, "codex-text", "saved-model");
  assert.equal(options.length, 3);
  assert.equal(options[0].children.length, 2);
  assert.deepEqual(JSON.parse(options[0].children[1].value), [
    "codex-text",
    "saved-model",
  ]);
  assert.equal(options[1].disabled, true);
  assert.equal(options[1].children[0].disabled, true);
  assert.equal(options[2].children.length, 1);
  assert.equal(options[2].children[0].value, engineValue("custom", "writer"));
  assert.deepEqual(
    providers,
    snapshot,
    "building a menu never modifies the provider catalog",
  );
});
