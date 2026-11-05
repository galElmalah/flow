# Dependency and optional-model inventory

Flow's own source uses [MIT](../LICENSE). This inventory records upstream declarations; it does not relicense dependencies or model weights. Scope for the first public release is source-only: no npm package, packaged desktop binary, model archive or prebuilt `dist/` bundle.

Run `npm run check:licenses` after `npm ci`. For the complete machine-readable package/version/license inventory, use `node tools/license-inventory.mjs --json`. All 418 current lockfile package entries have declared metadata or reviewed license-file evidence. `busboy@1.6.0` and `streamsearch@1.1.0` omit license metadata in the lockfile; their installed `LICENSE` files contain Brian White's MIT terms. The tool checks those files instead of treating missing metadata as an unlicensed dependency.

## Distribution-sensitive dependencies

| Component | Declared license | Release treatment |
| --- | --- | --- |
| elkjs 0.12.1 | EPL-2.0 OR GPL-3.0-or-later | Flow uses the EPL-2.0 route. The layout engine is unmodified and separately imported. Before shipping a compiled bundle, preserve its notices/license and the required source-availability information; see [upstream license](https://github.com/kieler/elkjs/blob/master/LICENSE.md). |
| Sharp and platform libvips packages | Sharp: Apache-2.0; bundled native components include LGPL-3.0-or-later and other notices | Source setup obtains packages through npm with their licenses. A packaged native distribution needs its own included-library inventory and notices; see [Sharp](https://github.com/lovell/sharp/blob/main/LICENSE) and [libvips packaging](https://github.com/lovell/sharp-libvips/blob/main/LICENSE). |
| Lightning CSS | MPL-2.0 | Installed through Vite's build dependency tree. Review source/license delivery if shipping that tool or modified MPL-covered files. |
| Other packages | Primarily MIT, Apache-2.0, BSD, ISC and related declarations | Preserve each package's included license; use the generated inventory for exact package versions. |

No claim is made that Flow's MIT license covers these programs. The license inventory checks metadata coverage, not every possible redistribution obligation. Prebuilt distribution is a separate release task.

## Optional runtimes and weights

Weights are not tracked. Setup is explicit; ordinary setup does not fetch them. Search can use an already cached model offline; its Download search model action fetches the pinned embedding model.

| Component | Source declaration | Notes |
| --- | --- | --- |
| SAM 2.1 | [SAM 2 Apache-2.0 license](https://github.com/facebookresearch/sam2/blob/main/LICENSE) | Runtime code and model installation are separate from Flow source. SAM 3 is not automatically installed. |
| MiniLM search | [Xenova/all-MiniLM-L6-v2, Apache-2.0](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | Pinned revision in `server/search/model.mjs`; text embeddings execute locally after setup. |
| MOSS-Image SFT presets | [Comfy-Org/MOSS-Image model card, Apache-2.0](https://huggingface.co/Comfy-Org/MOSS-Image) | BF16/INT8 diffusion model, Qwen3.5 encoder and FLUX2 VAE downloads are separately pinned/hashes checked in `shared/local-model-presets.mjs`. The packaging model card lists their repository; review component origins before redistributing a combined weight archive. |
| SD 1.5 example | [Comfy-Org/stable-diffusion-1.5, CreativeML OpenRAIL-M](https://huggingface.co/Comfy-Org/stable-diffusion-1.5) | Use restrictions are separate from MIT. The example is not a claim of unrestricted model rights. |
| Ollama / ComfyUI models chosen by users | Varies per runtime, model and extension | Inspect the installed model card and extension terms. A local runtime does not make all model weights MIT or authorize redistribution. |

Checked November 5, 2026. User-uploaded/generated media and vendor subscriptions/API terms remain separate from dependency licensing. See [asset provenance](asset-provenance.md) for the unresolved bundled-image clearance.
