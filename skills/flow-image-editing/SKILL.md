---
name: flow-image-editing
description: Select and name image regions, attach inline comments, recolor or AI-edit masked regions, and inspect image versions in the local Flow editor. Use for changes to existing Flow images, not general image-generation requests.
---

# Flow image editing

Run `node <this-skill-folder>/scripts/flow.mjs ...` by absolute path, keeping the consuming project's working directory. `--help` describes current editor commands; `guide --json` discovers the HTTP/client contracts. All durable writes go through the platform.

- `editor status --json` reports SAM setup and actual download/verification stages. `editor setup --json` installs the local segmentation runtime when needed. SAM provides masks; the vision naming harness is separate. Do not claim setup or naming succeeded from executable detection alone.
- `editor list --project ID --json` discovers documents. `editor open --project ID --image IMAGE_URL --json` opens one; use uploaded Flow assets or completed image inputs from the platform. `editor inspect EDITOR_ID --json` reads the current revision, named masks and comments. `open --editor EDITOR_ID --project ID --json` opens its viewer.
- `editor segment EDITOR_ID --json` detects regions; inspect the current command/schema for point prompts. `editor name EDITOR_ID --provider codex-text --json` names unnamed masks without overwriting manually named regions. Naming may invoke the selected vision provider.
- Use `editor patch EDITOR_ID --from /absolute/change.json --json` for layers/comments. Read the current document and revision first; discover the patch contract rather than guessing its fields. Comments attach to stable region IDs and normalized image positions. Respect locked masks.

## Make a version

Prepare with `editor prepare EDITOR_ID --from /absolute/edit.json --json`, or the current CLI's `--mode`, `--regions`, `--color`, `--strength` and `--prompt` flags.

Choose the mode based on the request:

- `recolor`: local masked color change retaining texture/shading; decoded pixels outside the mask stay identical.
- `region`: advanced explicit operation only. AI replacement is composited through the frozen mask and may show seams at imperfect boundaries. Prefer `whole` for AI edits.
- `whole`: regenerate the entire image if the user wants broader changes. Do not promise unchanged surroundings or inherited aligned masks.

Preparing does not generate. Once the requested edit is ready, `editor send EDITOR_ID REQUEST_ID --json` dispatches its immutable snapshot. Repeated sends of that same request reuse its run. Preserve the request and run IDs across retries.

`editor variations EDITOR_ID --json` and `inspect RUN_ID --json` expose durable progress/results in the same project and image family. Region edits/recolors inherit region names, masks and comments; whole-image generations require fresh segmentation. Original images remain available in version history. Inspect outputs before saying the visual edit succeeded.
