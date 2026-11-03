import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { libraryRulePayload } from "../src/panels/rule-library.mjs";
import {
  addRuleTemplates,
  builtInRules,
  rulePresets,
} from "../shared/rule-templates.mjs";

test("saving the same built-in snapshot twice reuses its library copy without touching applied rules", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-ui-rule-library-"));
  const store = new Store(root);
  await store.init();
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const applied = { ...builtInRules[0], enabled: false };
  const before = structuredClone(applied);
  const first = store.saveRuleTemplate(
    libraryRulePayload(applied, store.listRuleTemplates()),
  );
  const second = store.saveRuleTemplate(
    libraryRulePayload(applied, store.listRuleTemplates(), () => {
      throw new Error("An unchanged built-in must reuse its saved copy");
    }),
  );
  assert.equal(first.id, second.id);
  assert.equal(store.listRuleTemplates().length, 1);
  assert.deepEqual(applied, before);

  const edited = { ...applied, text: "My edited scenery instruction." };
  const editedCopy = store.saveRuleTemplate(
    libraryRulePayload(edited, store.listRuleTemplates()),
  );
  assert.notEqual(editedCopy.id, first.id);
  assert.equal(store.listRuleTemplates().length, 2);
  assert.equal(
    store.listRuleTemplates().find((rule) => rule.id === first.id).text,
    before.text,
  );

  store.saveRuleTemplate(
    libraryRulePayload(
      { ...editedCopy, text: "Update the existing custom entry." },
      store.listRuleTemplates(),
    ),
  );
  assert.equal(store.listRuleTemplates().length, 2);
  assert.deepEqual(applied, before);
});

test("reapplying every preset preserves edited rule snapshots and disabled selections", () => {
  const current = builtInRules.map((rule, i) => ({
    ...rule,
    text: `${rule.text}\nMy local edit ${i}`,
    enabled: i % 2 === 0,
  }));
  let actual = current;
  for (const preset of [...rulePresets, ...rulePresets]) {
    actual = addRuleTemplates(
      actual,
      builtInRules.filter((rule) => preset.rules.includes(rule.id)),
    );
  }
  assert.deepEqual(actual, current);
  assert.equal(actual.length, builtInRules.length);
});
