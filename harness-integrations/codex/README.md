# Codex

- `status.mjs`: executable selection (`WEFT_CODEX_BIN` or `codex`), version, ChatGPT
  sign-in (ChatGPT or API key) and native image-generation feature check.
- `text.mjs` / `text-stream.mjs`: `codex-text` prompt generation through a bounded
  app-server process and one ephemeral read-only thread. Shell/image tools, inherited
  MCP servers, apps and plugins are disabled. Reference images use localImage input.
  Genuine final-answer deltas feed optional previews; only successful turn completion
  resolves the final string. Credentials and raw protocol events stay in the adapter.
- `image.mjs`: `codex` native image generation through a separate ephemeral process
  per job. The job directory is the writable workspace. Requires the signed-in CLI's
  image-generation feature. It must save a real raster result or the job fails.

Text model `default` uses CLI settings; a text node can specify another CLI model.
The native image provider exposes `native`. Numeric image seeds are variation labels,
not deterministic model RNG seeds. Aspect ratio and quality are requests; inspect
actual returned dimensions. Native image originals are preserved by the registry.

Settings → Providers → Codex selects the existing local harness, isolated ChatGPT
OAuth, or API-key authentication. `connection.mjs` owns private credential homes and
CLI sign-in lifecycle. The selected environment reaches text/image jobs, model-cache
reads and usage reads. Keys travel through stdin, never process arguments; status
never returns keys/tokens. API mode reports API billing rather than subscription quotas.
Direct endpoint BYOK uses the separate [OpenAI-compatible adapter](../openai-compatible/README.md). The installed CLI's
`codex exec --help` and `codex features list` define the image executable contract.
Text needs the current [app-server protocol](https://learn.chatgpt.com/docs/app-server).
