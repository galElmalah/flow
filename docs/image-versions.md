# Edit image regions and keep version history

Each image edit saves a new version in the same local project. The original stays
available, and the editor shows the whole family of versions, including edits made
from a previous version. Choose a version to continue working from it.

## Choose an operation

Whole-image generation is the default for AI edits, including inline **Send to agent**. Regions and comments guide the requested change, but no binary mask is pasted over the result. This avoids visible seams caused by imperfect mask boundaries. The original remains in history; the new rendering may change any pixel. Use the existing sports pink-jersey example for a simple local region recolor.


| Mode      | Use it for                                                          | What changes                                                                                                                                            | Segments on the result                                                                             |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `region`  | Advanced explicit API operation; avoid for ordinary AI edits | AI generates a candidate; Flow composites it through the selected binary mask. Decoded pixels outside that mask stay identical to the immediate parent. | Reuses the saved masks, IDs, names and comments. Review boundaries after changes to shape/content. |
| `recolor` | Make a jersey pink while keeping its shading and texture            | Local pixel processing changes the selected region's color; no image model or subscription inference.                                                   | Reuses the saved masks immediately.                                                                |
| `whole`   | Try a different composition or regenerate an unsatisfactory result  | The chosen image provider can change the entire image, using the current version as a reference.                                                        | Detect regions again because objects may have moved.                                               |

Region editing preserves framing outside the mask. Include enough of the surrounding
area in the selection if the replacement needs room to grow. A narrow jersey mask will
also clip any generated sleeve that extends beyond it. Review inherited boundaries
before the next edit; a retained mask is a reusable selection, not a newly verified
object outline.

Exact preservation means orientation-normalized sRGB RGBA pixel values outside the mask,
rather than identical file bytes after PNG encoding. Earlier reference-guided variations without
an explicit mode/compositing record retain their original advisory-mask behavior.

## Versions, regions and comments

Preparation freezes the source reference and hash, all region masks, layer names,
visibility, locks, order, comments, and selected region IDs for that request.
Later changes to the parent editor do not rewrite the prepared edit. Region
and recolor outputs open with that saved region structure, so continuing an edit does
not require another automatic SAM pass. Manual names and region IDs remain stable.

Region edits copy applied comments into the result as resolved. Local recoloring uses
its explicit color and strength. It keeps other comments unresolved because it has not
carried out their natural-language instructions. The selected region IDs are carried
into the new editor. Each version can have its own comments and layer names without
changing its parent.

Whole-image regeneration stays in the same version family but gets fresh segmentation.
Its saved request retains the submitted comments; the new editor starts without region
comments because the original region IDs may no longer describe the generated objects.
If a region edit was too constrained, choose whole-image regeneration from the desired
version and give the provider more freedom. It creates another version rather than
overwriting the source.

## Agent access

The UI, client, CLI and MCP tools use the same request preparation and durable queue.

1. Open/read an editor and find its region IDs and current revision.
2. Save any inline comments with the normal editor patch operation.
3. Prepare the desired mode. This saves a workflow and request without running a model.
4. Send the prepared request and poll its run or version family.
5. Open the completed output to continue editing that version.

```sh
# Read masks, region IDs, labels, comments and revision.
flow editor inspect EDITOR_ID --project PROJECT_ID --json

# Recolor one selection locally. --strength is between 0 and 1.
flow editor prepare EDITOR_ID --project PROJECT_ID \
  --mode recolor --regions REGION_ID --color '#ee3697' --strength 1 --json

# Ask the configured image harness to change just the selected region.
flow editor prepare EDITOR_ID --project PROJECT_ID \
  --mode region --regions REGION_ID --provider codex \
  --prompt 'Replace the jersey with a fine-knit cycling jersey.' --json

# Regenerate the whole image, with optional new direction.
flow editor prepare EDITOR_ID --project PROJECT_ID \
  --mode whole --provider codex \
  --prompt 'Keep the monochrome motion photography; try a lower camera angle.' --json

# Use the editor/request IDs returned by prepare.
flow editor send EDITOR_ID REQUEST_ID --project PROJECT_ID --json
flow wait RUN_ID --project PROJECT_ID --json
flow editor variations EDITOR_ID --project PROJECT_ID --json

# Use a completed job's output URL, then the returned editor ID.
flow editor open --image OUTPUT_URL --project PROJECT_ID --json
flow open --editor NEW_EDITOR_ID --project PROJECT_ID
```

`--from edit.json` supports the same fields for repeatable agent requests. For example:

```json
{
  "revision": 7,
  "mode": "recolor",
  "regionIds": ["region-00000000-0000-4000-8000-000000000001"],
  "color": "#ee3697",
  "strength": 1,
  "count": 1
}
```

Use the revision returned by reading the editor; a revision conflict requires rereading.
The CLI fills the current revision when it is omitted from the input file. Recoloring
creates one version per request. `region` and `whole` can generate multiple versions
with `count`. Region/recolor require a nonempty selection; `whole` may omit region IDs
and instructions to request another interpretation of the current image.

Client operations are `openImageEditor`, `imageEditor`, `patchImageEditor`,
`prepareImageEdit`, `sendImageEdit` and `imageVariations`. API routes:

- `POST /api/image-editors` opens the completed output URL with matching `runId`/`jobId`.
- `POST /api/image-editors/EDITOR_ID/requests` accepts the mode-specific request.
- `POST /api/image-editors/EDITOR_ID/requests/REQUEST_ID/send` dispatches it.
- `GET /api/image-editors/EDITOR_ID/variations` reads the family and live progress.

Append `?projectId=PROJECT_ID` to scoped editor routes. The MCP equivalents are
`open_image_editor`, `read_image_editor`, `patch_image_editor`, `prepare_image_edit`,
`send_image_edit` and `list_image_variations`.

Sending the same request ID is idempotent, including after a restart. To generate a
different result, prepare a **new request** instead of resending the old one. Source
hash validation rejects an edit if its original local file changes between preparation
and dispatch. All operations stay on the local platform; chosen AI harnesses receive
the references required for AI editing, while recoloring requires no external inference.

`test/image-versions.test.mjs` exercises the actual queue/registry with local fixtures:
outside-mask pixel preservation including transparency, version inheritance, frozen
comments and names, continuation from a child version, whole regeneration, gallery
ownership, idempotent dispatch, restart recovery and changed-source rejection.
