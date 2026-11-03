# fal, Seedance and Seedream

Settings → Providers → **fal** configures one private API key for image and video
nodes. Seedance and Seedream are ByteDance models hosted by fal. fal API billing
applies; subscriptions to other harnesses do not authorize fal requests.

The provider list uses fal’s mark. Model choices use ByteDance’s mark for Seedance
and Seedream, and the FLUX mark for FLUX. Assets are vendored locally with source
and license information in `public/harnesses/README.md`.

## Agent setup

Read setup without exposing the key:

```sh
node cli/flow.mjs providers fal --json
node cli/flow.mjs providers configure-fal --from /private/fal-connection.json
```

The private file contains `{ "apiKey": "YOUR_FAL_KEY" }`. Never save it in a
workflow or commit it. Omit `apiKey` to keep; use `null` to remove a saved key.
The server may also read `FAL_KEY`. Removing the saved key does not unset that
environment variable.

Client methods: `falConnection()` and `configureFal(connection)`. MCP:
`read_fal_connection` and `configure_fal`. All use `GET/PUT /api/providers/fal`.
The ordinary provider catalog includes the supported model IDs and constraints.

## Create and compare

```sh
node cli/flow.mjs workflow create --media video --provider fal-video \
  --model bytedance/seedance-2.5/text-to-video \
  --name "Seedance motion studies" --prompt "A road cyclist accelerates" \
  --count 3 --duration 8 --resolution 720p --project YOUR_PROJECT
```

Supply `--seed-image PATH` for a first frame; the default fal video recipe chooses
image-to-video and source-image framing automatically. Choose reference-to-video
for several style/subject references; use @Image1, @Image2 in the prompt.
First-frame endpoints use one image plus an optional second/end frame.

Image recipes with `--provider fal-image` default to Seedream text-to-image, or
Seedream edit if references exist. FLUX.1 schnell is text-only and accepts a seed.
The UI changes defaults when selecting models, so unsupported ratios, durations and
reference counts fail before submission instead of silently dropping inputs.

Use existing `node.data.modes` / `--modes FILE` to compare Codex, Grok and fal on the
same branch. Copies expand through the same local queue, with the configured
concurrency; fal’s account limits and remote queue still apply. Each output stores
the endpoint ID, requested and effective settings, provider request ID, reference
ancestry, original bytes and normalized preview. Image/video results appear in the
same project gallery and dataset export.

Preparing or planning does not submit inference. Run a saved workflow through the
normal `plan`, `run`, `wait`, `inspect`, `asset lineage` and dataset commands.

[Adapter details and current official sources](../harness-integrations/fal/README.md).
