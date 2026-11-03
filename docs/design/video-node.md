# Video nodes and durable generation

Video generation uses Flow's existing planner, queue, SQLite run storage, project ownership checks, and gallery. The provider integration owns the Gemini wire protocol. The queue owns job status and persistence.

## Separate media from generation behavior

`shared/media.mjs` maps generation node types to job kinds. `generationKind("video-generate")` returns `video`; seed images and collection nodes return no generation kind. `outputType()` in `shared/graph.mjs` describes socket types instead.

`video-generate` accepts text and image inputs and emits video. `video-output` collects videos and has no output socket. Existing `generate` and `output` nodes retain image semantics. This keeps historical image workflows and their downstream image connections valid.

`mediaArtifact()` owns the canonical filename, extension, and MIME type for each job kind. Image outputs remain `output.png`. Video outputs are `output.mp4`. File routes and ZIP downloads use that mapping. Video jobs bypass Sharp normalization, region compositing, SAM, and image-style reference registration.

## Keep one queue

The planner expands records and prompt variations before inference. It creates text, image, or video jobs with immutable input provenance. The plan reports separate counts so the caller can review the number of paid video requests.

Video jobs enter the same queue as images. They use the same concurrency controls, cancellation, history, and project scope. Provider model and parameter validation runs before a durable run is created. Missing credentials do not produce a fake running job.

The video adapter requests an awaited checkpoint when its remote receipt or meaningful stage changes. The queue persists the checkpoint before the adapter continues. The adapter does not maintain a second run database or write run JSON directly.

## Preserve accepted requests

The adapter saves a submission marker before sending the create request. When the public Gemini Interactions API returns an interaction ID, the adapter saves it before polling. A retry with an accepted receipt resumes that interaction.

A crash between remote acceptance and receipt persistence leaves an uncertain outcome. Without documented provider idempotency, the adapter cannot promise exactly-once submission. It blocks automatic resubmission rather than risk a second paid request.

Local cancellation stops polling or downloading. It does not prove that Google cancelled the remote generation. The receipt remains available for resume. A new workflow run is a deliberate new generation attempt.

Only a validated, locally saved MP4 becomes a completed output. The adapter writes to a temporary file and installs the artifact before the queue marks completion. The inspector reads the recorded run snapshot, so later canvas edits do not change a clip's displayed inputs.

## Use supported authentication

Gemini video API configuration is distinct from the Gemini coding CLI text harness. API keys remain private. Google OAuth uses standard Cloud ADC and the configured quota project. Flow does not copy coding tokens or browser cookies.

Google AI Pro subscription access does not establish API entitlement. Developer Program Cloud credits and Flow credits have different billing rules. The integration reports actual authentication and API errors without claiming that fixture tests prove account access.

The native HTTP integration supports refreshable Google authentication and keeps asynchronous receipt recovery within one module. The official API CLI is useful for protocol inspection, but its current credential flow and URI-only artifact limitations make it a weaker runtime dependency for this node.
