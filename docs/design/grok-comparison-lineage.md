# Grok modes and asset occurrences

The caller adds modes to an existing image/video node, plans and runs once, then reads
an asset's lineage and edits only its annotations. See [usage](../grok-and-lineage.md).

Two independent design candidates compared enriched run/job-ledger provenance with a
normalized occurrence registry. Both use generation-node modes and one durable queue.
The chosen shape keeps modes in the planner (candidate A) and uses candidate B's asset
registry for uploads, generated text, editor artifacts and cross-run parents. A job-only
projection cannot give an unused upload its own review identity. Separate experiment
workflows/queues would duplicate prompts, record state and paid-request recovery.

`shared/generation-modes.mjs` owns mode validation and plan summaries. `server/graph.mjs`
expands contexts × modes × copies, preserving record joins and paired variation labels.
Full image/video mode overrides avoid retaining settings from a previous provider.
Native xAI JSON image editing cannot use the generic OpenAI multipart adapter; the Grok
integration owns deferred submission, poll/download, actual progress and private keys.

`server/assets.mjs` owns immutable occurrence facts and parent resolution. Store owns
indexed SQLite v3 asset/review tables. Queue freezes the actual inputs and captures the
final normalized bytes before publishing completion. Files retain their normal URLs;
there is no second binary store or inference scheduler. Reviews use a separate revision
and never mutate run snapshots. Historical observations remain partial.

Both native APIs use provider-scoped `providerOperation` receipts. Store migrates legacy
Gemini receipts once; adapters and queue use the new contract exclusively. Unknown paid
POST outcomes cannot be replayed automatically. Parent/role identities and content hashes
are separate, so deduplication does not merge annotations or invent provenance.

The boundary is deliberately small: normal create/plan/run; asset read/lineage/annotate;
JSONL export. UI, client, CLI and MCP call these same routes. No model-specific training
format or remote upload is implied. Local protocol fixtures verify implementation;
only an authenticated live request can verify xAI account access.

The candidates were independently produced with the available inherited model. The
skill's cross-family reviewer was unavailable. Synthesis retained one shared queue,
private credentials, immutable evidence and explicit missing historical values.
