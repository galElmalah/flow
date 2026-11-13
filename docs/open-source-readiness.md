# Prepare a public release

The repository remains private. Review [the November 5 multi-agent audit](public-release-review.md) and [the November 13 review](release-review-2026-11-13.md) before publishing. This checklist does not change visibility, post to X or publish packages.

## Verified preparation

- MIT source license, security policy, contributor/agent guides and third-party notices.
- Full-history Gitleaks has no findings; private data, keys, model weights and development screenshots remain excluded. Four selected README captures are included in `docs/images/`; see [asset provenance](asset-provenance.md).
- Canonical Flow CLI/client/configuration, flow.project.json, .flow.json workflows and tested local migration. Setup installs a safe user CLI launcher; local package exports expose the JavaScript SDK and 257-style catalog. Agent onboarding starts in [SETUP.md](../SETUP.md). See [installation](installation.md).
- Fixed private-file reference traversal and credential-bearing request metadata, with synthetic regressions.
- Explicit search-model download; cached weights work offline. Local-processing demo makes no implicit model download.
- Source-only clean-HOME install/build/serve, CLI/MCP, four local-processing outputs and idempotent/preserved user skills.
- All 399 tests pass locally on macOS Node 24; architecture/unused-code/build/source/link checks pass. Minimum Node 22.13.0 is included in final-commit CI. See [the second agent-interface review](agent-review-second-pass.md).
- CI configured for Linux Node 22.13.0/24 and macOS Node 24; check final Actions results.
- Zero npm audit vulnerabilities; dependency and optional-model inventory in [licenses](licenses.md).
- Portable shipped demo with synthetic metadata; the current Pi mark uses verified MIT-licensed source.

## Before visibility changes

- [ ] Owner clears paper fixture and historical Pi mark rights, and reviews historical demo workspace metadata, or chooses a reviewed source-snapshot/history publication plan. See [asset provenance](asset-provenance.md).
- [ ] Owner confirms code/license ownership and clears the exact X screenshots/video. Local galleries and account/path data are not public-source assets.
- [ ] Verify final release commit CI and secret scan.
- [ ] Verify private vulnerability reporting and enable main protection after public visibility or when the plan permits it. Private-repo checks currently return 404 and 403 respectively.
- [ ] Make the explicit source-repository visibility change. Keep npm private; no prebuilt binary/bundle or model distribution is included.

## Documented limitations

Inference depends on provider/account access; fake transports do not prove entitlement. SAM cold setup and broader model/hardware installs need separate trials. Windows support is not established. Flow binds to loopback for a trusted local OS account and has no multi-user authentication; do not expose it publicly.

Do not ship .flow data, credentials, consuming-project pointers, generated runs or downloaded weights. Preserve dependency/model terms in any later binary or weight distribution.
