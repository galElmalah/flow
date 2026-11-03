# Claude Code

`index.mjs` owns provider `claude-code`, invocation, image blocks, final-result parsing,
and the bounded `claude auth status --json` check. Set `FLOW_CLAUDE_BIN` to override
the executable. Authenticate with `claude auth login`.

This integration generates prompt text. It accepts reference images when the selected
model supports vision; each image must be below 5 MB. It sends a stream-JSON user
message and extracts the final result event, excluding progress. Safe mode, an empty
tool allowlist, empty strict MCP config and disabled session persistence keep the
prompt-writing process separate from project tools and customizations.

`default` uses the CLI's configured model; an explicit text model is passed as `--model`.
It does not generate image files. Image nodes use another image-capable provider.
The installed `claude --help` documents supported flags; protocol reference:
[Claude Code headless mode](https://code.claude.com/docs/en/headless).

Preview callers enable `--include-partial-messages`. Only text block deltas are
published; thinking/tool blocks are ignored. The final result remains authoritative.


`models.mjs` reads the native CLI initialization model catalog through the bounded,
read-only transport in `control.mjs`. It submits no user prompt. Labels, resolved
aliases and per-model thinking levels come from that CLI, rather than a hardcoded
list. The same catalog reaches prompt nodes, provider settings and the agent picker.
Concurrent requests share a 30-second cache. Older/unavailable CLIs retain their
configured default; account metadata is not published. The usage reader shares this
transport while retaining its status-line fallback.

See the official [SDK initialization and ModelInfo contract](https://code.claude.com/docs/en/agent-sdk/typescript)
and [Claude model configuration](https://code.claude.com/docs/en/model-config).
