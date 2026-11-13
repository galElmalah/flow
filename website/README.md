# Flow website

Two static Overto artifacts in workspace Gal, project `flow-landing`. Publishing
rules (connection, version fence, audience, hosted checks) are in
[AGENTS.md](../AGENTS.md#public-website-and-docs).

| Slug    | Public URL                                    | Bundle directory        | Source                                      |
| ------- | --------------------------------------------- | ----------------------- | ------------------------------------------- |
| `flow`  | https://gal.overto.work/flow-landing/flow/    | `website/landing/site/` | The files in that directory                 |
| `docs`  | https://gal.overto.work/flow-landing/docs/    | `website/build/docs/`   | Repository Markdown, via `npm run docs:build` |

Both use entry `index.html`, relative paths and no SPA fallback. Neither runs Flow;
the app is local.

## Documentation

```sh
npm ci
npm run docs:build
```

The command deletes and rebuilds the ignored `website/build/docs/`, then writes
`website/build/docs.manifest.json`: an inventory whose `files` entries are
`{path, mediaType, size, sha256}`. Upload exactly those files. The build fails if a declared page is missing or
Git-ignored, a local link or image is not in the bundle, an external link lacks a
separate-tab target, or an undeclared file appears.

Pages are listed in [`tools/lib/public-docs.mjs`](../tools/lib/public-docs.mjs):
`SETUP.md` → `SETUP.html`, `docs/mcp.md` → `guide/mcp.html`, nested READMEs keep
their folders. Inline images come from `docs/images/`. Links to other repository
files open GitHub in a new tab. The private release explainer
(`node tools/build-explainer.mjs`) is a separate bundle; never publish it here.

## Publishing request

`docs.manifest.json` is not an Overto publish request. Its wrapper fields
(`directory`, `project`, `slug`, `url`) only tell you where the inventory belongs;
they are not part of the Overto manifest. Read the current Overto MCP tool schema
before building the request, because the platform schema can change. As of this
writing the site manifest is:

```json
{
  "schemaVersion": 1,
  "kind": "site",
  "entry": "index.html",
  "metadata": { "title": "Flow documentation", "description": "…" },
  "spaFallback": false,
  "files": ["…every entry of docs.manifest.json files, unchanged…"]
}
```

Copy the complete `files` list exactly. Each entry is already `{path, mediaType,
size, sha256}`. Pass the observed current version as the fence
([AGENTS.md](../AGENTS.md#public-website-and-docs) covers conflicts).

First `docs` publication: `overto_publish` gives the new artifact the project's
audience, and a visibility field in the publish call does not make it public.
After the first publish, read the artifact metadata, then explicitly set `docs` to
public using the observed permission revision and current version. The owner has
authorized a public audience for `docs`. Later updates keep the public audience; do not change it.

## Landing page

`website/landing/site/` is the complete landing bundle: 34 files, including fonts,
images, provider marks and the downloadable SALT / SPEED example. Edit it in place.
The header Docs link and other cross-artifact links open in a new tab.

```sh
npm run landing:examples   # regenerate examples/ and shared/examples.js from client/
npm run landing:verify     # schema, CLI flags, SDK imports, upload/save/plan; no inference
python3 -m http.server 8798 --bind 127.0.0.1 --directory website/landing/site
```

Run `landing:examples` only after changing the example code in
`build-examples.mjs` or the client it uses, then commit the regenerated files. A
local preview does not prove the hosted page works; check the actual URL after
publishing.
