# Pi

`index.mjs` owns provider `pi`, noninteractive invocation and plain-text final output.
Install Pi, configure its provider/model and sign in with `pi`, then reload providers.
`WEFT_PI_BIN` overrides the executable. `default` uses Pi's configured model; an
explicit model can use Pi's provider/model selector syntax.

Pi generates text and accepts reference-image attachments when the selected model
supports vision. The adapter disables tools, MCP, extensions, skills, prompt templates,
context-file loading and saved sessions. Prompts are passed on stdin; local references
are separate `@file` arguments. It does not generate image files through this adapter.

Executable presence is checked locally. Sign-in and inference access are **unverified**
until an actual run. BYOK HTTP endpoints use the direct platform client; they do not
require Pi or silently inherit Pi's selected provider. Flag contract:
[Pi CLI source](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/cli/args.ts).

Preview callers use JSON assistant text_delta events. Final message_end must report
stop; truncation, tool requests, errors and aborts fail rather than saving partial prompts.
