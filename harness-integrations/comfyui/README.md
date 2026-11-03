# Local ComfyUI media

`ComfyMedia` runs image and video API-format workflows against a loopback ComfyUI
server. Runtime installation, process ownership, model downloads, and endpoint
configuration belong to `local-runtime/`. The adapter owns `comfy-profiles.json`.

Use `createCheckpointProfile({id,name,checkpoint,imageToImage})` from
`shared/local-models.mjs` for a core-node Stable Diffusion checkpoint workflow.
Other model architectures, including video, need a compatible **API-format**
workflow profile with explicit bindings:

```js
{
  id: "local-video",
  name: "My local video workflow",
  kind: "video",
  graph: { /* Export Workflow (API), not the frontend save format */ },
  bindings: {
    prompt: { nodeId: "6", input: "text" },
    seed: { nodeId: "3", input: "seed" },
    images: [{ nodeId: "10", input: "image" }]
  },
  output: { nodeId: "9", field: "videos", index: 0 },
  requiredModels: [{ folder: "diffusion_models", filename: "model.safetensors" }]
}
```

Bindings target existing scalar inputs. Image bindings consume exactly that many
ordered image references; references are never silently discarded. Generated text
replaces the bound prompt. Seed and dimensions apply only when bound. Text-to-image
dimension bindings scale the requested ratio to a longest side of 768, rounded to
64 pixels. Image-to-image recipes retain source geometry. Video duration and mode
live in the imported graph; provider overrides are rejected.

Before submission the adapter checks installed node definitions, scalar enum
choices and declared model files. A reachable server is separate from a validated
profile, and validation is separate from successful inference. Known cloud/API
partner nodes are rejected. Custom nodes can execute arbitrary code; their
locality is recorded as `local-runtime-graph-unverified`, never guaranteed offline.

The queue checkpoint freezes the endpoint, profile, rendered graph, source hashes,
graph SHA-256 and validation facts before submission. An accepted prompt ID resumes
through history without a second POST, even after changing the profile library.
Changing the endpoint or job inputs rejects resumption. An interrupted submission
with no accepted receipt stays uncertain and is not automatically duplicated.
The adapter never calls the server-wide `/interrupt` endpoint.

Live WebSocket events show actual node execution and available `value/max` sampler
steps. Queue polling reports the observed queue position. There is no invented
whole-workflow percentage. Final media is downloaded through the same loopback
server and decoded as an image or verified as an MP4. GIF output cannot masquerade
as a video asset. Normal queue/asset handling preserves source lineage and raw
originals. `effectiveSettings` includes the complete frozen profile/graph and model
facts for dataset exports. Declared model hashes are labeled unverified unless
verified by the runtime downloader; a filename is not a model fingerprint.

Official references:

- [Server routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [WebSocket messages](https://docs.comfy.org/development/comfyui-server/comms_messages)
- [API workflow format](https://docs.comfy.org/development/api-development/workflow-api-format)

Run `node --test test/comfyui.test.mjs` for protocol behavior, real image/MP4 bytes,
missing dependencies, profile mutation and restart/uncertain-submission handling.
These tests do not prove a large local image or video model fits the machine.
