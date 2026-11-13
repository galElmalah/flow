# Start from a visual style

Open **Styles** in the canvas toolbar. Search for a medium, mood or visual language,
filter a category, or save favorites. Open a card to read the exact style instruction
and inspect its generated reference image. **Start workflow** saves a new independent
workflow in the selected project; it does not begin generation.

The workflow separates **Style** from **Your scene**. Each style includes a baseline
`scene` describing the subject, setting and composition. Choosing a reference fills
the editable scene prompt from its recorded scene (or the original style study).
**Use reference scene** restores that baseline; switching references preserves a
scene you have edited. Client, CLI and MCP workflow creation use the same default
when `subject` is omitted. Explicit subjects override it.

Edit the scene prompt, keep or
replace the reference, then plan and run. The style prompt and reference URLs are
snapshotted in `node.data.style`; later library changes never rewrite old workflows
or recorded runs. A reference illustrates a visual language rather than promising
that every model will reproduce it exactly.

The library has 257 built-in style briefs across 14 families. Each includes a
reusable rendering instruction, a separate scene and a complete reference-generation
brief. Preview images belong to the local installation; a fresh clone does not
include pre-generated previews. Uploaded references retain their source notes;
generated references retain recorded run/job provenance. Missing or active
references show their real state. Favorites and reference bindings persist in the
platform's SQLite metadata.

The **Art & design movements** family includes realism, brutalism, neo-brutalism,
analytic and synthetic cubism, Bauhaus, De Stijl, Memphis and other movements.
**Advertising & campaigns** contains sports, footwear, fitness, app launch,
feature, creator-style, SaaS and product campaign directions. Ad references are
original generated composition studies with fictional placeholder screens;
use your own product assets and app screenshots for finished campaigns.

The expanded coverage includes:

| Area | Additional directions |
| --- | --- |
| Art movements and painting | Pointillism, Color Field, Action painting, Precisionism, Pre-Raphaelite, Rococo ornament, grisaille, reverse glass painting |
| Decorative traditions | Kalighat, Korean chaekgeori, Yamato-e roofless interiors, Egyptian registers, Attic red-figure, sgraffito slipware, agateware, wood marquetry, pietre dure, porcelain lithophane |
| Materials and textiles | Cameo glass, millefiori glass, repoussé metalwork, filament 3D printing, warp ikat, devoré velvet |
| Printmaking | Gyotaku, pochoir |
| Photography and drawing | Double exposure, fisheye, thermal imaging, photo-finish strips, darkfield microscopy, exploded assemblies |
| Graphics and animation | Screentone manga, ligne claire, vector arcade, rubber hose, pinscreen, sand animation |
| Experimental processes | Anthotype, schlieren flow, red-cyan stereo anaglyph |

These directions describe techniques rather than imitate a named artist. They
retain distinctions such as unmixed color dots versus monochrome stippling,
carved glass layers versus glass cane slices, and resist-dyed yarn versus painted
fabric. Technical imaging presets are creative simulations, not measurements or
calibrated stereo pairs.

Technique research includes the [Met's Yamato-e overview](https://www.metmuseum.org/essays/yamato-e-painting),
[Cleveland's chaekgeori article](https://www.clevelandart.org/articles/chaekgeori),
[V&A ceramics guide](https://www.vam.ac.uk/articles/a-z-of-ceramics),
[Corning's cameo glass study](https://info.cmog.org/publication/cameo-glass-masterpieces-2000-years-glassmaking),
[Australian Museum's ikat explanation](https://australian.museum/learn/cultures/international-collection/indonesia/ikat-design/),
[NFB's pinscreen demonstration](https://www.nfb.ca/film/pinscreen/),
[Nikon's darkfield guide](https://www.microscopyu.com/techniques/stereomicroscopy/darkfield-illumination)
and [NASA's schlieren explanation](https://www.grc.nasa.gov/www/k-12/airplane/tunvschlrn.html).
These are research links; their images are not bundled or represented as generated
Flow outputs. Generating previews remains an explicit operation using the selected
provider, as described below.

**Explore web reference collections** opens 15 curated collections covering
open-access art, materials, style guides and advertising archives. Entries include
source links and reuse notes. They are research links, not automatically imported
or cleared production assets. Related sources appear inside each style's drawer.
The same source collections and baseline scenes are returned by client/CLI/MCP
style reads.

## Add your own references

Choose **Add your own** in the library. Give the entry a name, choose or create a
category, and add a style prompt and baseline scene. Images are optional. Upload
up to 16 PNG, JPEG or WebP images; each can include a label, its own scene and prompt,
and optional source URL, creator and license notes. Use **Edit style & references**
to change your entry or remove references. Built-in drawers offer **Add reference
images** while keeping their original style definitions intact.

Custom entries belong to the installation's shared SQLite library. They survive
restarts, appear in search and start workflows like built-ins. No source-code edit,
credentials or hosted account is needed. Library edits never run a model or rewrite
existing workflow snapshots.

Agents can save `style.json`:

```json
{
  "id": "my-woodcuts",
  "name": "My woodcuts",
  "category": "My collection",
  "description": "My reusable engraving direction",
  "prompt": "Black ink woodcut, irregular carved lines, tactile ivory paper.",
  "scene": "Two friends planting a tree beside a small stone house.",
  "tags": ["woodcut", "editorial"]
}
```

```sh
node cli/flow.mjs style create --from style.json --seed-image ./reference.png --json
node cli/flow.mjs styles my-woodcuts --json
node cli/flow.mjs style update my-woodcuts --from changes.json --json
node cli/flow.mjs style start my-woodcuts --project quoture --json
```

`changes.json` contains only changed fields, for example `{"scene":"A boat at dawn."}`.
On update, `references` replaces the saved list; `[]` removes all references.
`--seed-image` uploads files and adds them to the input's `references` array. On
update, that resulting array replaces the old list too. Omit references to retain
them; use `style references ID --from references.json` to append/upsert by image URL.

HTTP exposes `POST /api/styles` for creation and `PUT /api/styles/:id` for partial
custom edits. Omit `id` for an automatically generated ID. An existing ID returns
409; read it or update it instead. Client methods are `createStyle(input)` and
`updateStyle(id, changes)`. MCP exposes `create_style` and `update_style` (with
`styleId`); use `upload_images` first, then pass the returned URL in a reference:

```json
{
  "url": "/files/uploads/your-upload.png",
  "label": "My source study",
  "kind": "uploaded",
  "scene": "A boat at dawn, with hills on the horizon.",
  "prompt": "Describe the image or preserve its original prompt here.",
  "source": {
    "url": "https://example.com/original",
    "creator": "Your studio",
    "license": "Original work"
  }
}
```

External source URLs are attribution links; image bytes must be uploaded locally.
Generated references can be explicitly reused from any completed image job: set
`kind: "generated"`, its actual output URL, `runId` and `jobId`. The server verifies
the output and retains the original recorded generation prompt. Uploaded prompts
and source notes are contributor-supplied. Reference-specific scenes take precedence
over the entry's baseline when starting a workflow.

## CLI

```sh
node cli/flow.mjs styles --search 'realism' --json
node cli/flow.mjs open --styles --project quoture
node cli/flow.mjs styles --category 'Photography' --json
node cli/flow.mjs styles STYLE_ID --json
node cli/flow.mjs style favorite STYLE_ID
node cli/flow.mjs style favorite STYLE_ID --unfavorite
node cli/flow.mjs style start STYLE_ID --project quoture --subject 'Two friends plant a tree' --json
node cli/flow.mjs open WORKFLOW_ID --project quoture
```

The catalog response includes the available category names; use those exact strings.
Search ranks the existing local image embedding index when reference images have
been indexed, with keyword matches retained first. `searchMode` reports `semantic`,
`keyword`, or `browse`. Pending/unindexed libraries remain searchable by name,
description and tags. No additional embedding service or key is required.

Upload a local image with `flow upload ./reference.png`, then use
`flow style references STYLE_ID --from references.json` with
`{"references":[{"url":"/files/uploads/…","label":"My reference","kind":"uploaded"}]}`.
Generated references require matching `runId`, `jobId`, and the completed output URL.
`flow style import-run RUN_ID` idempotently imports all completed image jobs whose
`records[].fields.styleId` matches a catalog style; it can be called during a run.

## Client and MCP

`FlowClient` exposes `styles`, `style`, `createStyle`, `updateStyle`, `favoriteStyle`, `startStyle`,
`styleReferences`, and `importStyleRun`. A project-bound client's new workflow inherits
that project and rejects conflicting explicit ownership. Style library/favorites are
workspace-wide. Reference imports enforce the connection's project when supplied.

MCP tools expose the same operations: `list_styles`, `read_style`,
`create_style`, `update_style`,
`start_style_workflow`, `set_style_favorite`, `add_style_references`, and
`import_style_reference_run`. Starting a style workflow never starts inference;
use `plan_workflow` before `run_workflow`.

To populate the built-in references through the native Codex harness, run
`node tools/style-references.mjs --execute`. It plans one image per selected style, saves
the batch in the **Flow · style library** project, and reuses that same run when
invoked again. It never silently submits a second batch. After completion,
`node tools/style-references.mjs --verify` decodes every image, checks distinct
content and style/job provenance, imports durable bindings, and prints a JSON receipt.
Keep the receipt local. Retry failed jobs through normal run controls.

To extend the library without repeating existing references, choose a new stable
batch ID: `node tools/style-references.mjs --workflow my-new-style-batch --missing --execute`.
The saved batch freezes its selected styles and prompts. Reusing the command
inspects that batch rather than submitting another. Verify it with
`node tools/style-references.mjs --workflow my-new-style-batch --verify`.
