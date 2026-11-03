> Historical design record. For the current source layout and interfaces, use [ARCHITECTURE.md](../ARCHITECTURE.md) and [the agent guide](../agents.md).

# Candidate B: compile the whole run into typed jobs

## Caller usage first

A user connects `Prompt → AI prompt (Pi) → AI prompt (Claude Code) → Generate image (compatible connection)`. Each AI prompt replaces the incoming text with its generated text; it carries any image references onward. A generated image replaces its context with its image, matching today's planner. Literal Prompt and Variations nodes still append text and expand combinations. One text result is one string, even when it contains newlines: generated text never secretly changes graph cardinality.

The user creates a compatible connection in Settings by entering its name, HTTP(S) base URL, API key, and text/image model entries. The saved form shows URL, models and “API key saved”; the key field returns empty. A blank key edit preserves the existing key; explicit “Remove API key” clears it. The node picker shows models that support that node's output and connected image inputs. Run history shows AI prompt text alongside image results; gallery and image downloads continue to show only images.

```js
// HTTP handlers do not coordinate planning, default selection and scheduling.
const run = await queue.create(req.body.workflow, req.body.options);
res.status(201).json(run);

// Preview is pure and makes no provider calls.
const { total, jobs } = planWorkflow(workflow, options);

// Registry owns validation, storage, credential redaction and cache invalidation.
const catalog = await providers.saveCompatible({
  id, name, baseUrl,
  apiKey: { action: "replace", value: submittedKey },
  models: [
    { id: "prompt-model", outputs: ["text"], acceptsImages: false },
    { id: "image-model", outputs: ["image"], acceptsImages: true },
  ],
});

<ProviderPicker providers={catalog} output="text" hasImages={hasImages}
  current={node.data.providerId} onChoose={chooseProviderAndModel} />
```

`Queue.create` compiles, asks the registry to bind and validate all jobs, persists the complete run, then schedules it. Remove its optional caller-supplied `plan` parameter: it currently permits callers to bypass the steps that establish a runnable run. Run options such as image seed/count/provider overrides apply only to image jobs, preserving the existing image controls; they must not accidentally replace AI prompt providers.

## Two whole designs

**A. Fully materialized typed jobs (recommended).** The planner emits text and image jobs before execution. A context contains ordered literal/text-result references and image references. Every generated value has a durable producer job. All fan-out remains known during compilation, so the existing 5,000-job bound and preview counts are exact. The queue resolves references after dependencies complete and invokes one executor.

**B. Durable graph interpreter.** Persist node instances, input tokens and expansion cursors; run a node when its inputs arrive, creating downstream jobs as outputs become available. Literal/variation nodes become interpreter transitions rather than compile-time expansion. This can support a future “generate N structured prompts” node with dynamic fan-out. It also requires a second durable representation of graph execution, stable token lineage, transactional output-to-child creation, deduplication after crashes, and a new meaning for preview counts. A correct version still uses one worker queue, but the interpreter is now another scheduler of work.

Choose A. The requested outputs have static cardinality; dynamic interpretation buys no required behavior and spreads dependency correctness across planner, interpreter and queue. If a future feature truly requires model-controlled fan-out, redesign that contract explicitly rather than treating newline splitting as an implicit interpreter.

## Grounding and ownership

Today `server/graph.mjs` propagates `{text, images}`; only image jobs survive compilation. Dependencies are extracted only from image references. `Queue.execute` resolves those files and always publishes `output.png`. `ProviderRegistry` validates configured image models, chooses an adapter and normalizes its file to PNG. `Store` serializes run snapshots, while queue transitions are currently saved without waiting. The shared graph schema knows only literal prompt text, and `ProviderPicker` assumes every provider is an image provider.

The extension retains these owners:

| Module | Knowledge it owns |
| --- | --- |
| `shared/graph.mjs` | Node and socket schema. Add `prompt-generate` with text output and text/image inputs; preserve literal `prompt` and existing node names. No registry or credential knowledge. |
| `server/graph.mjs` | Static Cartesian expansion, stable text-part ordering, job/reference construction and expansion limits. Generated text does not need to be known here. |
| `server/queue.mjs` | Run/job transitions, dependency readiness, result resolution, cancellation, retries and recovery. The only job-status writer. |
| `server/store.mjs` | Snapshot persistence and structural legacy-data migration, not execution policy. Read old image jobs into the canonical job shape. Move interrupted-job recovery decisions into queue startup. |
| `server/providers.mjs` | Provider definitions, private connection storage, public catalog projection, model/capability validation, defaults, readiness and one execution boundary. Raw definitions stay private; remove public `get()` access. |
| `server/providers/harness.mjs` | Built-in Pi, Codex text, Gemini CLI and Claude Code invocation/parser presets and bounded subprocess execution. Extend/reuse command process control rather than duplicating it four times. |
| `server/providers/compatible.mjs` | Compatible text and image wire protocols, HTTP bounds, errors and credential handling. Reuse existing image transport behavior behind this adapter. |
| `server/index.mjs` | Local HTTP routes and public projection. No adapter selection or direct key-file access. |
| `src/ProviderPicker.jsx` and canvas/result views | Capability-filtered choices, connection form, text previews and image-only gallery/export views. The catalog supplies all model choices. |

## Domain and interface sketch

These are JavaScript/JSDoc shapes, not a TypeScript migration.

```js
// Ordered parts preserve A + generated B + C across a restart.
TextPart = { literal: string } | { textJobId: JobId };
ImageRef = { asset: LocalAssetUrl } | { imageJobId: JobId };
Input = { text: TextPart[], images: ImageRef[] };

Job = {
  id, nodeId, label,
  kind: "text" | "image",
  providerId, model,                 // Explicit after registry binding.
  input: Input,
  dependencies: JobId[],             // Derived once from all typed references.
  parameters: TextParameters | ImageParameters,
  status, attempts, startedAt?, finishedAt?, error?,
  resolvedPrompt?: string,           // Audit of the successful/current attempt.
  result?: TextResult | ImageResult,
};
TextParameters = {};                 // Node instructions are final literal parts.
ImageParameters = { seed, ratio, quality };
TextResult = { kind: "text", text, metadata };
ImageResult = { kind: "image", url, metadata };

Model = {
  id, label?, outputs: ("text" | "image")[], acceptsImages: boolean,
};
PublicProvider = {
  id, name, kind, description, models: Model[], ready, status,
  // Per-model image settings, when applicable; do not apply image rules to text.
  imageSettings?, baseUrl?, hasApiKey?,
};

planWorkflow(graph, options = {}) -> { graph, jobs, total };

new Queue(store, { providers, concurrency, resolveAsset });
Queue.create(graph, options = {}) -> Promise<Run>;
Queue.action(runId, action) -> Promise<Run>;
Queue.restore() -> Promise<void>;
// Existing scheduling/execute internals stay private to the queue.

ProviderRegistry.catalog() -> Promise<PublicProvider[]>;
ProviderRegistry.reload() -> Promise<PublicProvider[]>;
ProviderRegistry.saveCompatible(ConnectionEdit) -> Promise<PublicProvider[]>;
ProviderRegistry.removeCompatible(providerId) -> Promise<PublicProvider[]>;
ProviderRegistry.prepare(jobs) -> Promise<BoundJob[]>;
ProviderRegistry.run({ job, prompt, imagePaths, directory, signal, onProgress })
  -> Promise<{ kind: "text", text, metadata } |
             { kind: "image", path, metadata }>;
```

The planner appends literal instructions to `input.text`; the queue joins resolved nonempty parts with the current `\n\n` separator. It derives dependencies from both text and image references in one helper local to job construction. It never substitutes by string markers or scans prompts for job IDs. Validation rejects a reference whose producer has the wrong result kind, a missing producer, or a dependency cycle before scheduling.

For a text job, the planner emits a context with `text: [{textJobId: id}]` and the incoming images. For an image job it emits `text: []` and `images: [{imageJobId: id}]`, preserving existing semantics. Copies/variations get their own jobs; downstream consumers can share one upstream text result. A run with text jobs and no image jobs is valid.

`prepare` returns new jobs with explicit provider/model choices; it does not mutate a half-bound caller plan. It filters by job kind and image inputs, validates model-specific image settings, and checks readiness. A single ordered catalog defines the default for each output capability. Existing missing image provider IDs retain the `codex` default. Existing custom `command` and `image-api` definitions become image-only catalog entries; their current configured models remain usable. The Codex entry can offer its existing `native` image model and separately configured text models. A CLI-default text choice is represented explicitly and lets the CLI use its installed default; no guessed model catalog is required.

## One durable execution path

Readiness, retry/backoff, blocking, cancellation and concurrency do not branch on output kind. Only input resolution and result commit inspect kinds. Replace image-specific upstream errors with generation-specific messages. The queue calls `providers.run` once for either kind and owns committing its canonical `job.result`.

Registry image execution continues to verify and normalize PNG output. Text execution validates a bounded, nonempty UTF-8 result and returns only the final answer, not CLI event JSON, progress text or stderr. The queue persists the bounded text in `run.json`; this is the authoritative text result. Adapter scratch files are never a second source of text truth. Text dependency resolution reads that persisted job result.

Await the run save that marks a job running before launching its adapter; await result/status persistence before releasing dependents. On a save failure, pause the affected run and publish a persistence error rather than letting downstream jobs execute against a result that cannot survive restart. Retain the existing single per-run snapshot serialization. On restart, queue recovery marks unfinished jobs interrupted; completed text/image results survive and resume does not repeat them. This is restart-safe scheduling, not a claim of exactly-once remote inference: a crash between provider completion and durable commit can require an upstream attempt again.

Migrate old persisted image jobs on load: missing `kind` becomes image, `prompt` becomes one literal text part, `images[].jobId` becomes `imageJobId`, and completed `output` becomes an image result. New writes use only the canonical shape. Update all job consumers in the same change; do not keep a second `output`/`prompt` execution path. Summaries count both job kinds; gallery, PNG serving and ZIP selection test `result.kind === "image"`. Manifests contain text results and no provider secrets.

## Connection and adapter details

The registry owns a single private provider configuration file under the data directory. Use atomic replacement with a `0600` file and private directory permissions; the file is outside served upload/run paths. Existing environment-key references stay supported for file-configured connections. UI-created compatible entries store their key only here. API schemas accept only compatible connection edits, not arbitrary command execution definitions. `catalog()` is an explicit allowlist projection; neither catalog nor workflow/run data ever copies raw provider definitions.

Connection routes are `PUT /api/providers/compatible/:id` and `DELETE /api/providers/compatible/:id`. `PUT` accepts model capability declarations and key actions `keep | replace | clear`; responses return only the public catalog. Reject credentials embedded in base URL userinfo or query strings. The current local Host/Origin protections apply. Do not log submitted bodies, request headers, private definitions or unfiltered upstream error bodies. Registry errors and progress are scrubbed before they reach queue history, SSE and server logs. Neither HTTP adapters nor harness environments receive another connection's API key.

A connection edit becomes visible atomically. Each new attempt captures one complete private definition; active attempts retain their captured definition. Queued jobs and retries use updated settings, and the form states this behavior. Keep explicit job model IDs: removing a selected model or changing capability makes the job fail with an actionable configuration error rather than silently selecting a replacement. Resolve and validate again at execution so preflight is not a stale authorization to use changed configuration. Key rotation invalidates readiness caches immediately.

`/models` is optional discovery, not an authority on capabilities: compatible endpoints often omit them. The user can enter model IDs and assign text/image support; discovery only supplies candidate IDs for that same form. There is one stored model list and the catalog derives from it. Server preparation and picker filtering consume the same records. No parallel arrays of “text models” in the UI and registry.

Harness presets use fixed executable/argv builders and verified noninteractive final-output parsers. Pass prompts through stdin or a request file, never a shell or interpolated command string. Every attempt runs in its own job/attempt directory with bounded stdout/stderr and final-answer sizes, wall-clock timeout, abort support and process-group termination. Treat the directory as working-directory isolation, not an OS sandbox. Disable tools and repository discovery where the harness supports it; do not run in the app repository. Existing CLI authentication remains with each CLI. Do not copy compatible-provider secrets into subprocess environment or request files. Declare image-input support only for presets whose invocation and parser actually support it; unsupported models are filtered/rejected rather than silently ignoring image context.

The compatible adapter supports text completion and image generation/edit requests behind the same registry call. It owns endpoint joining, response parsing, image download bounds, request timeout and cancellation. A provider claiming image edits must actually support the configured image-input protocol. A model list or credentials check alone must not be labeled a verified inference connection.

## Verification and screening

The most useful behavioral checks are a text→text→image run with different fake adapters, a mixed literal/generated text order assertion, and a restart after a text result is committed but before image completion. Fail the upstream text job, verify image blocking, retry and confirm the successful text parent is reused. Verify variation/copy expansion and old image-only fixtures keep their counts and prompts.

Exercise all four harness presets against fake executables that emit their expected protocol; include bounded output, timeout, abort, malformed final output and prompt text containing shell metacharacters. A local HTTP fixture verifies compatible text, image generation/edit, non-JSON errors, response limits and cancellation. Rotate a stored key, reload the registry and confirm it persists while a distinctive secret is absent from catalogs, saved workflows/runs, SSE, manifests, ZIPs and surfaced errors. Check UI filtering and an actual connection-form round trip in the local browser. Real CLI smoke checks can be reported as unavailable when an executable/account is missing; fixture success is not proof of those installations.

This shape passes the design red-flag screen: queue creation hides the full run-establishment policy; the registry hides wire formats and credential storage behind one execution surface; queue alone changes job state; generated text uses the existing scheduler; catalog/model choices derive from one definition. New provider internals are not part of the public registry surface. The main risks are CLI protocol drift, incomplete compatible endpoint support and growing run JSON due to text; fixed parser fixtures, explicit capability declarations and bounded text results address those without inventing a second workflow engine.

## Synthesis decision

Prefer the materialized job design. Keep the alternative's useful idea—explicit typed values and lineage—but represent it as ordered durable references in the existing compile result. Do not add dynamic node execution, a pre-run prompt pass, or a second text queue. The cost is a deliberate restriction to one generated string per AI prompt job; that matches this request and makes preview, resume and dependency behavior explainable from one run snapshot.
