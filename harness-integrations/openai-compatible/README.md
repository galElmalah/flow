# OpenAI-compatible APIs and BYOK

This is a direct HTTP integration; no Pi or other CLI dependency is needed.

- `client.mjs`: bounded JSON requests, abort/timeout handling, bearer authentication.
- `text.mjs`: `/chat/completions`, text or vision messages, final assistant content.
- `image.mjs`: `/images/generations`, multipart `/images/edits`, base64 or image URLs.
- `connections.mjs`: connection input schema and serialized, atomic private storage.

Create a connection in provider settings or through the provider-connection API with
its base URL (including `/v1` if required), model IDs, declared text/image capabilities
and optional API key. The key is write-only to callers and stored in owner-only
`.weft/connections.json`; it never belongs in workflow JSON, project manifests or run
metadata. Editing uses explicit `keep`, `replace` or `clear` key actions. Changing the
base URL requires a replacement or removal to prevent sending a retained key elsewhere.
The file-based image API configuration also supports keys from a named server environment
variable. An unauthenticated local endpoint can omit a key.

`GET /models` tests reachability and model listing, not inference capabilities. Capability
declarations must match the endpoint. The adapter does not translate native Anthropic or
Gemini protocols; use an actually compatible gateway or a dedicated adapter. Image size
maps and deterministic seed parameters are endpoint-specific. Upstream API billing is
separate from CLI subscriptions. Registry errors/progress redact the selected key.
