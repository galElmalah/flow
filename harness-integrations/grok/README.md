# Grok Imagine

The native xAI adapter exposes `grok-image` and `grok-video` through the existing
Flow planner, queue and gallery. Both share one private connection. Add a key in
Settings → Providers, set `XAI_API_KEY` in the server environment, or use
`PUT /api/providers/grok` with `{ "apiKey": "..." }`. An omitted key keeps the
saved key; `null` removes it. An environment key remains available after removing
a saved key. Status returns presence/readiness only, never the key or a claim
that inference/billing has been verified. Credentials are stored in the private
data directory's `grok.json` with mode 0600.

The [official account FAQ](https://docs.x.ai/developers/faq/accounts) distinguishes
Grok and API billing. Consumer subscription login does not configure this REST
connection. Never copy browser session cookies or scrape consumer endpoints.

`shared/grok.mjs` owns the model capability metadata used by catalog controls and
native preflight. Image generation defaults to `grok-imagine-image-2.0`, medium
quality and 1k. Video defaults to `grok-imagine-video-1.5`, 720p and eight seconds.
Quality `high` is rejected. No unsupported setting is silently downgraded.
The old image-quality slug retires November 2, 2026; it is deliberately absent
from the catalog. See the [migration guide](https://docs.x.ai/developers/migration/imagine-image-quality-nov-2).

Image edits use JSON, with one `image` or multiple ordered `images`, rather than
OpenAI's multipart transport. Video mode can be explicit or inferred from input
count: no inputs means text, one means pinned image, several means reference.
Pinned-image video follows source framing and does not send a misleading aspect
ratio. Reference video is limited to 720p; lite offers text/image modes only.
Generated videos include audio by provider default.

Both media kinds submit deferred requests and checkpoint before the paid POST,
then save the accepted request ID. Resume polls that ID. An uncertain submission
without an accepted ID blocks automatic replay. Cancellation is local; it does
not claim to cancel generation at xAI. The image/video API has no documented
deterministic seed control: Flow retains its comparison seed as an unsupported
variation label and never sends a guessed `seed` parameter.

The adapter returns whitelisted provider request ID, requested/actual model,
effective settings, optional usage/cost values and revised prompt. It downloads
temporary generated media promptly without forwarding the API key to the CDN.
Only documented HTTPS xAI media hosts are allowed, including every redirect;
response size and actual PNG/JPEG/WebP or MP4 structure are checked. Registry
normalization and any selected-region compositing still happen after the native
adapter returns, so lineage captures the final delivered artifact.

Official protocol references:

- [Image REST](https://docs.x.ai/developers/rest-api-reference/inference/images)
- [Video REST](https://docs.x.ai/developers/rest-api-reference/inference/videos)
- [Image-to-video](https://docs.x.ai/developers/model-capabilities/video/image-to-video)
- [Reference-to-video](https://docs.x.ai/developers/model-capabilities/video/reference-to-video)
- [Temporary media hosts](https://docs.x.ai/developers/model-capabilities/imagine/files)

Run `node --test test/grok.test.mjs` for native transport, operation recovery,
capability, private setup, download and normalization checks. These fixtures
prove the local protocol path; a successful real authenticated generation is
required to verify a particular account's API access.
