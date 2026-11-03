import test from "node:test";
import assert from "node:assert/strict";
import {
  reasoningLevels,
  selectedReasoning,
  ollamaReasoning,
  ollamaThink,
} from "../shared/reasoning.mjs";
import * as pi from "../harness-integrations/pi/index.mjs";
import * as claude from "../harness-integrations/claude-code/index.mjs";
import { harnessModelOptions } from "../src/agent/harness-model-options.mjs";

test("thinking choices follow native capabilities and never imply arbitrary API support", () => {
  assert.deepEqual(reasoningLevels({ id: "api-custom" }, "writer"), []);
  assert.deepEqual(
    reasoningLevels(
      {
        id: "codex-text",
        modelDetails: [
          { id: "limited", reasoning: { levels: ["low", "high"] } },
        ],
      },
      "limited",
    ),
    ["low", "high"],
  );
  assert.equal(
    selectedReasoning({ id: "ollama" }, "missing", "high"),
    "inherit",
  );
  assert.deepEqual(
    ollamaReasoning({ thinking: { values: [false, true], default: true } }),
    { levels: ["off", "on"], default: true },
  );
  assert.equal(
    ollamaThink({ thinking: { values: [false, true] } }, "on"),
    true,
  );
  assert.equal(ollamaThink({}, "inherit"), undefined);
});
test("Pi and Claude thinking controls reach their own CLIs and Auto leaves native settings intact", () => {
  const context = {
    job: { prompt: "Write", model: "default", reasoningEffort: "high" },
    imagePaths: [],
  };
  assert.ok(pi.invocation(context).args.join(" ").includes("--thinking high"));
  assert.ok(
    claude.invocation(context).args.join(" ").includes("--effort high"),
  );
  context.job.reasoningEffort = "inherit";
  assert.equal(pi.invocation(context).args.includes("--thinking"), false);
  assert.equal(claude.invocation(context).args.includes("--effort"), false);
});
test("a saved Ollama model stays selectable without mutating the catalog", () => {
  const providers = [
    {
      id: "ollama",
      name: "Ollama",
      ready: true,
      local: true,
      capabilities: ["text"],
      modelDetails: [
        {
          id: "small",
          capabilities: ["text"],
          reasoning: { levels: ["off", "on"] },
        },
      ],
    },
  ];
  const before = structuredClone(providers);
  const groups = harnessModelOptions(providers, "ollama", "saved-large");
  assert.equal(groups[0].children.length, 2);
  assert.deepEqual(providers, before);
});
