# Managed local runtimes

`RuntimeManager` owns process installation and lifecycle, separate from inference adapters.
It installs only below the platform data directory's `models/local/` folder, keeps
runtime configuration in `local-runtimes.json`, and persists each runtime's operation
in `task.json`. It never invokes sudo, pipes install scripts, changes global Python,
or kills an external service. Only loopback HTTP(S) endpoints are accepted.

- Ollama uses the official pinned 0.40.13 universal macOS or Linux x64/ARM64 archive,
  checks its published SHA-256, extracts it locally, checks the executable, and starts
  the owned service with `OLLAMA_NO_CLOUD=1`, its own model storage, and one parallel
  inference slot. Native `/api/pull` performs model installation. Reported percentage
  belongs to the current model layer; it is not total-model completion.
- ComfyUI checks out official source commit
  `6d352802d8f8b9133f664a1757d6c6d26390c335`, creates an isolated Python environment
  (uv/Python 3.12 when uv exists, otherwise Python 3.10–3.13), installs that source's
  requirements and verifies required imports. Git and uv or Python are prerequisites.
  The actual setup detects CUDA/MPS; CPU is the fallback when neither is available.
  Dependencies are installed from normal package indexes; device-specific ROCm/XPU
  configurations can instead use an externally managed ComfyUI service.
- ComfyUI weight download requires HTTPS, a safetensors filename and SHA-256. The
  artifact streams to a temporary file, reports actual bytes, and is atomically
  installed only after hash validation. Existing different files are never replaced.
  Source URL query parameters are omitted from persisted provenance.

Installation is not inference verification. `installed` means managed setup completed
and its runtime file receipts still match. `running` means the native endpoint responds.
`managed` means this manager owns the actual child process. External endpoint model
choices are separate from managed weight files; downloading into Flow's directory does
not configure a separately installed external ComfyUI server.

Setup, start and model pull return promptly with task state. Repeated actions while
one runtime task is active return that task rather than launching duplicates. Cancel
aborts its owned command/download; external model pulls might continue for other
clients. Startup converts unfinished saved tasks to `interrupted`, allowing explicit
retry. Verified complete files are reused. Setup archives and failed weight files
are removed; retries restart these downloads rather than claiming byte resume.

Read `status()` for saved stages and true byte progress. Dependency installs show
indeterminate stages rather than invented percentages. There is no automatic model
inference or arbitrary custom-node installation during setup.
