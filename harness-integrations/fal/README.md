# fal media API

Native asynchronous fal adapter. Provider IDs: `fal-image`, `fal-video`. Authentication
uses a private fal API key, entered in Settings → Providers → fal or supplied as
`FAL_KEY` to the server. The UI never receives the key. Configured means a key exists;
model entitlement and billing remain unverified until generation succeeds.

Models and input limits live in `shared/fal.mjs`. The adapter owns payload mapping,
authenticated queue requests, durable submission receipts, polling, reference data
URIs and bounded artifact downloads. It runs through the normal queue, asset registry,
comparison modes and project lineage. No browser automation or separate execution path.

## Included endpoints

- Seedance 2.5 and 2.0: text-to-video, image-to-video, reference-to-video.
- Seedream 5.0 Flash: text-to-image and edit (up to ten references).
- FLUX.1 schnell: text-to-image with an actual seed parameter.

First-frame video accepts one opening image plus an optional second/end frame. Its
aspect ratio comes from the image (`auto`). Reference mode accepts up to 30 images on
2.5 and nine on 2.0. Video/audio reference files, draft completion and video extension
are not exposed by this adapter. Inline images share a 20 MB local request limit;
PNG/JPEG/WebP are accepted. The catalog intentionally exposes only mapped endpoints.

Seedance 2.5 permits 4–30 seconds; 2.0 permits 4–15. H.264 output and generated audio
are requested. Seedance/Seedream do not expose a seed input in these schemas; the
requested local variation label and any provider-reported seed remain distinct.

## Durable execution

Write `submitting` before POST, then `accepted` with the request ID before polling.
An uncertain POST is never automatically repeated. Accepted requests resume using
the same ID. Queue URLs use owner/app, excluding endpoint suffixes; returned URLs
are checked against that origin/path before authentication is sent. Artifact downloads
receive no credentials and allow only fal media hosts and the falserverless Google
Storage bucket. Artifacts are copied locally before signed/CDN URLs expire.

Queue position and actual stage are shown; a percentage is not invented. Stop/pause
stops local waiting and retains the remote request. It does not guarantee remote
cancellation or avoid provider charges. Resume collects the original result.

## Validation

`node tools/verify-fal-catalog.mjs` checks public OpenAPI schemas without a key or
inference. `node --test test/fal.test.mjs test/mcp.test.mjs` exercises wire protocol,
resume, error handling, auth privacy, API/CLI/MCP setup and real local queue/lineage
with fixture images/video. Fixtures do not prove access to a paid fal account.

Sources (verified 2026-11-01):

- [fal queue API](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [Seedance 2.5 text](https://fal.ai/models/bytedance/seedance-2.5/text-to-video/api)
- [Seedance 2.5 first/end frame](https://fal.ai/models/bytedance/seedance-2.5/image-to-video/api)
- [Seedance 2.5 references](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api)
- [Seedance 2.0](https://fal.ai/models/bytedance/seedance-2.0/text-to-video/api)
- [Seedream 5.0 Flash](https://fal.ai/models/bytedance/seedream/v5/flash/text-to-image/api)
- [Seedream edit](https://fal.ai/models/bytedance/seedream/v5/flash/edit/api)
- [FLUX.1 schnell](https://fal.ai/models/fal-ai/flux/schnell/api)
