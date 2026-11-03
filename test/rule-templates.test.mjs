import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { Store } from "../server/store.mjs";
import { planWorkflow } from "../server/graph.mjs";
import { validateGraph } from "../shared/graph.mjs";
import { promptGuide } from "../shared/prompt-guide.mjs";
import {
  addRuleTemplates,
  builtInRules,
  inheritedRules,
  mergeRules,
  ruleConflicts,
} from "../shared/rule-templates.mjs";
import { WeftClient } from "../client/index.mjs";
import { registerRuleTemplateRoutes } from "../server/routes/rule-templates.mjs";

const rule = (id, enabled = true) => ({
  ...structuredClone(builtInRules.find((r) => r.id === id)),
  enabled,
});
const node = (id, type, data) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, ...data },
});
const edge = (source, target) => ({
  id: `${source}-${target}`,
  source,
  target,
});
function graph() {
  return {
    id: "rules-qa",
    name: "Rules QA",
    nodes: [
      node("base", "prompt", {
        text: "A quiet visual family",
        rules: [
          rule("fresh-scenery"),
          rule("distinct-faces"),
          rule("varied-skin-tones", false),
        ],
      }),
      node("records", "dataset", {
        records: [
          { id: "a", fields: { scene: "Shared gardening" } },
          { id: "b", fields: { scene: "Travellers helping" } },
        ],
      }),
      node("scene", "template", {
        text: "Scene: {{scene}}",
        rules: [rule("vary-composition")],
      }),
      node("writer", "prompt-generate", {
        text: "Write a scene brief",
        rules: [rule("style-without-likeness")],
      }),
      node("artwork", "template", {
        text: "{{input}}\nOne illustration",
        rules: [rule("no-incidental-lettering")],
      }),
      node("image", "generate", {
        count: 2,
        rules: [rule("clear-focal-action")],
      }),
    ],
    edges: [
      edge("base", "scene"),
      edge("records", "scene"),
      edge("scene", "writer"),
      edge("writer", "artwork"),
      edge("base", "artwork"),
      edge("artwork", "image"),
    ],
  };
}

test("enabled rules survive record templates, generated text, parallel copies and shared branches", () => {
  const input = graph();
  const plan = planWorkflow(input);
  assert.equal(plan.textJobs, 2);
  assert.equal(plan.imageJobs, 4);
  for (const job of plan.jobs) {
    assert.match(job.prompt, /Fresh scenery:/);
    assert.match(job.prompt, /Distinct faces in this scene:/);
    assert.match(job.prompt, /Vary composition:/);
    assert.match(job.prompt, /Style without likeness:/);
    assert.doesNotMatch(job.prompt, /Varied skin tones:/);
    assert.equal(job.prompt.split("Fresh scenery:").length - 1, 1);
    if (job.kind === "image") {
      assert.equal(job.rules.length, 6);
      assert.match(job.prompt, /No incidental lettering:/);
      assert.match(job.prompt, /Clear focal action:/);
      assert.equal(job.dependencies.length, 1);
      assert.equal(job.promptParts.filter((p) => p.jobId).length, 1);
    } else assert.equal(job.rules.length, 4);
  }
  input.nodes[0].data.rules[0].text = "Edited after planning";
  assert.notEqual(plan.jobs[0].rules[0].text, "Edited after planning");
  assert.equal(
    mergeRules(inheritedRules("image", input.nodes, input.edges)).length,
    5,
  );
});

test("rule additions retain edited snapshots and disabled states, with validated node ownership", () => {
  const current = [rule("fresh-scenery", false)];
  current[0].text = "My edited scenery instruction";
  const added = addRuleTemplates(current, [
    rule("fresh-scenery"),
    rule("distinct-faces"),
  ]);
  assert.equal(added.length, 2);
  assert.equal(added[0].text, "My edited scenery instruction");
  assert.equal(added[0].enabled, false);
  const input = graph();
  input.nodes[0].data.rules.push(rule("fresh-scenery"));
  assert.throws(() => validateGraph(input), /Rule IDs must be unique/);
  input.nodes[0].data.rules = [];
  input.nodes[1].data.rules = [rule("fresh-scenery")];
  assert.throws(
    () => validateGraph(input),
    /Rules cannot be attached to dataset/,
  );
});

test("rules-only base prompts stay discoverable and disabled rules contribute no text", () => {
  const input = graph();
  input.nodes[0].data.text = "";
  assert.equal(promptGuide(input).starts[0].id, "base");
  input.nodes[0].data.rules = [rule("fresh-scenery", false)];
  assert.equal(promptGuide(input).optional[0].id, "base");
  assert.doesNotMatch(planWorkflow(input).jobs[0].prompt, /Fresh scenery:/);
});

test("skin-tone conflicts refer only to actual upstream subject instructions", () => {
  const input = graph();
  input.nodes[0].data.rules = [rule("varied-skin-tones")];
  assert.deepEqual(ruleConflicts("image", input.nodes, input.edges), []);
  input.nodes[0].data.text = "Engrave warm ivory subjects on a blue field";
  assert.equal(ruleConflicts("image", input.nodes, input.edges).length, 1);
  input.nodes[0].data.text =
    "Leave a warm ivory background around the subjects";
  assert.deepEqual(ruleConflicts("image", input.nodes, input.edges), []);
  input.nodes[0].data.text = "Warm ivory subjects";
  input.nodes[0].data.rules[0].enabled = false;
  assert.deepEqual(ruleConflicts("image", input.nodes, input.edges), []);
});

test("custom library HTTP writes survive database reopen without changing applied snapshots", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "weft-rules-"));
  const store = new Store(root);
  await store.init();
  let server;
  let reopened;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (reopened) await reopened.close();
    else await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const app = express();
  app.use(express.json());
  registerRuleTemplateRoutes(app, { store });
  app.use((error, req, res, next) =>
    res.status(400).json({ error: error.message }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const client = new WeftClient({
    url: `http://127.0.0.1:${server.address().port}`,
  });
  const catalog = await client.ruleTemplates();
  assert.equal(catalog.builtIn.length, 8);
  assert.equal(catalog.presets.length, 3);
  const template = {
    id: "open-horizon",
    title: "Open horizon",
    text: "Keep the horizon clear.",
  };
  const saved = await client.saveRuleTemplate(template);
  const input = graph();
  input.nodes[0].data.rules = [{ ...saved, enabled: true }];
  await store.saveWorkflow(validateGraph(input).graph);
  await client.saveRuleTemplate({
    ...template,
    text: "A revised library instruction.",
  });
  await assert.rejects(
    () => client.saveRuleTemplate(builtInRules[0]),
    /Built-in rules cannot be overwritten/,
  );
  await assert.rejects(() =>
    client.saveRuleTemplate({ ...template, text: "" }),
  );
  await store.close();
  reopened = new Store(root);
  await reopened.init();
  assert.equal(reopened.listRuleTemplates().length, 1);
  assert.equal(
    reopened.listRuleTemplates()[0].text,
    "A revised library instruction.",
  );
  assert.equal(
    reopened.workflows.get(input.id).nodes[0].data.rules[0].text,
    "Keep the horizon clear.",
  );
});
