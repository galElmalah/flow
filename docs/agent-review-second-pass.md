# CLI, SDK and unused-code review

Three Astra reviewers independently exercised the CLI, SDK and repository
entrypoints. Findings required executable reproductions. All live workflow tests
used isolated storage and Local color lab; provider inference and personal
credentials were not needed.

## Interface fixes

- Empty, conflicting or incompatible CLI selectors fail before creating work.
  Help reports required arguments, allowed values and reference limits. Explicit
  port selection overrides environment defaults.
- Local recipes, style inputs and editor sources validate before uploading.
  Copied project pointers cannot rename or archive the original project, and an
  invalid default workflow no longer leaves a partially registered project.
- JSON wait failures retain the accepted run ID and full job receipt on stderr.
  Setup, launcher and demo help never install files or start work. Setup keeps
  PATH hints separate from its machine-readable result.
- Bound SDK uploads and inline graphs inherit project ownership. Graph methods
  accept plain graphs and Flow file envelopes. HTTP errors preserve status,
  caller headers and cancellation instead of hiding the original failure.
- Inline runs can be viewed and forked without a saved source workflow. Forks
  use authoritative recorded snapshots and retain `forkedFrom.runId`. CLI, MCP
  and the viewer use the same endpoint. Conflicting sources and foreign recorded
  runs are rejected.
- Recipe templates resolve shared input, retain per-scene references and shared
  image/video comparison settings, choose reference-aware endpoints, and reject
  empty record lists before submission.

## Removed code

- Three private-workspace benchmark/verification commands and their exclusive
  metrics helper/test cluster. They depended on development data absent from a
  clone and had no supported caller.
- Seven unused monochrome provider marks; active color/dark-interface variants
  and their upstream terms remain. The current asset inventory has 20 entries.
- The duplicate production paper-workflow fixture. Tests now load the shipped
  example through one test fixture.
- Unused imports, locals and internal exports; an unreachable image normalization
  branch; and confirmed obsolete CSS rules. Public SDK exports, dynamic workers,
  provider commands, skills and documented standalone tools remain entrypoints.
- The unused formatter dependency. Knip is pinned as development tooling, and
  `npm run check:unused` is included in normal checks. A deliberately unreachable
  fixture was rejected to verify that the gate catches additions.

## Verification

- Full architecture, unused-code, production build and **399 behavior tests**
  passed. The unused-code gate was also exercised on minimum Node 22.13.
- The isolated setup verifier produced four actual local outputs and inspected
  lineage and stdio MCP, without model downloads or external inference.
- Fresh GitHub clones with isolated homes and npm caches were used for install,
  build, user CLI/skills, demo creation/reopen and a separate npm SDK consumer.
  The consumer inspected actual output bytes, planning and saved lineage.
- Browser verification used a temporary profile and server for canvas, chat,
  providers, local models, image editing and style browsing. Current entrypoint
  coverage is explicit; static analysis is not a claim that every possible
  runtime branch or optional provider entitlement has been exercised.
  Both saved and inline-only recorded workflows rendered their original images
  and forked through the UI into new editable workflows with run ancestry.
- Source/release checks, documentation links, zero production audit findings and
  the 475-package license inventory passed. Final-commit CI and full-history
  secret-scan results are checked separately.

Start future agent tasks with [SETUP.md](../SETUP.md). Retain external entrypoints
in `knip.jsonc` only when their caller and purpose are known. This work does not
publish packages, change repository visibility or redistribute model weights.
