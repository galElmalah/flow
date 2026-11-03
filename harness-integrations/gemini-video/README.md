# Gemini video

`GeminiVideo` calls the public Gemini Interactions API from the local queue. It uses
native HTTP, never drives Flow or a browser, and never reads the coding Gemini CLI's
cached OAuth credentials. The supported model is `gemini-omni-1.1-flash`.

## Connection

The connection is saved privately as `DATA_ROOT/gemini-video.json` using atomic
replacement and mode0600. `configure()` accepts:

```js
{ authMode: "api-key", apiKey: "..." }
{ authMode: "oauth-adc", quotaProject: "my-cloud-project" }
{ authMode: "oauth-token", quotaProject: "my-cloud-project" }
```

Use `apiKey: null` to remove the saved key, or `quotaProject: null` to clear the
quota project. Environment keys (`GEMINI_API_KEY`, then `GOOGLE_API_KEY`) remain
available after clearing a saved key. The optional `oauth-token` mode reads
`GEMINI_ACCESS_TOKEN` only from the server environment. Never put keys or tokens in
workflow nodes, prompts, command-line arguments, logs, or public status payloads.

ADC uses `google-auth-library`; its request headers refresh credentials before each
request. Set up the Google Cloud project, enable the Generative Language API, and
authorize the official public API scopes. The current Google OAuth quickstart uses
`cloud-platform` and `generative-language.retriever`. OAuth requires an explicit quota
project. A one-time interactive sign-in may be needed to set up desktop ADC; video
generation itself is headless. Status checks only credential configuration/file
presence and reports `authenticated: null`. It does not promise live authorization,
model access, or billing eligibility before a real request.

Google AI Pro's Flow credits and coding CLI quota do not authorize this API. Pro's
activated Developer Program benefit can supply eligible monthly Google Cloud
credits ($10/month), which can offset public API billing. These are a separate
balance. Current prepay accounts need a positive paid AI Studio balance to activate
promotional credits. We do not activate subscriptions, enable billing, purchase
credits, or claim the user's credits are available.

## Durable runs

```js
const video = new GeminiVideo({ dataRoot });
const result = await video.run({
  job,
  directory,
  imagePaths,
  signal,
  onProgress,
  checkpoint: async ({ providerOperation, message }) => persistToQueue(),
});
```

The queue must persist `providerOperation` before returning from `checkpoint()` and
pass it back on the next attempt. Before POST, a `submitting` receipt records a hash
of the exact payload. After acceptance, an `accepted` receipt adds the interaction
ID. Retrying an accepted receipt polls that same interaction. An ambiguous
pre-acceptance outcome blocks a second POST: inspect Google before explicitly
starting another run. An explicit HTTP4xx rejection other than408 clears the marker
so corrected credentials can be retried. HTTP5xx/network timeouts remain uncertain.
The API provides no idempotency key for reconstructing a lost accepted response.

Real queue/render/save phase messages are checkpointed for refreshes. Google does
not provide a percentage, so the adapter reports phases rather than invented
progress. Cancellation stops local waiting, retains the durable receipt and may
leave an accepted Google operation running.

`queued`, `in_progress`, and `requires_continuation` remain pending;
`requires_action` requires user attention; `failed`, `cancelled`, `incomplete`, and
`budget_exceeded` fail the job. Unknown statuses fail safely with the receipt intact.

Seeds are validated PNG/JPEG/WebP images with a total14MB inline cap. Video settings
are 16:9 or9:16 and resolution360p/720p/1080p/4k; no duration field is invented.
Outputs use inline base64 or a bounded trusted Google HTTPS file download. Redirects
are validated; API credentials are sent only to the Generative Language file API,
never to Google Storage. The adapter verifies MP4 container/video-track dimensions,
writes `output.mp4` atomically and returns a finite metadata projection.

Constructor `fetch`, `baseUrl`, `googleAuth`, polling, and environment overrides are
for local fixture tests; these are not workflow or public connection fields.

## Sources and validation

- [Public API OAuth](https://ai.google.dev/gemini-api/docs/oauth)
- [Google AI plan/API boundary](https://ai.google.dev/gemini-api/docs/google-ai-plans)
- [Pro Developer Program Cloud credits](https://blog.google/innovation-and-ai/technology/developers-tools/gdp-premium-ai-pro-ultra/)
- [Current video model](https://ai.google.dev/gemini-api/docs/video)
- [Omni Interactions REST output](https://ai.google.dev/gemini-api/docs/omni)

Run `node --test test/gemini-video.test.mjs`. Fixtures exercise native request
payloads, real MP4 bytes, restart/resume, ambiguous submission protection, rejected
auth retry, ADC refresh, secret-safe status/errors, download restrictions and
cancellation. They make no Google generation requests. Live Google generation needs
user-configured public API credentials and billing and is not verified by fixtures.
