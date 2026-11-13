# Agent interface contract

## Work and verification

- [x] Ground CLI, SDK, MCP, planning, queue and persistence in source.
- [x] Compare resource-oriented and operation-catalog designs with two Astra reviewers.
- [x] Run three isolated baseline CLI/SDK/MCP trials; retain reproducible failures.
- [x] Implement strict boundary validation, scoped discovery and safe retries.
- [x] Verify fresh setup and repeat real local workflow trials across all interfaces.

## Synthesis decision

Use the existing HTTP services and SDK rather than replace working APIs with a
second dispatcher. The CLI gets an offline command catalog for focused help and
argument validation. Shared run schemas define accepted overrides and controls
for HTTP, SDK and MCP. Existing graphs and historical run snapshots stay readable.

The resource-oriented candidate exposed ambiguous counts, globally mutable
concurrency and duplicate submissions. The catalog candidate exposed ignored
arguments and help that could mutate storage. Both matter more than a broad
renaming of every method. Preserve current command and SDK names while fixing
their observable contracts.

## Caller contract

```js
const plan = await client.plan(workflowId, { count: 2 });
const run = await client.run(
  workflowId,
  { count: 2 },
  {
    requestId: "campaign-batch-001",
    concurrency: 8,
  },
);
const result = await client.wait(run.id, { timeout: 60 });
```

Plan is read-only. Creation and reference uploads are explicit steps. Count means
copies per scene/record and generation mode, not a batch total. Submission returns
the full run with `id` on CLI, SDK and HTTP; MCP wraps it in `data`.

The optional request key is scoped to the submitting project context. A matching
request replays the durable run, even after restart; a changed intent returns
409 `REQUEST_ID_REUSED` with its run ID. Saved-workflow retries compare the saved
selector and explicit overrides, so later workflow edits do not duplicate an
already accepted batch. New intended work needs a new key. Snapshot submissions
include the complete graph in their fingerprint.
Unbound and explicit unassigned contexts have separate reserved scope markers.
Every receipt lookup checks ownership. A file-mirror failure after SQLite commit
preserves a paused run with an actionable 503 error and its run ID; it neither
dispatches implicitly nor loses the receipt.

Concurrency is a persisted per-run ceiling. The scheduler's aggregate capacity
is the maximum of its default and active run ceilings; starting a small run never
reduces another run's limit. Provider execution lanes remain authoritative.

Waiting has a bounded network deadline. Timing out preserves server work and
returns a recoverable error carrying the run ID. Agent setup starts in SETUP.md;
offline CLI help describes accepted flags and effects without touching the server.
