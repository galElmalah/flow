# Names for image regions

SAM 2.1 finds masks locally. A separate vision-capable text harness assigns readable
names to those exact masks: for example, “White cycling jersey”, “Rear bicycle wheel”
and “Blurred trees”. This uses the existing harness/provider setup, including Codex
sign-in and compatible endpoints. It does not generate another image.

The distinction matters: SAM 2's [automatic mask generator](https://github.com/facebookresearch/sam2/blob/main/sam2/automatic_mask_generator.py)
returns masks, boxes and quality measurements rather than semantic object names.
[SAM 3](https://github.com/facebookresearch/sam3) also supports supplied concept prompts;
it is not required for naming our existing SAM 2.1 masks.

The image editor names new masks automatically by default. Existing unnamed editors
start naming when opened. Under Layers → Region names, follow completed/total progress,
stop or retry naming, choose a vision-capable harness/model, or turn off automatic names
for new regions. SAM can remain local-only with automatic names disabled; naming sends
the original and mask crops to the selected harness/provider. Failed naming leaves SAM
masks available for selection and comments.

Each numbered contact-sheet card contains the exact masked pixels enlarged and the
same region highlighted within the whole image. The harness returns labels keyed to
stable region IDs. Names are descriptive suggestions, not verified classifications;
small or ambiguous fragments may have uncertain descriptions. Manual layer renames
always win, including changes made while the harness is still working. Locked layers
are skipped. Successful names are cached and not inferred again on refresh or retry.
Older non-generic layer names are preserved as well. Comments keep their region IDs
and immediately show the new names. Historical prepared edit requests retain the names
recorded in their snapshots.

## Agent access

- `POST /api/image-editors/ID/names?projectId=PROJECT` with `{providerId?:"codex-text",model?}`
- `POST /api/image-editors/ID/names/cancel?projectId=PROJECT` with `{}`
- Client: `nameImageRegions(id,input?)`, `cancelImageNaming(id)`
- CLI: `flow editor name ID --project PROJECT --provider codex-text --json`
- CLI: `flow editor cancel-naming ID --project PROJECT --json`
- MCP: `name_image_regions`, `cancel_image_naming`

Poll `imageEditor(id).naming` for queued/running/ready/failed/cancelled status,
provider/model, completed/total and errors. Masks and names are persisted independently;
server interruption leaves a retryable naming failure. Stopping or refreshing the browser
does not stop the server task. Sending the same naming request while active reuses the
operation. Already named/manual layers are never sent again.

`segmentImage(id,{names:false})` performs only local segmentation.
`segmentImage(id,{names:{providerId,model}})` chooses the naming harness for new masks.
Omitting `names` uses the editor's prior naming harness or Codex by default.

Fixture behavior tests cover real Sharp mask contact sheets, exact ID validation,
concurrent manual edits, ownership, cached names, cancellation, retry, automatic naming
and restart recovery. See `test/region-names.test.mjs`.
