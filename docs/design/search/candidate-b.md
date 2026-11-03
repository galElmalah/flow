# Candidate B: derived vector sidecar and one portal autocomplete

## Problem

Gallery entries are authoritative completed image jobs inside Store run documents. `/api/gallery` currently projects them in `server/routes/runs.mjs`, while `App.jsx` searches records, prompts and seeds with a substring. Store already uses Node SQLite with JSON mirrors, schema version 2 and in-memory maps. Semantic inference must not stall its synchronous writes or image scheduling. About fifteen native dropdown call sites span App, project menus, provider configuration and nodes; node transforms and panel overflow make inline suggestion lists unsafe.

## Usage (caller's view)

The agent uses the existing client, with its project restriction enforced in the client and server:

```js
const client = new FlowClient({ projectId: "quoture" });
const result = await client.searchImages({
  query: "quiet companionship while crossing a difficult path",
  workflowId: "quoture-10-studies",
  limit: 40,
});
// { items: [{ ...galleryImage, similarity }], index: { state, ready, pending, ... } }
```

Browser search includes all filters in the request rather than filtering the first global results afterward:

```js
// galleryScope is parsed from the UI's project:/workflow:/unassigned value.
const result = await jsonRequest("/api/gallery/search", {
  method: "POST",
  signal: controller.signal,
  body: JSON.stringify({ query, scope: galleryScope, runId, providerId, limit: 100 }),
});
// Keep result.items order. An empty query returns scoped chronology without inference.
```

Every existing dropdown uses one component; callers supply existing domain choices:

```jsx
<Autocomplete
  label="Filter gallery by run"
  value={galleryRun}
  options={[
    { value: "all", label: "All runs" },
    ...galleryRuns.map(run => ({ value: run.id, label: run.name })),
  ]}
  onChange={setGalleryRun}
/>
<Autocomplete
  label={`Model for ${data.label}`}
  value={data.model || "default"}
  options={modelsFor(provider, "text").map(value => ({ value, label: value }))}
  allowCustom
  onChange={model => editNode(id, { model })}
/>
```

## Shape

This candidate keeps a disposable `.flow/search.sqlite` database owned by one worker thread. The primary database never stores embeddings or waits for model loading. Main-thread `GallerySearch` owns canonical gallery projection, filter validation and reconciliation with live Store documents. The worker owns the model, its pending inference and the sidecar connection. Neither actor writes the other's state.

Use a real local sentence embedding model through `@huggingface/transformers`, initially a pinned quantized MiniLM sentence transformer. Pin model ID, model revision, dimension, pooling, normalization and extraction version as one `indexVersion` descriptor. Verify the package's current supported Node inference and model file behavior before implementation. First use may download model weights; subsequent inference and persisted vectors remain local. Expose that first download explicitly. There is no API key or semantic synonym substitute.

SQLite stores normalized Float32 vector BLOBs plus IDs and content hashes. Read the eligible vectors and compute exact cosine in the worker. This is a real durable vector search, with no platform-specific extension ABI. The current hundreds/thousands-image corpus does not justify an approximate nearest-neighbor dependency. Top-k must follow SQL eligibility filtering, never precede it. At 10k eligible images, 384-dimensional float storage is about 15 MB; measure actual query latency before an approximate index is introduced.

### Domain and interface sketch

```ts
type GalleryScope =
  | { kind: "all" }
  | { kind: "unassigned" }
  | { kind: "project"; id: string }
  | { kind: "workflow"; id: string };
type GalleryFilters = {
  scope: GalleryScope;
  runId?: string;
  providerId?: string;
};
type SearchImage = GalleryImage & { similarity: number };
type SearchStatus = {
  state: "starting" | "downloading" | "indexing" | "ready" | "failed";
  ready: number;
  pending: number;
  model: string;
  error?: string;
};
type SearchResult = { items: SearchImage[]; index: SearchStatus };

class GallerySearch {
  constructor({ store, dataRoot });
  start(): void; // Starts worker and startup reconciliation without awaiting inference.
  list(filters: GalleryFilters): GalleryImage[];
  search({ query, filters, limit, signal }): Promise<SearchResult>;
  status(): SearchStatus;
  close(): Promise<void>;
}

// Pure source extraction and filtering; no model or SQL imports.
function galleryDocuments(runs): GalleryDocument[];
function matchesGalleryFilters(image: GalleryImage, filters: GalleryFilters): boolean;

type GalleryDocument = {
  key: string; // `${run.id}/${job.id}`: never assume a job ID is globally unique.
  contentHash: string;
  text: string;
  image: GalleryImage;
};

// Public browser API deliberately has no worker, index or SQL concepts.
function Autocomplete({
  label, value, options, onChange, disabled, allowCustom = false, className,
}): JSX.Element;
type Choice = { value: string; label: string; description?: string; disabled?: boolean };
```

Boundary schemas parse scopes, trim and bound queries, validate filter IDs and bound limit to 1–200. Absent filters are normalized once. Client `searchImages` adds its project scope; attempting another project or an all/unassigned scope from a project-bound client is rejected, as current workflow writes do. A workflow filter may narrow that project, not broaden it. No request accepts arbitrary SQL/model paths. No callers handle vector math or index freshness.

### Source text and sidecar shape

Extract only completed non-text jobs with output. Text sections contain resolved positive scene prompt, record title, quote/author/category/journey fields and workflow/run label. Avoid embedding image paths, logs and long negative instruction boilerplate, which drown scene semantics. Raw numeric seed/reading ID remain available for exact-ID matching but are not semantic text. For prompts beyond model token length, split into bounded passages, embed, mean-pool and renormalize; never silently truncate away the source quote. Hash the normalized extracted passages plus extraction version. Source provenance always comes from current authoritative gallery entries, not sidecar copies.

```sql
CREATE TABLE index_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE embeddings (
  document_key TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  index_version TEXT NOT NULL,
  vector BLOB NOT NULL,
  embedded_at TEXT NOT NULL
);
```

There is no duplicate project/workflow ownership table. Search receives the currently eligible `{key, contentHash}` pairs from main-thread filtering, inserts them into a per-query worker temporary table and joins on both key and hash before cosine. Thus ownership and filters are resolved before ranking, and stale content cannot enter results. Metadata does not need reembedding when only project/run/provider filtering changes. The temporary table lives inside the worker's single serialized SQL query turn and is cleared every query; no concurrent query shares its intermediate state.

### Incremental consistency and recovery

1. On start, reconcile the full current gallery catalogue: missing or mismatched hashes become pending; vanished keys are deleted. Durable vectors matching the current model/extractor identity are immediately reusable.
2. `Store.saveRun` exposes one post-persist notification after SQLite and its authoritative map are updated. GallerySearch debounces these notifications, reprojects the affected run and sends replacement descriptors for that run. Save cadence while an image runs does not cause repeated embeddings because content hashes do not change. Notification is acceleration only: the search method snapshots the current authoritative eligible set again before every query, so a missed notification cannot admit stale results.
3. Each worker inference captures `{key, hash, version}`. On completion it writes only if that triple still matches its latest desired catalogue. A changed/deleted job cannot be resurrected by an older in-flight embedding. One worker owns sidecar writes, and one SQLite transaction publishes each vector; crash halfway leaves the prior vector or no vector.
4. Search queries have priority between document embedding batches, so a rebuild never queues a query behind thousands of images. Model execution is off the HTTP thread. The worker keeps a bounded LRU of query vectors keyed by model version and normalized query. Concurrent identical queries share one inference promise.
5. While indexing, return ranked current indexed items with `pending` count and an explicit indexing state. If there are no eligible indexed rows, return an empty set with that state, not “No matching images.” SSE search-status updates let the browser repeat its current query as pending items complete. These events use a monotonic search revision so the UI can ignore duplicates.
6. On model/version change, incompatible vectors are excluded by identity immediately; rebuild is honest. No mixed-dimensional rankings. Old rows can be replaced incrementally. A corrupt/unreadable sidecar is quarantined and rebuilt; authoritative runs remain untouched. Failure to load/download/embed sets actionable failed status and a retry action; no silent lexical fallback labeled semantic.
7. After rank result delivery, main maps keys/hashes to the *current* gallery again. If a run changed during inference, stale hits are removed; optionally rerun once if that removes results. Scope filtering always stays authoritative. Provider defaults use the same `providerId || "codex"` normalization as existing gallery.

Store hook errors must not roll back or fail completed image persistence; the read-boundary reconciliation ensures correctness. The sidecar is a rebuildable cache, so it has no migration impact on primary schemaVersion 2 or JSON import. Search stop/close aborts worker inference and closes its own DB before Store closes.

### Browser autocomplete behavior

`src/components/Autocomplete.jsx` owns popup position, filtering, ARIA and keyboard state. Use `@floating-ui/react` for a body portal with fixed positioning, flip/shift/size and `autoUpdate` while open. React Flow canvas transformations are covered by `animationFrame: true` only while a popup is open. Bound height and width to the viewport and anchor; white/black surfaces, state-only borders, no new green accents. Mark wrapper and portal `nodrag nowheel`; stop canvas drag/wheel propagation only for popup interaction. Scrolling the list must not pan canvas or parent panel.

The input is `role=combobox`, controls a unique listbox ID, reports expanded state, and uses `aria-activedescendant`. Arrow keys move active options, Enter selects, Escape closes and restores committed label, Tab closes without stealing focus, click selects before blur teardown. On reopen, typed filter resets and the selected option is visible. Distinguish empty results from disabled choices. For fixed choices, arbitrary text never changes the stored value; blur restores the chosen label. `allowCustom` commits typed model names on Enter/blur. Selected persisted values absent from current options remain visible and are never silently overwritten. Independent instances use React IDs; there is no global dropdown state or synthetic select event API.

Replace every native select in the same pass; don't keep a second native API. Existing ProviderPicker's specialized provider cards remain because they convey capabilities/configuration; its settings select uses Autocomplete. Numerical controls convert string values at their call site as they do now. Add a cheap architecture assertion rejecting `<select`/`<option` in src so agents cannot accidentally reintroduce inconsistent controls.

### Module map

| File | Owns |
| --- | --- |
| `server/search/gallery.mjs` | Pure canonical projection/text extraction, hash, filter semantics |
| `server/search/index.mjs` | GallerySearch public class, live Store reconciliation, worker transport |
| `server/search/worker.mjs` | One local model, sidecar connection, batching, exact ranking, versioning |
| `server/routes/search.mjs` | Input schemas, HTTP adaptation, explicit search status/retry route |
| `src/components/Autocomplete.jsx` | Every dropdown's input/listbox/portal/focus/keyboard behavior |
| `src/gallery/useGallerySearch.mjs` | Debounce, AbortController, monotonic request identity, search states |
| `client/index.mjs` | Agent-facing `searchImages` scoped consistently with existing client |

The index has a deep interface: two caller actions, list and search, hide durable projection, vector readiness, worker transport and stale-result rejection. The worker protocol stays private; API wire schemas do not leak into the client/public domain shape. Routes, search and worker are the longest query chain; filters/extraction remain pure in the search directory.

## Synthesis decision

Candidate for comparison; no other candidate inspected and no synthesis decision presumed.

## Tradeoffs accepted

- We accept eventual inclusion of new embeddings in exchange for responsive generation and honest partial results; stale source hashes are never returned.
- We accept one extra disposable SQLite file and startup reconciliation in exchange for zero coupling between model/index failures and the authoritative workflow DB.
- We accept linear exact scoring over prefiltered vectors in exchange for reproducible search correctness and no native vector-extension deployment issue at the present corpus size.
- We accept a local model download and memory footprint in exchange for semantic search that needs no API subscription or key.

## Alternatives considered

- **Same primary DB + sqlite-vec:** compact persistent storage and fast SQL nearest-neighbor ranking, but the embedding worker needs access to Store's DB and migrations or sends writes back to the main event loop. Native extension compatibility adds installation/runtime setup. Its deeper ranking API is useful when size requires it; it hides little additional meaningful complexity at hundreds of images while sharing failure/locking boundaries with image persistence.
- **Postgres + pgvector:** excellent indexed vector service and server-side filtered ranking, but introduces a second always-running service, credentials, backup lifecycle and setup for an application explicitly local and already SQLite-backed. Callers can stay identical, but operators must learn much more; there is no current demonstrated corpus size requiring it.
- **In-memory vectors with JSON persistence:** avoids SQL, but publishing partial files and crash recovery recreate durability machinery already present in SQLite. It also makes persistence ownership less obvious to agents and multiplies sources of truth.

## Open questions and risks

- Does a pinned English-oriented MiniLM match this actual quote/scenery corpus well enough, including any Hebrew prompts? Verify held-out paraphrases and multilingual examples before accepting the model; change model once with an explicit version rebuild if needed.
- Can quantized inference stay responsive alongside sixteen native Codex workers? Measure UI and query latency during indexing without running paid image inference; cap worker batch size and thread count if necessary.
- Do long template negative instructions dominate the current resolved prompts? Inspect actual sources and test section-aware extraction before indexing the whole corpus.

These are implementation verification questions, not reasons to wait for user approval.

## Next implementation step

Implement pure gallery projection/filter/hash tests, then a single-worker end-to-end query over a temporary sidecar proving a paraphrase with no shared search terms and proving scope is applied before top-k.
