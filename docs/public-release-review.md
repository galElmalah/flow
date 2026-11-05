# Public release review — November 5, 2026

Three independent agents reviewed security, clean-checkout setup, and licenses/documentation, starting at `839c9cf`. The fixes below are in this changeset. The repository remains private. No X post, visibility change, package publication or deployment was performed.

## Fixed findings

| Finding | Result and reproducible verification |
| --- | --- |
| Private-workspace reference traversal | Canonical upload/reference namespaces, traversal/encoding/symlink rejection, and raster verification before copying snapshots or invoking providers. The synthetic canary now produces rejection, no snapshot and HTTP 404; previously a failed job still published the private bytes. `node --test test/asset-path.test.mjs` |
| Credential-bearing request metadata | Compatible API request IDs are bounded/validated; configured-key echoes are omitted before persistence. `node --test test/providers.test.mjs` |
| Implicit search-model download | Normal indexing/search uses cached weights offline. Missing cache reports setup-required; Download search model or CLI search-retry explicitly permits retrieval for that worker. `node --test test/search-setup.test.mjs` |
| Private artwork dependencies in shipped demo | Replaced private URLs, IDs, project links and simulated account statuses with the bundled fixture and synthetic preview metadata. Browser selection, material switch and search worked. |
| Broken public documentation links | Removed missing private-evidence targets, fixed obsolete source paths, replaced stale MCP counts with live discovery, and added a source-link checker to release checks. |
| Environment/minimum-version test assumptions | Fixture clients now set explicit URLs instead of inheriting FLOW_URL. Temporary executable uses .mjs on Node 22.13. Queue fixtures produce real PNGs while preserving scheduling/concurrency assertions. |
| Current Pi asset provenance | Replaced the separate website SVG with the integrity-verified MIT-licensed pinned Lobe Icons mark. Included notice retained. |

See [the resolver](../server/asset-path.mjs), [queue](../server/queue.mjs), [provider adapter](../harness-integrations/openai-compatible/image.mjs), [search worker](../server/search/worker.mjs), and [demo](../public/demos/liquid-glass/index.html).

## Verification

- Architecture, production build and **375/375 tests** pass on macOS Node 24.22.1. All **375/375 tests** also pass on minimum Node 22.13.0.
- Source/release checks and all public Markdown file targets pass. `npm run check:licenses` inventories 418 locked packages with no unresolved license metadata/file evidence; this is not a blanket compatibility conclusion.
- `npm audit` reports zero vulnerabilities. Full-history Gitleaks has no findings. Private databases, credentials, model weights and galleries remain excluded.
- Source-only clean-HOME npm ci/setup/serve/reuse/stop, project registration, four local-processing outputs and real MCP SDK discovery succeeded. Installed helper worked from another consuming directory.
- Repeated setup preserved managed skills byte-for-byte and by modification time. Modified managed skills were not overwritten; unrelated skills were preserved.
- Fresh local-processing demo made zero external fetches or model downloads. Browser search offered its explicit download action, clearing search restored outputs, and Gallery survived refresh after bootstrap.
- Actual existing cached weights produced a 384-dimensional embedding with network access blocked.
- CI is configured for Linux Node 22.13.0/24 and macOS Node 24. Previous source revision CI/secret scans passed; check this changeset's [Actions results](https://github.com/galElmalah/flow/actions).

No cloud generation, new model download or live paid-provider entitlement test was performed. SAM cold setup, broader hardware installs and Windows are not established by these checks.

## Remaining publication gates

1. **Asset rights:** the bundled paper fixture has no generation/reference receipt in audited source. Its hash and required owner clearance are recorded in [asset provenance](asset-provenance.md). It also exists in Git history, so deleting only the current file does not resolve historical publication. Existing local artwork/history was preserved. Clear the exact X screenshots/video separately.
2. **GitHub settings:** private vulnerability reporting returned 404, so enablement is not established. Main protection returned 403 with GitHub's plan/visibility restriction. Verify reporting and configure protection when public or when the plan allows it. No settings were changed.
3. **Publication decision:** source remains MIT, npm remains private. Confirm ownership and source-only publication before changing visibility. Prebuilt bundles/binaries need the additional dependency notices/source handling described in [licenses](licenses.md).

This review fixes the demonstrated failures; it does not prove absence of all vulnerabilities or grant rights to unreviewed media.
