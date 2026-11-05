# Bundled asset review

Reviewed November 5, 2026. Only files in the source repository are covered. Local uploads, runs, style reference libraries and screenshots are not licensed by the source MIT license and remain excluded from Git.

| Asset | Source and terms | Status |
| --- | --- | --- |
| Figtree normal/italic WOFF2 | Pinned upstream commit, SIL OFL; hashes and license in [font provenance](../public/fonts/figtree/README.md) | Notice and hashes verified |
| Provider SVG marks, including Pi | `@lobehub/icons-static-svg@1.101.0`, MIT; included LobeHub notice and modifications in [mark provenance](../public/harnesses/README.md) | Current Pi files use the verified package path; vendor names/trademarks remain theirs |
| Flow favicon | Project source SVG under the root MIT license | Part of source; owner confirms overall code/brand ownership at release |
| `public/assets/paper-seed.png` | Original source describes generated demo art; no generation/reference receipt was present in the audited Git source | **Owner clearance required for public release** |

Paper fixture: PNG, 1254 × 1254, SHA-256 `aac707eab11bd5d9748251372dbff8b201549edddfdbe88bfce33e4836f52551`. It is present in the first source commit. Removing it from the current tree alone does not remove it from public Git history. Existing local assets and historical run references were left intact during this review.

The glass preview now uses the bundled fixture and synthetic metadata; no private artwork URLs or provider statuses remain. That makes it reproducible, but does not resolve the fixture's pending clearance.

Before publishing, the owner should confirm the paper fixture's generation/reference rights, or approve replacement and an appropriate source/history publication plan. Apply the same review to the exact screenshots/video chosen for X. Do not copy entire local galleries, private prompts, file paths or account quotas into a launch screenshot. The repository currently ships no screenshot media.
