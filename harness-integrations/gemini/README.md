# Gemini CLI

`index.mjs` owns provider `gemini-cli`, headless invocation and final JSON parsing.
Install Gemini CLI, configure enterprise Code Assist or API-key access, then reload providers.
`WEFT_GEMINI_BIN` overrides the executable.

Google moved personal free/AI Pro/Ultra coding access to Antigravity CLI on June 18,
2026. This adapter does not silently switch executables or authentication. Google’s
separate `gemini-api` CLI supports video generation with API credentials; this adapter
remains text-only. See [current research and quota limits](../../docs/harness-usage.md).

This adapter currently generates text only and rejects image references. `default`
uses local CLI model settings; an explicit model is passed as `--model`. The prompt
is passed on stdin, JSON output is parsed from `response`, and an `error` result fails
the job. Plan approval mode prevents write actions; it is not a guarantee that all
read tools are disabled.

Executable presence is checked locally. Sign-in and inference access are **unverified**
until an actual run; no hidden inference probe is performed. Gemini CLI is not required
to run the other integrations. Protocol reference:
[Gemini CLI headless mode](https://geminicli.com/docs/cli/headless/).

Preview callers use stream-json and collect assistant message content only. Nonstream
callers retain final JSON response parsing; reasoning/tool events never become previews.
