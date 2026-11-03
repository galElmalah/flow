# Harness account usage and Gemini video

Hover or focus **Harnesses · subscription usage** in the bottom-left rail. Click to
keep the panel open. Tab or Arrow Down enters its controls; Escape closes it.
Percentages mean **used**, with separate quota windows and reset times. Codex Image
and Codex text share one account. The panel, provider picker, node library and provider
settings use the same report. Missing reports show Unavailable or an em dash; they do
not imply zero usage. A tilde marks an old report or failed refresh.
Expand **Limits & reset times** for reset dates and report timestamps, or
**Why unavailable** for the reason a harness has no percentage.

Opening the panel reads account metadata without inference. Server requests share
in-flight reads and a 60-second cache; explicit refresh has a 10-second minimum.
While open, the panel checks once a minute. No quota polling runs while it is closed.
Each account's `checkedAt` records the local read; Claude's separate `reportedAt`
preserves when Claude produced the snapshot.

```sh
node cli/flow.mjs providers usage --json
```

Agents can call `FlowClient.harnessUsage({ refresh: true })`, MCP
`read_harness_usage`, or `GET /api/providers/usage?refresh=1`. The endpoint returns
allowlisted account names, sources, status, windows, timestamps and setup instructions.
It never returns credentials, account IDs or raw protocol errors. Usage remains
workspace-wide even for a project-bound agent; it is not project token accounting.

## Which harnesses expose quotas

| Harness | Source | Local behavior |
| --- | --- | --- |
| Codex | Official app-server `account/rateLimits/read` | Live CLI account quota; preserves every bucket/window and legitimate 0%. |
| Claude Code | CLI's SDK `get_usage` control; status-line fallback | Live account percentages on supported versions; optional fresh snapshots for older versions. |
| Gemini CLI | Interactive `/stats model` | No supported headless quota export; unavailable here. |
| Pi | Selected upstream provider | Session tokens/cost cannot establish subscription percentage. |
| OpenAI-compatible BYOK | Provider-specific account dashboard | The compatible protocol has no standard subscription quota endpoint. |

Codex starts a bounded stdio app-server, initializes, reads limits, then stops. It
does not start a conversation or inspect credential files. All reported limit buckets
stay distinct; the compact badge uses the first returned window, whose label appears
in its tooltip and the expanded report. See [OpenAI's quota protocol](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt).

## Claude live usage and optional status-line fallback

The current installed Claude CLI supports the SDK's experimental `get_usage`
control. Flow launches it in an isolated temporary directory with safe mode, no tools,
an empty strict MCP configuration and no session persistence. It sends only
`initialize` and `get_usage` with `skip_behaviors: true`: no user or model prompt.
The process has a ten-second timeout and a one-megabyte output bound. This path
successfully read 5-hour and weekly limits from the local subscription.

Its `utilization` fields are already percentages (0–100); do not confuse them with
the fractional units in passive `rate_limit_event` messages. Idle 0% windows may
have no reset time. Account identity and unrelated SDK response fields are discarded.
The experimental control schema is published in the official
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
types (`SDKControlGetUsageRequest` / `SDKControlGetUsageResponse`). The adapter
validates responses and falls back when the installed CLI does not support it.

For that fallback:

Expand **Connect Claude usage** in the panel and copy its generated configuration.
Merge that `statusLine` field into Claude Code's settings. The command runs
`harness-integrations/claude-code/usage-statusline.mjs` with this installation's Node
and repository paths. It displays model and quota information in Claude and writes
only `five_hour`/`seven_day` percentages, reset epochs and a capture timestamp.
The platform does not replace your existing Claude settings.

If you already have a status-line script, preserve its normal output and pass the
same stdin JSON to this bridge with `--usage-only`. The bridge reads stdin once;
your wrapper must buffer that JSON before passing it to both scripts. Never save the
complete status-line payload: it can contain transcript paths and other session data.

Snapshots default to `$XDG_CACHE_HOME/flow/claude-usage.json` or
`~/.cache/flow/claude-usage.json`. `FLOW_CLAUDE_USAGE_FILE` overrides the path; set it
in both Claude and Flow's environment. Files are atomically replaced with mode 0600.
Reports older than ten minutes and expired reset windows are rejected. Claude emits
these status-line fields after an API response; refreshing Flow cannot create a new
status-line snapshot. The live control read does not require this setup.
See [Claude's documented status-line quota fields](https://code.claude.com/docs/en/statusline).

## Gemini video research

Verified against current official sources on October 30, 2026:

Google's separate experimental **Gemini API CLI** can generate and edit videos:

```sh
gemini-api video "A slow camera move through a sunlit workshop" --out ./assets/
```

It requires API credentials and is separate from the existing `gemini` coding harness.
The current CLI lists `gemini-omni-1.1-flash` for video. `analyze` handles understanding
existing video. [Official CLI and command overview](https://github.com/google-gemini/gemini-api-cli).

Google's video guide states that Veo 3.1 Preview shut down October 22, 2026 and points
to Gemini Omni Flash or enterprise GA alternatives. Avoid obsolete preview model IDs.
[Current video guide](https://ai.google.dev/gemini-api/docs/video).

Free individual and Google AI Pro/Ultra coding access moved to Antigravity CLI on
June 18, 2026; enterprise Code Assist and paid API access remain in Gemini CLI.
This does not establish video generation entitlement through a coding subscription.
[Google's dated transition announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/).
API calls use the API project's own billing, limits and credentials.
[Gemini API billing](https://ai.google.dev/gemini-api/docs/billing).

Gemini CLI's `/stats model` is interactive. Do not run it as a headless prompt to poll
quotas: it is not a documented machine quota interface and may fall through to a model
request. The internal `retrieveUserQuota` API is not used as an undocumented auth bridge.
[Official CLI commands](https://geminicli.com/docs/reference/commands/#stats).

No `gemini`, `gemini-api` or Antigravity executable was found locally during the
October 30 verification. On November 1, Google's official `gemini-api` v0.4.5 was
installed privately at `.flow/tools/bin/gemini-api`. Its video dry run passed, but
an actual request returned HTTP 403 because neither an API key nor an access token
was configured. No video was generated or authenticated Pro entitlement tested.
See [the live CLI validation](qa/gemini-video/README.md) for evidence and the next step.
Flow now exposes native `video-generate` and `video-output` nodes through the same queue, gallery, CLI and MCP. The Gemini video connection uses public API-key or ADC OAuth credentials; it does not read coding CLI OAuth tokens. See [video workflows](video-workflows.md) for setup, durable operation receipts and playback. Local fixture verification proves the integration; authenticated Google generation remains unverified until credentials are configured.

## Code ownership

`harness-integrations/usage.mjs` owns caching and the public response. Each engine's
`usage.mjs` owns account reporting. `src/harnesses/` owns the hover panel and badges;
`shared/harness-usage.mjs` owns the stale indicator policy. Routes call the usage
service; CLI and MCP call the supported client.
