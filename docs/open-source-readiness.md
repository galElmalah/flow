# Prepare a public release

The GitHub repository remains private. This checklist does not authorize changing its visibility or publishing packages.

Completed preparation:

- Full Git history scanned with checksum-verified Gitleaks; no credentials found. CI scans future pushes and pull requests.
- Canonical Flow names: `flow.project.json`, `*.flow.json`, `.flow/flow.sqlite`, `FLOW_*` and `FlowClient`. A tested upgrade preserves legacy workspace data and registered project pointers.
- Separate source repository with ignored workspace data, credentials, model weights and private development evidence.
- MIT source license, contributor instructions, security guidance and third-party notices.
- CI for behavior tests, architecture checks, production build and release-file checks.
- Synthetic graph fixtures instead of tests reading private project exports.
- Lockfile-backed installation and pinned direct dependency versions.
- Fresh source checkout verified on macOS: dependency installation, all 362 tests, production build, release checks, empty-workspace startup, project registration, Flow-file export/import, viewer URLs and four local-processing jobs. Managed skills were installed twice in an isolated user directory. No development data or provider account was required for the trial.

Before making the repository public:

- Confirm the MIT license choice and copyright ownership for contributed code.
- Review every bundled asset's origin and redistribution terms, including the Pi mark and generated paper reference. Include only approved screenshots in public documentation.
- Review dependency licenses and optional model licenses. A clean vulnerability audit does not establish license compatibility.
- Test setup on a clean macOS and Linux machine, including optional SAM cold start and cancellation. Windows support is not yet established.
- Verify each provider on a supported account and document limitations. Unit tests do not prove live inference access.
- Review the local server's threat model and credential handling before broader distribution.
- Replace private development evidence links with portable examples where needed.
- Enable private vulnerability reporting and configure branch protection on GitHub.
- Review the complete Git history for secrets before changing visibility. The local release check is a safeguard, not a full secret scanner.

Do not ship `.flow/`, provider credentials, consuming-project manifests, generated runs or downloaded model weights. Keep the npm package private until a package release is explicitly planned.
