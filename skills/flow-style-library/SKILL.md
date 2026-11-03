---
name: flow-style-library
description: Find visual styles and reference images, start a Flow workflow from a style, or add custom references with baseline style and scene prompts to the local Flow gallery.
---

# Flow style library

Use `node <this-skill-folder>/scripts/flow.mjs ...` by absolute path. Keep the current directory in the consuming project for manifest discovery; explicit `--project ID` selects another project.

- `styles --search "motion blurred sports" --json` searches the library. Inspect a style by ID with `styles STYLE_ID --json`; use `--help` for categories/favorites and the current style contract.
- `style start STYLE_ID --subject "A cyclist accelerating" --project ID --name NAME --json` creates an owned workflow with separate style and subject/scene prompts plus references. It does not generate. Plan it and use the flow-workflows skill when a run is requested.
- Custom styles need a concrete reusable `prompt`, a baseline `scene`, tags/categories and optional references. Read `schema --json` / `guide --json` and the installation's `docs/styles.md` for exact fields. Keep visual rendering instructions distinct from the scene being depicted.
- `style create --from /absolute/style.json --seed-image /absolute/reference.png --json` uploads a local reference and saves the style. `style update STYLE_ID --from /absolute/changes.json --json` updates it. Uploaded assets or completed outputs can be references; preserve their run/job provenance and record source/attribution where known.
- Changing the library does not change snapshots already applied to workflows or historical runs. Never edit the built-in source catalog or live SQLite to save user entries. Do not invent a reference's provenance or imply that a web image is owned/generated locally.

To discover the complete style API or use MCP, consult `guide --json`; it exposes the same create/update/start operations available in the UI. Skills guide use of these operations and do not grant permission to publish, spend credits, or import unrelated personal files.
