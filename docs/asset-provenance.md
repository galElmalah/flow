# Bundled asset review

Reviewed November 13, 2026. Only files in the source repository are covered. Local uploads, runs, style reference libraries and unselected screenshots remain excluded from Git. The README and private release explainer include the four selected product captures listed below; the source MIT license does not grant rights to third-party marks or depicted content.

| Asset | Source and terms | Status |
| --- | --- | --- |
| Figtree normal/italic WOFF2 | Pinned upstream commit, SIL OFL; hashes and license in [font provenance](../public/fonts/figtree/README.md) | Notice and hashes verified |
| Provider SVG marks, including Pi | `@lobehub/icons-static-svg@1.101.0`, MIT; included LobeHub notice and modifications in [mark provenance](../public/harnesses/README.md) | The current Pi mark uses the verified package path; vendor names/trademarks remain theirs |
| Flow favicon | Project source SVG under the root MIT license | Part of source; owner confirms overall code/brand ownership at release |
| `public/assets/paper-seed.png` | Original source describes generated demo art; no generation/reference receipt was present in the audited Git source | **Owner clearance required for public release** |
| `docs/images/helmet-campaign.jpg`, `helmet-seed-workflow.jpg`, `region-comment.jpg`, `pink-jersey-result.jpg` | Existing native Flow captures from November 3, 2026. The owner requested these helmet campaign and sports editing captures for the README. Campaign artwork was generated through Flow's Codex adapter; the pink result uses local recoloring. | Visually reviewed for credentials, account quotas and machine-specific paths. Original JPEG bytes retained; no local project data, prompts beyond the visible campaign brief, or model weights bundled. |

Paper fixture: PNG, 1254 × 1254, SHA-256 `aac707eab11bd5d9748251372dbff8b201549edddfdbe88bfce33e4836f52551`. It is present in the first source commit. Removing it from the current tree alone does not remove it from public Git history. Existing local assets and historical run references were left intact during this review.

The glass preview now uses the bundled fixture and synthetic metadata; no private artwork URLs or provider statuses remain. That makes it reproducible, but does not resolve the fixture's pending clearance.

Before publishing, the owner should confirm the paper fixture's generation/reference rights, or approve replacement and an appropriate source/history publication plan. Apply the same review to any additional screenshots/video chosen for X. Do not copy entire local galleries, private prompts, file paths or account quotas into a launch screenshot. Only the four selected README captures ship in `docs/images/`; development screenshot directories remain ignored.

## Historical files and the release explainer

The original `ae96ccb` revision also contains a Pi mark attributed to `pi.dev`
without established redistribution terms, plus local `/files/` URLs and workflow
IDs in the old glass demo. The current mark has been replaced by the verified
Lobe Icons source and the demo metadata was removed. Those earlier bytes remain
in Git history. A current-tree check does not clear them for public history.

The four current JPEGs contain no detected EXIF, IPTC, XMP or comment metadata.
That is a privacy check, not an image-rights determination. The owner requested
their inclusion in the private report; public redistribution of depicted artwork
and its seed/reference materials remains a separate release decision.

The [release explainer](launch/index.html) includes the four captures, the complete
MIT style-brief catalog and a tracked-asset inventory with byte sizes, SHA-256
hashes and terms. Rebuild with `node tools/build-explainer.mjs`. It reads only
tracked visual files and source style definitions. It never reads `.flow/`, user
uploads or run history. The 41 added styles have prompts and scenes; no new preview
images have been generated or represented as completed outputs.
