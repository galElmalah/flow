# Compare providers and retain asset lineage

A generation node can run several named modes against the same input. Each mode chooses
its provider, model and copies. Prompt text, source records and references stay shared.
For example, Codex ×4 plus Grok ×4 produces eight images per input record. Adding modes
or saving a workflow never starts generation. Plan before running.

## Grok setup

Open **Settings → API connections → Grok Imagine**. Store an xAI key there, set
`XAI_API_KEY` in the server environment, or use a private local connection file:

```sh
node cli/flow.mjs providers configure-grok --from /absolute/path/private-grok.json
node cli/flow.mjs providers grok --json
```

The private file is `{ "apiKey": "YOUR_KEY" }`. Omit the key to keep it, use a string to
replace it, or `null` to clear the saved key. Reads never return the key. Environment
credentials still apply after clearing a saved key. No credentials belong in graphs.

`grok-image` uses Imagine Image 2.0 for text generation or JSON image edits, with up to
five ordered image references. Quality is low, medium or auto; resolution is 1k, 1.5k or
2k. `grok-video` offers Imagine Video 1.5 and Lite, with duration 1–15 seconds and supported
480p/720p/1080p modes. Auto selects text, pinned first frame or reference mode from the
actual reference count. Explicit incompatible settings fail before inference. Pinned
first-frame videos inherit the source framing; reference-to-video supports up to 720p.
Only provider-reported render percentages appear as render progress.

The [official xAI account FAQ](https://docs.x.ai/console/faq/accounts) states that Grok and
API accounts can be shared but billing is separate. A consumer subscription is not proof
of API entitlement. Flow uses the documented native API, with no browser generation or
consumer-cookie authentication. A configured key is not a successful inference test.

## Create the same comparison through CLI or MCP

```sh
node cli/flow.mjs workflow create --project sports-agent-visuals \
  --name "Provider comparison" --prompt "Monochrome cycling photography" \
  --seed-image ./reference.png --ratio 2:1 --modes examples/comparison-modes.json --json
node cli/flow.mjs plan --workflow WORKFLOW_ID --project sports-agent-visuals --json
node cli/flow.mjs run --workflow WORKFLOW_ID --project sports-agent-visuals --wait --json
```

The recipe also accepts `count:4` and modes without their own count. Explicit per-mode
counts take priority in saved graphs. A run-time `--count` overrides every mode; `--provider`
or `--model` overrides are rejected for a node with explicit modes, so comparisons cannot
silently collapse. Use `--node` when applying a modes file to a graph with several generators.
Image and video nodes remain separate; a video node cannot select Codex's image provider.

The JavaScript helpers `createImageWorkflow` and `createVideoWorkflow`, and MCP tools
`create_image_workflow` / `create_video_workflow`, accept the same `modes` array. A mode is
`{id,label,providerId,model?,count?,seed?,ratio?,quality?,image?,video?}`. Shared settings
apply unless explicitly overridden. Supplied `image` or `video` objects replace the whole
shared settings object, allowing a Gemini mode to clear Grok-specific duration controls.
Each recorded job freezes its mode, comparison group, input index and zero-based copy index.
Copy indices and variation labels match across modes unless a mode explicitly changes its seed.
Codex uses variation labels; xAI does not receive a seed. This is not cross-provider determinism.

## Inspect and label an asset

Click an image in a collection, gallery, generator preview or seed node. Its inspector
opens **Lineage** first, with the saved resolved prompt, shared templates, source records,
provider/model, requested settings, provider-reported values and mode/copy identity.
Click a source image to follow its history; **Back to previous image** returns to the
result. The full-size viewer also has a **View image lineage** action. The region editor
has a **Lineage** tab, and image-version details show the same history without changing
the image or regions being edited. Captured input copies link to their original source;
their consumer's generation prompt is never presented as the source's prompt.

**Labels** holds editable annotations; **Inputs** and **Output** retain detailed job
inspection. Asset identity and SHA256 fingerprints are under saved evidence.
Direct parents and earlier ancestors include reference snapshots, generated prompts,
retained provider originals and editor masks where applicable. Missing historical evidence
is explicit. Asset occurrence identity is separate from content hash: equal bytes can have
different provenance and annotations.

New generation captures ordered inputs after resolving generated prompts. Image bytes
are copied into the job directory, checked against their source fingerprints, and sent to
the provider from those snapshots. Final output hashes are captured after normalization and
local edit compositing, before publishing completed status. Generated text is an asset too.
Image source snapshots can be reused; videos and text cannot enter image-only sockets or SAM.

Captions, tags, review decisions and training flags on **Labels** are revisioned independently. They
never rewrite the run's prompt or graph. Refresh/restart retains both generation and labels.
Old assets are indexed lazily with `historical-partial` evidence; a current hash cannot prove
which bytes were used in an old generation. Unreported model/seed values remain unknown.

```sh
node cli/flow.mjs assets --project sports-agent-visuals --run RUN_ID --json
node cli/flow.mjs asset lineage ASSET_ID --project sports-agent-visuals --json
node cli/flow.mjs asset annotate ASSET_ID --project sports-agent-visuals --from labels.json
node cli/flow.mjs dataset export --project sports-agent-visuals --workflow WORKFLOW_ID \
  --mode all --output asset-records.jsonl --json
```

A labels file can contain `{ "revision": 0, "caption": "A road cyclist", "tags": ["cycling"] }`.
Read the latest revision first; stale writes return409. Client methods are `assets`, `asset`,
`assetLineage`, `annotateAsset`, `exportDataset` and `datasetTarget`. MCP exposes `list_assets`,
`read_asset`, `read_asset_lineage`, `annotate_asset` and `asset_dataset_url`.

## Export for later training work

JSONL `mode=all` includes every matched asset, provenance, annotation revision and eligibility
reasons. `mode=training` filters to final assets with accepted review, explicit training
permission, confirmed rights, captured provenance and unchanged bytes. Response headers
report skipped counts and reasons. The ordinary run ZIP also includes `assets.jsonl` beside
its files and immutable `manifest.json`; filenames identify the mode. Project, workflow and
run filters are available. Exports are vendor-neutral records; no remote fine-tuning starts.

## Recovery

Both xAI images and videos use deferred requests. The queue persists a submission marker
before a paid POST and an accepted operation ID afterwards. Resume polls the same operation.
An ambiguous submission is blocked from automatic replay. Cancelling local work can leave
remote generation running; use the existing run's Resume control. Existing Gemini receipts
migrate to the same provider-neutral contract when the database opens.
