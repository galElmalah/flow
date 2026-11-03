# Harness integrations

Start with [registry.mjs](registry.mjs): `ProviderRegistry` loads configured providers,
publishes the public catalog, checks job capabilities and dispatches execution.
The queue calls `preflight(jobs)` and `run(context)` without knowing individual protocols.
Provider IDs are persisted in workflow nodes and run snapshots; keep them stable.

Account quotas are a separate, read-only path: [usage.mjs](usage.mjs) caches each
engine's `usage.mjs` adapter. See [usage and Gemini video research](../docs/harness-usage.md)
for supported quota sources, Claude's status-line bridge and video capability limits.

| Integration                                             | Provider IDs                      | Output       | Authentication / setup                                |
| ------------------------------------------------------- | --------------------------------- | ------------ | ----------------------------------------------------- |
| [Codex](codex/README.md)                                | `codex`, `codex-text`             | Images, text | Local Codex harness, isolated ChatGPT OAuth, or API key                    |
| [Claude Code](claude-code/README.md)                    | `claude-code`                     | Text         | Existing Claude Code sign-in                          |
| [Gemini CLI](gemini/README.md)                          | `gemini-cli`                      | Text         | Local Gemini CLI configuration; sign-in unverified    |
| [Gemini video API](gemini-video/README.md) | `gemini-video` | Video | Private API key or Google ADC OAuth + quota project |
| [fal / ByteDance](fal/README.md) | `fal-image`, `fal-video` | Images, video | Private fal API key / FAL_KEY; API billing |
| [Grok Imagine](grok/README.md) | `grok-image`, `grok-video` | Images, video | Private xAI API key; subscription/API billing separate |
| [Ollama](ollama/README.md) | `ollama` | Text, vision input | Downloaded local model; managed setup, no key |
| [ComfyUI](comfyui/README.md) | `comfyui-image`, `comfyui-video` | Images, video | Local API workflow profiles and weights |
| [Pi](pi/README.md)                                      | `pi`                              | Text         | Local Pi configuration; sign-in unverified            |
| [OpenAI compatible / BYOK](openai-compatible/README.md) | `api-*`, configured image API IDs | Text, images | Private key or endpoint-provided local authentication |
| [Command](command/README.md)                            | `local-color`, custom IDs         | Images, video | The configured command handles authentication         |

Each engine owns its invocation, parser and engine-specific status check. `harnesses.mjs`
is the explicit text adapter map. Unknown IDs fail; there is no fallback to another engine.
`shared/process.mjs` handles bounded subprocesses and cancellation; `shared/image.mjs`
validates raster signatures before registry image decoding and normalization. All native
image originals are retained alongside normalized previews.

`ready` means a run can be attempted with the local configuration. `authenticated: null`
means sign-in has not been checked. Installing a CLI or listing API models does not prove
that a particular model can generate the requested content. The catalog exposes these
states separately; no preflight performs paid inference.

To add an integration, add its adapter here, reserve its ID before loading custom
providers, declare text/image/video and reference-image capabilities, and cover its wire
protocol with a local fixture. Reuse the queue and registry rather than introducing a
second execution path. Run `node --test test/harness-integrations.test.mjs
test/providers.test.mjs test/prompt-providers.test.mjs` from the repository root.

Project association and local project policy belong to the platform's project records,
not to individual engine adapters. Agents should create and run workflows through the
platform CLI/API described in [../AGENTS.md](../AGENTS.md).
