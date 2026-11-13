# Release preparation — November 13, 2026

An independent Astra agent reviewed Flow's code, installation, licensing and
tracked media after the 41-style expansion at `77443e2`. The repository remains
private. This review does not authorize a visibility change or registry release.

## Changes made

- Setup installs a user-level `flow` executable. Repeated and concurrent installs
  converge, existing foreign commands are preserved, and uninstall removes only
  this checkout's launcher. Help/version work offline from another project even
  if its local manifest is invalid.
- Package exports expose `FlowClient`, graph builders and file helpers through
  `flow` / `flow/client`, and all 257 built-in briefs through `flow/styles`. A
  consuming project can install the local checkout without a registry release.
- The setup verifier supplies a genuine temporary HOME/USERPROFILE to the server,
  CLI and MCP process. Previously, omitting HOME allowed Node's home lookup to
  resolve the operator's real home. Assertions now guard each Node child.
- README, AGENTS.md and [installation](installation.md) explain CLI installation,
  PATH, version selection, SDK imports, plan-before-run and private local data.
- The [one-page explainer](launch/index.html) includes the four selected product
  captures, the complete style-brief JSON, and hashes/terms for 27 tracked visual
  files. Rebuild it with `node tools/build-explainer.mjs`. No personal gallery or
  generated run data is read. New style-preview images have not been generated.

## Evidence

- Architecture check, production build and all **379 tests** passed locally.
  Four new tests cover executable use from another directory, idempotent setup,
  foreign command preservation, concurrent operations and consumer SDK imports.
- `npm run verify:setup` passed with two isolated setup runs, bare CLI use from a
  consuming project, four local-processing outputs, saved lineage and real MCP
  discovery. No inference, model download or inherited credentials were used.
- A separate disposable project ran `npm install --offline --ignore-scripts`
  against this checkout and successfully imported the SDK and 257-style catalog.
- The actual user CLI installation reported its command directory already on
  PATH; `flow --version` succeeded from another directory.
- Source/release file checks passed. The dependency inventory covers 418 locked
  packages with zero unresolved license metadata/files. This is not a blanket
  compatibility assessment for compiled redistribution.
- At the reviewed baseline, [CI](https://github.com/galElmalah/flow/actions/runs/43361619548)
  passed on Linux Node 22.13/24 and macOS Node 24. The
  [full-history secret scan](https://github.com/galElmalah/flow/actions/runs/43361619518)
  found no leaks across 14 commits. Check the final preparation commit's Actions
  results separately; a baseline scan does not certify later changes.

## License and asset decisions

Flow code and style briefs use MIT. Commercial use, modification, redistribution,
sublicensing and sale are permitted while retaining the copyright/license notice.
There is no Flow license fee. Third-party fonts, trademarks, dependencies, optional
models and provider charges keep their own terms. The Node launcher does not bundle
a native runtime, compiled browser app or model weights for redistribution.

Before making Git history public, decide how to handle the unverified paper
fixture, the former Pi mark attributed to `pi.dev`, and the initial glass demo's
old workspace URLs/IDs. These earlier bytes remain in history despite current-tree
fixes. No history rewrite was performed.

The four selected JPEG captures have no detected EXIF, IPTC, XMP or comment
metadata. Their inclusion in the private report was requested; public clearance
of depicted artwork and seed/reference materials is still pending. See
[asset provenance](asset-provenance.md) and [the release checklist](open-source-readiness.md).

## Agent interface follow-up

Two Astra reviewers compared interface designs and reproduced failures against
isolated storage. A separate agent completed three baseline usage rounds and two
final rounds through the actual CLI, SDK and stdio MCP. The final rounds passed
24 checks without inherited credentials or paid inference.

- [SETUP.md](../SETUP.md) is the first-clone entrypoint, prominently linked in
  README and enforced by release checks. It includes installation, discovery,
  local outputs, provider setup boundaries, errors and recovery.
- One shared CLI catalog supplies scoped offline help and early argument
  validation, also exposed at `/api/help`. Invalid numbers and irrelevant flags
  no longer silently disappear. Help cannot invoke migration or uploads.
- Explicit workflow selectors and style provider/model choices are honored.
  CLI planning is read-only; run submission returns the full run with `id`.
- Shared schemas validate HTTP, SDK and MCP run controls. Project-bound SDK
  writes reject foreign ownership. Wait deadlines cover pending HTTP reads.
- Optional stable submission keys prevent duplicate runs after concurrent
  requests, a lost response or restart. Conflicting intent returns the original
  run ID. A SQLite uniqueness constraint protects durable receipts.
- Concurrency is persisted per run. File-mirror failures after a database commit
  preserve a paused, recoverable receipt instead of stuck or duplicated jobs.
- MCP submit, inspect and wait advertise output schemas. Protocol-level invalid
  tool arguments can still return SDK diagnostic text rather than application
  structured errors; the MCP guide documents that distinction.

All **389 behavior tests**, architecture checks and the production build passed
locally after these fixes. The isolated setup verifier again produced four real
local outputs and checked their lineage. Release/source checks, documentation
links and the 418-package license inventory passed. See
[the design decision](design/agent-contract.md). Final-commit CI and full-history
secret-scan status must be checked separately; no visibility change is included.
