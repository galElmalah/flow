# Image version architecture

An image edit needs a stable source, editable regions, and enough history to explain
what changed. Flow uses one persistent editor per immutable image output, with a shared
version family. It retains the existing workflow, provider, queue, gallery, and project
services instead of adding a second generation system.

## One editor per output

`ImageEditors.open()` identifies an editor by source URL, content hash, and project.
An edited output therefore gets its own editor document and can have independent layer
names and comments. `familyId` identifies the root editor, while `parentEditorId`
identifies the version used as the immediate source. `original` resolves the root image
for comparison. Opening the same output again preserves its existing editor state.

The viewer selects which version to edit by opening its editor URL. There is no global
active-version pointer shared between browser tabs or agents. Two callers can work on
different versions without changing each other's selection. Optimistic editor revisions
still reject conflicting changes to the same document.

This extends the existing source-based identity and avoids migrating every gallery
output into a new asset database. Parallel generated outputs are already separate jobs
with separate files, so each naturally becomes an independent version.

## Prepare once, execute through the queue

`ImageEditors.request()` validates the source hash and editor revision before preparing
an immutable workflow and request. Region and recolor modes copy **all** masks into
request-specific files and snapshot every region's metadata, all comments, and selected
IDs. Snapshotting only selected regions would discard useful selections for the next
edit. Reading the mutable parent at completion would inherit changes made after dispatch.

The request also contains the selected union mask, annotation overlay, source provenance,
and exact prompt. Canonical `job.edit` metadata survives graph validation, planning,
queue persistence, and the gallery projection. Agents use the same shared request schema
through the client, CLI, HTTP routes, and MCP tools.

`send()` finds an existing matching run before creating one. Its `runFor()` helper also
serves version history, so a crash between run persistence and saving the editor's
`runId` receipt does not make an active or completed run disappear. Matching uses project,
workflow, editor, request, and the saved graph rather than a name or prompt guess.

## Preservation belongs after image generation

`ProviderRegistry.run()` finalizes every image provider's output before the queue marks
the job complete. It is the common point for enforcing region preservation across Codex,
command harnesses, and compatible image APIs. `image-tools/region-edit.mjs` owns raster
processing and validates ordered original, overlay, and mask inputs.

Region mode asks the selected provider for a full candidate. The compositor then copies
candidate pixels inside the binary mask onto the normalized original. Pixels outside
the mask retain their original sRGB RGBA values. Small resolution differences resize
the candidate to the source coordinate frame. Large aspect-ratio changes fail with a
retry or whole-regeneration suggestion rather than silently applying a misaligned patch.
The raw candidate remains in the run's attempt backup.

This separates provider guidance from platform guarantees. `strictInpainting:false`
describes the provider's advisory-mask behavior. `preserveOutsideMask:true` describes
Flow's compositor. Historical jobs without an explicit mode retain their existing
behavior instead of gaining a false preservation guarantee.

Recolor mode uses reserved provider `local-recolor`, model `recolor`, through the same
queue. It adjusts selected pixels locally while preserving luminance, texture, and
alpha, then follows the normal image finalization path. It requires one output and
does not invoke a subscription model. Whole mode uses the current image as its sole
image reference and bypasses region compositing, allowing the provider to change the
complete composition.

## Inherit useful selections without claiming new geometry

Opening a region or recolor output copies its prepared region snapshot into the child's
own asset directory. IDs, labels, order, lock state, visibility, and comment anchors stay
stable. Applied AI region comments become resolved on the child and retain their saved
request provenance. Recolor uses explicit color parameters, so it leaves other comments
unresolved. Selected IDs become `inheritedSelection` for the viewer.

Recolor preserves geometry. AI region editing may change an object's boundary, so its
inherited segmentation sets `needsReview:true`. The saved mask remains a usable selection,
and the user can refine or detect regions again. Whole regeneration starts with no
inherited masks and needs fresh SAM detection because objects can move or disappear.

`variations()` projects requests and runs across all editors with the same family and
owner. Standard gallery eligibility still requires a completed image job and recorded
output. Failed attempts stay visible as failures, and project checks apply before
reading parent snapshots or traversing the family.

## Verification

`test/image-versions.test.mjs` uses the real store, project service, editor service,
provider registry, and queue with local raster fixtures. It verifies pixel preservation,
frozen inheritance despite parent mutations, child edits, whole regeneration, family
history, missing-receipt recovery, restart durability, source hash rejection, and CLI
request fields. `test/region-pixels.test.mjs` covers the raster operations separately.

Run `node --test test/image-versions.test.mjs test/region-pixels.test.mjs test/mcp.test.mjs`.
These fixtures verify platform behavior without using an image subscription. Visual
quality and inherited object boundaries still require inspecting actual generated images.
