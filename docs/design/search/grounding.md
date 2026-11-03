# Search and autocomplete work

Phases: Ground (complete), Sketch (in progress), Agree (automatic), Implement, Scrap if verification rejects design.
Arena: Frame (complete), Fan out (in progress), Cross-judge, Pick, Graft, Verify.

## Overview
Flow is a local Node/React app, backed by SQLite. Store owns saved workflow/run/project documents; runs snapshot resolved prompts and record fields. The gallery endpoint derives completed image jobs from those documents. Gallery search currently lowercases concatenated prompt/record text and performs substring filtering in App.jsx. Projects, run/provider filters and node configuration use native select elements. ProviderPicker already has a custom searchable provider list.

## Runtime and ownership
server/index.mjs composes routes and services. Store.saveWorkflow/saveRun persist SQLite and JSON mirrors. UI fetches gallery snapshots and SSE refreshes on queue events. ProjectFilter supplies scopes (all, unassigned, project:id, workflow:id); project scope must precede search ranking. Client/index.mjs exposes supported agent APIs. Component autocomplete should own keyboard/focus/popup mechanics, while callers own typed choices. A derived semantic index can be rebuilt from authoritative Store documents without migrating original data.

## Goal and constraints
Every native dropdown becomes a searchable autocomplete with dark monochrome appearance, keyboard support and popup positioning outside clipping/scrolling nodes. Search gallery by meaning across resolved scenes, prompts, quotes/author metadata, preserving project/workflow/run/provider filters and source provenance. Use real local embeddings and durable vector storage; no fake synonyms, API keys or hosted queries. No inference image runs. Search must report initializing/indexing/failure honestly and handle new/changed documents and restarts. Prefer a small local setup over requiring Postgres. Agent API should expose semantic search too.

## Rubric
1. Actual semantic matching demonstrated with a paraphrase absent from indexed text.
2. Fully local operation and durable index with incremental updates and no stale results.
3. Existing filters and explicit project ownership respected before limiting results.
4. Autocomplete keyboard/focus/scroll clipping correctness with consistent simple integration.
5. Small explicit interfaces, independently testable behavior, obvious agent navigation.
