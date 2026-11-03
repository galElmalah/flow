# Agent providers, models and thinking

The agent picker opens on providers. Click a provider to advance to its searchable
models in the same compact panel. Back returns to providers. Thinking stays at the
top and uses controls supported by the current model/integration. Auto retains the
provider/model default. Model and thinking selections survive browser refreshes.
Transitions respect reduced-motion preferences; providers and models support keyboard
navigation, search and Escape. The dial also supports keyboard adjustment.

Ollama uses its actual llama mark. Settings → Providers → Ollama lists downloaded
completion/vision models; **Use in agent** chooses the model and opens the agent.
The download link opens Local models. This selects a model for the agent, not a
global runtime default or another workflow’s saved model.

## Actual execution paths

| Provider | Execution | Thinking control |
| --- | --- | --- |
| Codex | Codex CLI app-server text protocol, with selected harness/OAuth/API auth | `turn/start.effort`; supported levels from the CLI model cache where available |
| Claude Code | Its own CLI in print/stream-JSON mode | Session-only `--effort`; low/medium/high supported by our adapter |
| Gemini CLI | Its own CLI in headless JSON/stream-JSON mode | Provider default; no unverified override |
| Pi | Pi CLI in print/JSON mode | `--thinking`; Pi clamps it to the configured model’s supported levels |
| Ollama | Native loopback `/api/chat` HTTP streaming | Exact `/api/show` thinking values: booleans or named levels |
| BYOK text | Direct OpenAI-compatible `/chat/completions` HTTP | Provider default unless a supported mapping is implemented |

Pi is a separate optional harness, not the provider SDK used by every other adapter.
Selecting Pi lets Pi choose its configured provider/model credentials and apply its
own thinking mapping. We do not silently route Codex, Claude, Ollama or BYOK via Pi.
Pi is not installed on the current machine; its invocation is verified by fixtures
and upstream docs, not a live Pi account call.

`shared/reasoning.mjs` owns accepted choices and model capability mapping. The same
`reasoningEffort` field travels through the agent API, client, CLI and MCP, persists
on the turn, and reaches the chosen adapter. Unsupported explicit levels fail during
provider preflight instead of being silently ignored. Generic APIs and Gemini CLI
show a disabled dial with Auto until an override is verified.

For Ollama, Auto omits `think`, Off sends `false`, On sends `true`; named levels are
sent verbatim only when advertised by the selected model. The current qwen3:0.6b
reports `[false,true]`, so the UI exposes Off/On rather than inventing a Low/High scale.
Prompt-writing jobs that omit `reasoningEffort` retain the previous `think:false`
behavior. Reasoning traces are kept out of answer text; progress reports thinking
activity without printing those traces.

## Primary references

Checked 2026-11-01:

- [Ollama thinking metadata and request field](https://docs.ollama.com/capabilities/thinking)
- [Pi CLI model and thinking flags](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/cli.md)
- [Pi model capability handling](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)
- [Claude Code effort control](https://code.claude.com/docs/en/model-config#adjust-effort-level)

Local ownership: `harness-integrations/registry.mjs`, `codex/text-stream.mjs`,
`claude-code/index.mjs`, `gemini/index.mjs`, `pi/index.mjs`, `ollama/index.mjs`,
`openai-compatible/text.mjs`. Model UI lives in `src/agent/HarnessModelPicker.jsx`;
reusable drilldown navigation lives in `src/components/Autocomplete.jsx`.
