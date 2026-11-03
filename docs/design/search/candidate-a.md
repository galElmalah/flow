# Candidate A: a local, rebuildable semantic index and one autocomplete

## Problem

The gallery already stores its source material locally, but its search in `src/App.jsx` is a lowercase substring match against prompt, record fields and seed. A query such as “companionship after hardship” cannot reliably discover a scene about two travelers helping one another. Native `select` elements also give inconsistent search behavior and appear inside zoomed/clipped React Flow nodes. Real embeddings and a portal-based combobox solve separate concerns; neither needs to change generation adapters or require a database server.

## Usage (caller’s view)

The gallery submits meaning plus its existing scopes; it receives existing gallery objects with scores and explicit index state. Empty query still lists scoped images without waiting for a model. One local model download is cached under `.flow/models`; later inference works offline. No prompt or asset leaves the machine.

```js
// src/App.jsx: debounced 220 ms; abort previous request; ignore stale completions.
const result = await api.gallerySearch({
  query: galleryQuery,
  scope: galleryProject, // all | unassigned | project:<id> | workflow:<id>
  runId: galleryRun === 'all' ? undefined : galleryRun,
  providerId: galleryProvider === 'all' ? undefined : galleryProvider,
  limit: 100,
}, { signal });
setVisibleGallery(result.items);
setSearchState(result.index);

// client/index.mjs: project-bound agent uses the same route and semantics.
const flow = new FlowClient({ projectId: 'quoture' });
const { items, index } = await flow.searchGallery({ query: 'quiet friendship beside water' });
// items preserve records, prompt, references, run and project provenance.

// Any existing dropdown: simple typed choice surface, never synthetic DOM events.
<Autocomplete
  label="Filter gallery by provider"
  value={galleryProvider}
  options={[
    { value: 'all', label: 'All providers' },
    ...providers.map(p => ({ value: p.id, label: p.name, keywords: p.kind })),
  ]}
  onChange={setGalleryProvider}
/>
```

## How the current system works

**Overview.** `server/index.mjs` composes Store, Queue, providers and route registration. `server/store.mjs` loads authoritative SQLite workflow/run/project documents into Maps. Save operations update SQLite immediately, then write serialized JSON mirrors through per-file queued atomic renames. SQLite WAL is already enabled. `server/routes/runs.mjs` derives gallery entries from completed non-text jobs with an output, preserving run, workflow and project fields. No search service or embedding dependency currently exists.

**Key concepts.** A gallery item is a completed image job inside a run; its identity must be `(runId, jobId)`, not seed or prompt. A run retains historical project ownership. Project scope differs from a current workflow’s project. The app’s `matchesProject` also supports `workflow:<id>` and `unassigned`, while `ProjectService.filter` accepts only a registered project ID.

**Runtime.** App fetches `/api/gallery`, refreshes on gallery entry and queue updates, then applies project, run, provider and text filters locally. The initial gallery scope is this workflow’s full history. The new route must move all four filters to the server before ranking and limiting, rather than ranking globally then running the old local filters.

**Ownership.** Store remains the authority for provenance and image availability. Search owns derived embeddings, progress and model lifecycle. UI owns input state; shared autocomplete owns popup/focus mechanics. Providers remain unrelated to local search inference. `client/index.mjs` is the supported agent entry point and cannot import server code; the architecture checker enforces that boundary.

**Gotchas.** Provider defaults are `codex` when absent. Long resolved prompts repeat broad art rules which can overwhelm short scene meaning. Existing controls occur in App, `ProjectFilter`, `WorkflowMenu`, `ProviderPicker`, `AIPromptNode` and `GenerateNode`; replacement must cover all native selects. A portal prevents node overflow clipping but must also follow canvas zoom, scrolling and container movement. A completed job can be retried/changed while an old embedding is in flight.

## Shape

### Data first

Keep source SQLite untouched as the authority and add a separate **derived** `.flow/search.sqlite` owned only by the main search service. The worker never opens the Store database and never writes either database. This avoids two actors writing shared state, per separate-before-serializing-shared-state.

```text
search_documents(
  key TEXT PRIMARY KEY, run_id, job_id, project_id NULL, workflow_id, provider_id,
  created_at, source_hash, content_json, indexed_version NULL, error NULL
)
search_chunks(
  document_key, source_hash, model_version, chunk_no, vector BLOB,
  PRIMARY KEY(document_key, model_version, chunk_no)
)
search_meta(key PRIMARY KEY, value)
```

Indexes on document `project_id`, `workflow_id`, `run_id`, `provider_id` support scope selection. Vectors are normalized float32 blobs, dimension **384**, validated on receipt. The orchestrator has now proven `sqlite-vec@0.1.9` loads in this app’s `node:sqlite`; use its `vec_distance_cosine` over ordinary chunk BLOB rows for exact ranking, rather than implementing distance math or an ANN table. At the verified current corpus of 326 gallery images, scoped exact ranking is the smallest implementation. `model_version` is a fingerprint of a pinned model revision, tokenizer, dtype, pooling, normalization and projection version. A vector never compares across versions. `source_hash` covers canonical searchable material, not constantly changing job timestamps/status logs. Scope metadata updates even when text stays the same.

A document has several bounded chunks: (1) quote/author/scenery/category/journey record values, (2) resolved prompt windows. Build chunks from actual fields, not fabricated labels or synonyms. Strip neither source instructions nor provenance; only prioritize scene-rich chunks for retrieval. Score each document as its best chunk similarity, so repeated templates do not drown the distinguishing scene. Keep full prompt accessible in the existing detail tray. Exact seed/ID matching can add a small lexical boost, but do not label lexical fallback semantic search.

### Public signatures and module map

```js
// server/search/documents.mjs — pure, independently tested projection.
export function galleryDocument(run, job) { throw new Error('not implemented'); }
// Returns null for anything outside the existing gallery eligibility rule,
// otherwise { key, runId, jobId, projectId, workflowId, providerId,
//   createdAt, sourceHash, chunks: string[] }.
export function scopedDocuments(documents, scope) { throw new Error('not implemented'); }

// server/search/index.mjs — one owner, one deep public interface.
export class GallerySearch {
  constructor({ store, root, workerFactory }) { throw new Error('not implemented'); }
  async start() { throw new Error('not implemented'); }
  refreshRun(run) { throw new Error('not implemented'); }
  async search(request, { signal } = {}) { throw new Error('not implemented'); }
  status() { throw new Error('not implemented'); }
  async close() { throw new Error('not implemented'); }
}

// server/search/worker.mjs — dedicated worker_threads entry point.
// Protocol: {id, kind:'embed', texts} -> {id, vectors, version}
// Lazy-load one pinned @huggingface/transformers feature-extraction model.
// Mean pooling + normalize:true; bounded batch size and one inference at a time.
// Return vectors only. Main service uses sqlite-vec exact cosine over SQL-filtered candidates.

// server/routes/runs.mjs — add POST /api/gallery/search.
// Parse query (max length), discriminated scope, limit 1..200, optional run/provider.
// Registered project/workflow must exist. Pass domain request to search.
// Existing /api/gallery remains plain list API, preserving current consumers.

// shared/search.mjs — Zod request contract + status discriminants.
// SearchRequest = {query, scope, runId?, providerId?, limit}
// SearchResult = {items: GalleryItemWithScore[], total, index: SearchState}
// SearchState = {phase:'loading'|'indexing'|'ready'|'error', indexed, total,
//                modelVersion, message?, error?}

// src/components/Autocomplete.jsx + CSS — reusable controlled combobox.
export function Autocomplete({label, value, options, onChange, disabled, className}) {
  throw new Error('not implemented');
}
// Option = {value:string, label:string, keywords?:string, disabled?:boolean}
// client/index.mjs adds searchGallery(request, {signal}={}): Promise<SearchResult>.
```

The service hides reconciliation, worker RPC, durable vectors, ranking, stale-result suppression and recovery behind `search` and `status`. Callers expose only meaningful scopes and a query. No embeddings or wire messages appear in the client API, per boundary-discipline.

### Incremental consistency and recovery

1. `start()` reconciles all authoritative completed image jobs against stored document identities/hashes, deletes absent documents, and enqueues missing/version-mismatched vectors. Model initialization happens asynchronously; server startup and generation stay available.
2. Add one Store change subscription immediately after successful SQLite `persistRun`; emit an immutable run snapshot. `refreshRun` updates only that run’s eligible documents in a transaction, invalidates changed vectors immediately and enqueues new hashes. It must not depend solely on Queue SSE, since another route/save path may write the same run.
3. Worker returns vectors with source hash and model version; service commits only if the current document still matches both. Late embeddings are discarded. The latest queued revision wins.
4. Search first obtains current canonical items and applies **all** project/workflow/run/provider filters. Only corresponding current-hash/current-version vector rows become rank candidates. Use SQL `WHERE` scope predicates before grouped `MIN(vec_distance_cosine(vector, queryVector))`, select top-k by document score, hydrate from Store again and revalidate hash/eligibility before returning. If source changed during ranking, omit it and refresh rather than returning stale provenance. `total` refers to eligible scoped documents; `index` discloses pending coverage.
5. New or changed images appear in empty-query browsing immediately; semantic search can honestly return partial results with “Indexing 3 images” until embedded. Errors never clear the authoritative gallery or show “No matches” as a model failure.
6. Crash midway leaves each committed vector valid; restart requeues pending hashes from Store. Index corruption can be rebuilt by deleting only `search.sqlite`; no image/workflow/history loss. Explicit retry restarts worker/model setup without requiring an image run.

### Background inference and errors

Use one worker with bounded threads and small batches. Service gives interactive query embedding priority between indexing batches so a large run completion does not freeze search. Track request IDs; reject outstanding RPCs on worker exit, mark error and allow explicit retry. An aborted browser request must not overwrite UI results or spawn endless abandoned query work. Cache a small number of query embeddings by normalized text + model version. Do not retry permanent missing/model setup failures in a tight loop. First download should show progress and a retry action; offline startup with an empty model cache must show setup failure while plain gallery browsing still works.

### Autocomplete behavior

Use a `createPortal(document.body)` listbox with fixed viewport coordinates from the trigger’s bounding rectangle; position below or above based on available room, width at least trigger width, clamp horizontally and apply max height. Recompute on captured scroll, resize, ResizeObserver and animation-frame movement while open so transformed canvas nodes stay attached. Close when trigger disappears or is outside view. A central popup layer should sit above trays/nodes/modals; do not put CSS transforms on body.

The combobox input shows the selected label when closed and acts as the search field when open; typing filters labels/keywords (Unicode normalization, case insensitive). Arrow keys move active options; Enter selects; Escape closes/restores selected label; Home/End navigate; Tab closes without trapping focus. Maintain `role=combobox`, `aria-expanded`, `aria-controls`, `aria-activedescendant` and listbox options; disabled options cannot activate. Outside pointer closes; option pointer-down preserves input focus so blur cannot discard the click. Stop wheel/drag/pointer propagation in React Flow controls. Add `.nodrag.nowheel` on node controls. Keep disabled existing values visible rather than silently changing provider. No free-text value is committed unless a future caller explicitly needs creatable options.

## Synthesis decision

Candidate A is a standalone local-first proposal; orchestrator fills synthesis after comparing candidates.

## Tradeoffs accepted

- Accept exact O(N × 384) ranking over **filtered** local vectors in exchange for no database daemon, portable persistent data and easy rebuilds. At the present 326-image corpus, a native SQLite cosine scan is small. Measure real corpus latency before introducing ANN or a separate ranking worker.
- Accept a first model download in exchange for genuine local inference and no API key requirement.
- Accept explicit partial indexing state in exchange for keeping generation and normal browsing available during inference.
- Accept text semantics over prompts/quotes/metadata rather than visual pixel similarity. The UI should say “Search scenes, quotes and prompts.” A multimodal index is a separate feature.

## Alternatives considered

**PostgreSQL + pgvector.** Strong choice for many concurrent users or a shared server, but local setup adds a daemon, credentials, backup/version lifecycle and an extension installer. Public query interface can remain equally deep; operational complexity leaks into every agent’s bootstrap. User asked “pgvector or something,” so local SQLite vectors satisfy the capability without pretending PostgreSQL is required. With pgvector, apply project/workflow filters inside candidate selection; approximate nearest-neighbor post-filtering can underfill scoped results and requires careful iterative scans or exact scoped ranking. Avoid treating a global ANN top-k followed by a WHERE filter as equivalent.

**sqlite-vec ANN/vec0 tables.** Native sqlite-vec loading has now been proven by the orchestrator, so use its ordinary exact cosine function now. A separate virtual KNN table introduces a second metadata/vector consistency model without improving capability for the 326-image corpus. Keep ordinary chunks joined to filtered documents; later introduce KNN only after scoped-query semantics and latency justify it.

**Hosted embedding APIs.** Smaller model distribution but expose credentials, external calls, cost and availability; fails the grounded fully local requirement. Keep generation BYOK providers separate from search.

## Open questions and risks

- How should a user tune relevancy if generic art-direction instructions dominate scenes? Verify one paraphrase absent from indexed text and inspect expected ranks before choosing chunk weighting or any threshold; do not invent a numerical cutoff beforehand.
- Is the model cache available on every target platform? Prove first download, offline reuse and startup without cache; document exact model/revision and local storage location.
- Does popup tracking remain correct while panning/zooming a node, and when its tray morphs? Exercise all three live, including opening near the viewport bottom and inside scroll containers.
- Does long prompt truncation lose the quote scene? Structured chunks plus bounded prompt windows must preserve tail content; test with a long template that places scene last.

## Next implementation step

Build pure document projection and an index service test with an injected deterministic embedder for consistency/scope cases, then load the real local model and prove an absent-word paraphrase finds the intended gallery item.

Reference checked: Hugging Face’s [feature extraction API](https://huggingface.co/docs/transformers.js/api/pipelines) documents normalized mean-pooled embeddings and 384-dimensional MiniLM output; [pipeline configuration](https://huggingface.co/docs/transformers.js/en/pipelines) documents pinned model revisions and dtype. Model checkpoint revision must be pinned during implementation.
