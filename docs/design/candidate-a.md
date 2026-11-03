> Historical design record. For the current source layout and interfaces, use [ARCHITECTURE.md](../ARCHITECTURE.md) and [the agent guide](../agents.md).

# Candidate A: compile every operation into the durable job DAG

## Usage (caller's view)

A workflow can contain `Prompt → AI prompt (Pi) → AI prompt (Claude Code) → Generate image (compatible API)`. Each AI prompt stores only its instruction, provider ID and model ID. Existing `prompt` nodes keep their static meaning; add `prompt-generate` rather than silently turning saved prompts into inference. Image nodes keep their existing IDs and defaults.

The UI requests the public catalog once. The same picker receives the required operation and filters models; changing provider selects that provider's first compatible model. Settings adds a compatible connection with name, HTTP(S) base URL, write-only API key, and explicit text/image model capabilities. A saved connection displays its URL and `hasApiKey`, never its key. Separate text and image model entries can share one provider connection.

```js
// server/index.mjs: one path for either kind of job
const plan = planWorkflow(req.body.workflow, req.body.options);
await providers.preflight(plan.jobs); // resolves defaults; checks every selection
const run = await queue.create(plan.graph, req.body.options, plan);

// Queue receives the only provider dispatch function; delete its Codex fallback.
const queue = new Queue(store, {
  resolveAsset: assetPath,
  adapter: (context) => providers.run(context),
});

// Settings: only these writes can contain a key.
await api.post('/api/providers/connections', {
  name: 'My endpoint', baseUrl: 'https://example.test/v1',
  apiKey: { action: 'replace', value: userEnteredKey },
  models: [
    { id: 'writer', operations: ['text'], acceptsImages: false },
    { id: 'painter', operations: ['image'], acceptsImages: true },
  ],
}); // returns PublicProvider, with hasApiKey rather than apiKey
```

`GET /api/providers` is the common catalog for settings and selectors. `PUT /api/providers/connections/:id` atomically replaces connection settings and applies an explicit key action: `keep`, `replace(value)` or `clear`. `POST .../:id/models` optionally fetches model IDs without assuming their capabilities. The settings form retains or assigns capabilities before saving. Failed discovery never removes manually configured models. `POST .../:id/test` checks the currently saved configuration with bounded requests; capability checks are explicit, because a successful `/models` response does not establish text/image support.

## Grounding and problem

`shared/graph.mjs` validates socket types and acyclicity. `server/graph.mjs` statically propagates `{text, images}` contexts, expands variation Cartesian products, and emits only image jobs. Generated images become job references. `Queue.next()` already blocks on dependencies; `Queue.execute()` alone resolves references and dispatches adapters, but assumes all results are `output.png`. Store writes serialize each run and restore incomplete jobs as interrupted. The registry already owns readiness, model validation, dispatch and PNG normalization. UI selections live on image nodes. None of these responsibilities needs another scheduler.

Generated prompt text must survive process restart and retries as a first-class job result. The interesting change is replacing compile-time strings with ordered text expressions, while retaining the existing static graph expansion and queue lifecycle.

## Two whole shapes

| Shape | State and public boundary | Interface depth | Decision |
| --- | --- | --- | --- |
| A. Static typed-job DAG | Planner emits every text/image operation up front; queue executes persisted references. | `planWorkflow`, `preflight`, `run` hide expansion, capability decisions and transports. Callers do not manage execution phases. | Choose. Existing variation counts are known before inference and generated text has fixed cardinality. |
| B. Durable graph interpreter | Store a graph execution frontier and node-context tokens; completion materializes child jobs transactionally and advances the frontier. | A deep `advance(run)` can hide dynamic expansion, but resumability requires frontier revisions, stable token IDs and exactly-once child creation in addition to job state. | Reject for this request. The extra durable state has no benefit until model results control branching or output cardinality. |

B is structurally viable if a prompt model later emits a variable list that fans out into new graph branches. It should then replace the planner/queue contract as a whole. Calling prompt models before planning or using a separate prompt queue is rejected: either makes history, retries and interruption behave differently for text.

## Shape

The following are domain sketches for JavaScript/JSDoc and Zod validation, not a request to migrate the repository to TypeScript.

```js
// Shared operation discriminants; transport protocols stay server-private.
Operation = 'text' | 'image';
TextPart = { literal: string } | { jobId: string }; // text-result reference
ImageRef = { asset: string } | { jobId: string }; // image-result reference
Context = { text: TextPart[], images: ImageRef[] };

Job = JobState & ({
  kind: 'text', providerId: string, model?: string,
  input: { text: TextPart[], images: ImageRef[] },
  result?: { kind: 'text', text: string },
} | {
  kind: 'image', providerId: string, model?: string,
  input: { text: TextPart[], images: ImageRef[] },
  seed: number, ratio: string, quality: string,
  result?: { kind: 'image', output: string, metadata: ImageMetadata },
});
// JobState retains id/nodeId/label/status/attempts/timestamps/dependencies.
// dependencies is emitted from references by one shared function, never
// maintained independently by each planner branch.

ResolvedInput = { prompt: string, imagePaths: string[] };
ProviderResult =
  { kind: 'text', text: string, metadata?: SafeMetadata } |
  { kind: 'image', path: string, metadata?: SafeMetadata };

PublicModel = {
  id: string, operations: Operation[], acceptsImages: boolean,
  // image-only details, where supported
  ratios?: string[], seeded?: boolean, requiresImage?: boolean,
};
PublicProvider = {
  id: string, name: string, description: string, kind: string,
  models: PublicModel[], ready: boolean, status: string,
  baseUrl?: string, hasApiKey?: boolean,
};
```

Planner semantics:

- Static prompts and variations append literal text parts. Combining branches preserves persisted edge order and text-part order, joining nonempty parts with `\n\n` only when a job actually starts. A literal after a generated part must remain after it, including after restart.
- `prompt-generate` emits one text job per incoming context. Its instruction appends to the job input. Its outgoing context **replaces** the incoming text with that job's text reference and retains incoming image references. Otherwise chained rewriting would accidentally append previous prompts again. Blank successful text is rejected at the provider boundary.
- Image generation emits one image job per requested copy, as today. Its outgoing context remains empty text plus its generated image reference. Copy counts and seed arithmetic remain image-only. Global provider/model run overrides retain their existing meaning for image jobs; text nodes use their own selections.
- Text jobs may receive image context only when their chosen model accepts images. The selector and preflight explain unsupported image input rather than discarding it. All four CLI presets must support text-only prompt generation; a preset advertises image context only when its adapter implements attachments for the supported installed CLI version.
- Derive dependencies from both text parts and image references. Validate missing references and result-kind mismatches before creating a run. Count both job kinds against the 5,000-job run limit; preserve the combination limit. A text-only run is valid.

```js
// server/graph.mjs: pure, no provider credentials or subprocess calls
planWorkflow(workflow, options?) -> { graph, jobs: Job[], total, countsByKind };
jobDependencies(job) -> string[];
resolveJobInput(job, completedJobs, resolveAsset, runDirectory) -> ResolvedInput;
// Resolution verifies result kind; it never infers kind from a filename.

// server/providers.mjs: sole public provider boundary
class ProviderRegistry {
  async reload() -> PublicProvider[];
  async catalog() -> PublicProvider[];
  async saveConnection(idOrNull, ConnectionUpdate) -> PublicProvider;
  async discoverModels(id) -> { ids: string[] };
  async testConnection(id, operation) -> SafeConnectionStatus;
  async preflight(jobs: Job[]) -> void;
  async run({ job, input: ResolvedInput, directory, signal, onProgress })
    -> ProviderResult;
}
```

`preflight()` fills a missing model from the first compatible model; an explicitly saved incompatible model fails with its node label. `run()` rechecks the selection against the current definition and uses one captured immutable definition/key pair for the entire attempt. Queue never branches on transport. Registry rejects a result of the wrong kind, validates bounded nonempty text, and preserves existing raster verification/PNG normalization for image results.

`Queue.execute()` resolves both input types, records the materialized prompt used by the attempt, calls `adapter` once, commits the typed result, and uses the current retry/cancel/block rules for both kinds. Error messages say “upstream job,” not “upstream image.” Await the durable completion save before releasing dependent work: readiness requires a completed dependency that has left the active map, and active membership is released only after that save. A child must not start using a text value whose parent completion has not been persisted. Publish a normalized image atomically from its attempt directory to the existing job-level `output.png` before committing its image result; incomplete attempt files never become results. Queue remains the only writer of job state; Store remains the only run-file writer.

`Store.init()` normalizes legacy runs at its read boundary: missing `kind` means image, old `prompt` becomes a literal input, old `images` becomes image refs, and a completed old `output` becomes an image result. Resume uses the normalized jobs. Keep the existing image `output` presentation field if needed by old UI, deriving it from `result` in one public serializer rather than storing two independent results. Legacy string model lists normalize once to image-only model records. Legacy workflows retain `generate` and `prompt` unchanged.

## Module map and ownership

| Module | Owns |
| --- | --- |
| `shared/graph.mjs` | Workflow/node schemas, `prompt-generate` socket rules and node-to-operation mapping. No provider definition knowledge. |
| `server/graph.mjs` | Ordered context expansion and typed job-reference algebra, including dependencies and input materialization. No execution. |
| `server/queue.mjs` | One durable job state machine, attempt directories, lifecycle, persistence-before-release, retry and resume. |
| `server/store.mjs` | Run/workflow storage, legacy normalization and typed public run projection. No credential files. |
| `server/providers.mjs` | Registry definitions, catalog projection, compatible connection CRUD, capability validation, secret access, adapter choice and result normalization. Its private helpers need no second public service facade. |
| `server/providers/compatible.mjs` | Private OpenAI-compatible HTTP adaptation: chat completions, image generations/edits, model-ID discovery and response/error bounds. |
| `server/providers/harnesses.mjs` | One builtin preset table and harness-specific argv/result parsing for Pi, Codex text, Gemini CLI and Claude Code. Existing Codex image adapter stays available as image capability. |
| `server/providers/process.mjs` | One private bounded subprocess primitive used by harness presets and the existing command protocol. Cancellation/timeout/process-group termination and capped output live here once. |
| `server/index.mjs` | HTTP validation and wiring. Gallery, image file route and image ZIP filter image results; text results appear in run details and manifest. No key-bearing response path. |
| `src/ProviderPicker.jsx` and node UI | One capability-filtered picker and settings form, AI-prompt node editing and text-result display. Defaults derive from catalog models. |

Adapters remain unreachable through a second application execution path. The queue's injected adapter is the test seam and production registry dispatch; remove its default direct `runCodexImage` import. The registry's existing public `get()` should become private; callers receive catalog values or request a complete operation.

## Credentials, model lists and harness behavior

The registry is the only reader/writer of a private connection file under `.weft`, outside the served `uploads` and run output routes. Atomically write mode `0600` files within a mode `0700` directory; serialize updates in the registry so concurrent settings edits cannot lose key changes. Server storage is private from HTTP/export paths, not encrypted against the local account. Existing environment-key definitions remain supported; submitted keys are stored by the registry, never copied into workflows, jobs, request files or the catalog. User command definitions remain local configuration and cannot be written through the compatible-connection API.

Whitelist public catalog fields rather than deleting `apiKey` from a larger object. URL validation accepts HTTP(S) bases but rejects embedded credentials, query and fragment; URL joining is owned by the compatible adapter. Keep auth headers scoped to the configured API; downloading a returned image URL never forwards its bearer token. Registry sanitizes progress, errors, metadata and text before they reach queue events, logs or persisted public state, using the exact token captured for that attempt. The settings UI clears submitted key state after success, and key updates return only `hasApiKey`.

Connection edits apply to attempts that have not started. Running attempts keep their captured URL, models and key; rotating a key cannot pair a new key with an old endpoint mid-request. Retry intentionally uses current connection settings so a repaired key works. Model removal or provider capability edits cause a clear dispatch failure for queued selections rather than silently selecting another model. This accepts mutable connection settings as the existing registry does; the attempt records safe provider/model/URL metadata for diagnosis. Do not imply retries are exact inference replay.

The builtin preset table is the sole list of Pi/Codex/GeminiCLI/ClaudeCode text harnesses and their model/readiness metadata. Catalog and dispatch derive from that table; one provider can advertise separate text and image models. CLI model names are configured/curated, not guessed from branding. A model ID existing in `/models` likewise does not prove its operation or vision capability.

Each attempt gets `runs/<runId>/<jobId>/attempt-<n>/` as working directory. Spawn an executable and fixed argv with `shell: false`; send user text through stdin or a request file, never shell interpolation. Each harness adapter parses only its documented final response format, not mixed diagnostic stdout. Bound stdout/stderr, request sizes, output text, log bytes and execution time; abort terminates the process group and escalates. Use noninteractive, fresh-session modes, disable tools for text generation when supported, and never resume a global CLI conversation. Preserve only the environment needed for CLI executable/auth discovery; do not inject compatible API keys into child environments. Exact flags and attachment support must be verified against installed CLI versions before declaring a preset ready. A working directory alone is not an OS security sandbox.

## Rationale and synthesis decision

Choose A as the local base. Its ordered text-reference algebra is the only new dependency concept; the existing scheduler already understands dependency completion and failure. The registry remains a deep boundary: callers choose an operation/provider/model and receive a typed result while HTTP dialects, private keys, subprocess protocols, status caches and output normalization remain hidden. The extra registry settings methods each complete a user operation, rather than exposing load/validate/save stages to callers.

Ownership stays singular: planner owns expansion, queue owns execution state, store owns run files, registry owns connections and keys. Model capability data is defined once and drives catalog filtering, defaults and server rejection. No hand-synced text-provider list appears in UI. No second scheduler, hidden pre-run prompt call or generic plugin framework is introduced. These choices address the architect screening flags for shallow modules, temporal decomposition, split ownership, importable transport internals and two execution paths.

We accept fixed text cardinality in exchange for a complete inspectable plan, accurate initial totals and straightforward restart semantics. We accept per-dispatch connection settings in exchange for keeping credentials/configuration out of run snapshots and avoiding configuration-version retention. We accept explicit model capability configuration because most compatible APIs cannot reliably discover it.

## Verification and risks

Use existing Node test seams; no paid model calls are needed for core proof:

1. Planner fixture with literal → generated text → literal → generated text → image proves ordered replacement semantics, Cartesian branches, image propagation and dependencies. Existing image-only fixture produces equivalent selections/counts/seeds.
2. Fake text/image adapters execute a mixed run. Interrupt after completed text, reload Store, resume, and prove completed text is reused without rerunning its provider. A failed text job blocks its image descendants; retry/cancel operate identically for both types.
3. Local HTTP fixture covers chat completions, image generation/edit, discovery failure, malformed/oversized replies, key keep/replace/clear, and current-setting dispatch semantics. Inject a canary key into remote errors/progress/results and assert it is absent from catalog, events, manifests and logs.
4. Fake executable fixtures cover argv/stdin integrity, spaces/metacharacters in prompts, bounded output, timeout/cancel and wrong-kind or missing output. Verify all installed harness commands with minimal real text requests before advertising readiness.
5. Browser verification adds a connection, selects different providers for two AI prompts, runs into an image node, inspects persisted text, and reloads. An image-only workflow still renders gallery/downloads, while text results never appear as broken gallery images.

The main uncertainty is CLI version-dependent noninteractive behavior and attachment support. Capability advertisement must follow the implemented adapter rather than promise universal vision. OpenAI-compatible services vary in image-edit fields and supported sizes; retain explicit configured size maps and reject unsupported operations at preflight. If variable model-generated branching becomes required, revisit B instead of adding child-job creation inside adapters.

Next implementation step: add typed references/results and the mixed fake-adapter restart fixture, then adapt the registry and queue against that contract before adding live CLI/API/UI integrations.
