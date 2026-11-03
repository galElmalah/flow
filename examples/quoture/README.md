# Record branches

`shared-workflow.mjs` builds one shared source and art direction feeding separate quote, category and journey image branches. It accepts a source graph, cover records and cover image references. It does not read a consuming application's database itself.

Portable synthetic data lives in `test/fixtures/quote-records.json`. The behavior tests in `test/quoture-flows.test.mjs` and `test/prompt-guide.test.mjs` show the two independent output flows, record identity, shared prompt propagation and aspect-ratio rules.

Private source snapshots, project manifests, selected artwork and generated exports are excluded from Git. Supply your own records and upload images through Flow's supported client before running the generated graph.
