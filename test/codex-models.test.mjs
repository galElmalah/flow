import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexTextModels } from "../harness-integrations/codex/models.mjs";

test("Codex model discovery exposes listed model metadata without account data", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "weft-models-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  assert.deepEqual(await codexTextModels(home), []);
  const file = path.join(home, "models_cache.json");
  await writeFile(
    file,
    JSON.stringify({
      identity: "private-account",
      models: [
        {
          slug: "text-model",
          display_name: "Text model",
          visibility: "list",
          input_modalities: ["text"],
          private: "secret",
        },
        { slug: "hidden-model", visibility: "hide" },
        { slug: "invalid/model", visibility: "list" },
      ],
    }),
  );
  assert.deepEqual(await codexTextModels(home), [
    {
      id: "text-model",
      name: "Text model",
      capabilities: ["text"],
      acceptsImages: false,
    },
  ]);
  await writeFile(file, "broken cache");
  assert.deepEqual(await codexTextModels(home), []);
});
