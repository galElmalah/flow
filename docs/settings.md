# Local settings

Open Settings from the sidebar, the workspace avatar, or Manage providers in the usage panel. Settings uses its own submenu and bookmarkable routes:

- `/settings/workspace`: parallel jobs for new browser-started runs, local data location, and full project folder paths.
- `/settings/providers`: one searchable list of harnesses and APIs. Open a provider to configure it or inspect usage; Add API reveals the compatible endpoint form. Old harnesses/connections links open this page.
- `/settings/local-models`: local model runtimes, weights and setup.
- `/settings/image-tools`: local SAM 2.1 runtime, checkpoint size/location, verification state, download progress, and setup/retry.

Browser parallelism is remembered in local storage. CLI/API run concurrency remains explicit. Provider credentials continue to use the existing private local connection store.

Projects show their registered local folder in full, with a copy action, both in project cards and the selected project's heading. A folder path identifies the registered project location; it does not imply the platform generated or owns that project's source code.

SAM uses the existing `GET /api/image-editors/status` and `POST /api/image-editors/setup` endpoints. Status includes `components.runtime`, `components.checkpoint`, and `components.verification`. During setup, `stage` reports runtime/dependencies/download/verification. `download` reports transferred bytes, the Content-Length total when supplied, and its percentage; unknown totals remain indeterminate. Interrupted partial downloads are shown as incomplete and can be retried. Setup verifies imports **and loads the checkpoint** before atomically writing its readiness receipt. That receipt records the configured model, pinned SAM revision, runtime modification time, and checkpoint size/modification time. Missing, changed, or unverified files cannot report ready. Earlier import-only receipts require one setup/verification pass; valid existing weights are reused. Opening settings never downloads models automatically.

The editor and Settings share `src/components/SamSetup.jsx`, including download progress,
setup stages, errors, and retry. With no model installed, the editor offers **Download &
set up SAM** above the image. The image remains viewable; whole-image regeneration and
edits using existing masks do not require SAM. A fresh image starts detecting regions
automatically once setup reports ready. Inherited regions are retained without another
SAM pass. Failed segmentation requires an explicit retry rather than looping. An open
editor also notices setup started from Settings or the CLI. Setup/detection status can
be recovered after a browser refresh. A server restart during setup reports incomplete
files and offers retry; completed installations remain ready.

Setup uses `uv` to provision Python 3.12, or a local `python3`/venv/pip installation if
uv is absent. SAM requires Python 3.10+ and the pinned PyTorch dependencies must support
the selected Python version. If neither runtime tool is available, setup shows an
actionable prerequisite error. No API key is needed. A failed checkpoint load is moved
aside as `.invalid` so retry can download fresh weights.

The page polls SAM status while mounted and preserves the selected submenu on refresh and browser history navigation. All existing editor, CLI, and MCP setup/status operations continue to use the same local model service.

For a fresh-install check, explicitly set up SAM, open a disposable image, and inspect
the detected masks. Restart Flow and confirm that the completed installation remains
ready. This check downloads weights and runs local segmentation.

## Codex connection

Open Codex in Providers and choose Local harness, ChatGPT OAuth or API key. Local
harness reuses the existing CLI login. OAuth uses Codex's official device-code flow;
the sign-in URL/code appear inline and can be cancelled. Enable device-code login in
ChatGPT security settings if required. Codex handles token refresh. API-key mode sends
the key to `codex login --with-api-key` over stdin and uses API billing.

Managed OAuth and API-key modes use separate private Codex homes under
`.flow/private/codex/`. They never replace the global CLI login. Keys are write-only;
public status contains only the mode, readiness and sign-in progress. Native image
generation still depends on the selected CLI/account capability; it never falls back
to another provider. Configure a compatible image API separately when needed.

See [official Codex authentication](https://learn.chatgpt.com/docs/auth) and
[agent operations](agents.md). Authentication fixtures verify isolation and protocols;
they do not establish a new account's model or image entitlement.

fal is also configured in Providers. Its one private key serves Seedance video,
Seedream images and FLUX. Search for either fal or a model name to find the setup.
[fal setup, models and agent commands](fal-and-seedance.md) documents the current catalog.

Ollama’s Providers row has its own installed-model chooser and **Use in agent** action.
The agent picker opens providers first, then models, with model-aware thinking at the
top. [Execution paths and thinking controls](provider-model-picker.md).
