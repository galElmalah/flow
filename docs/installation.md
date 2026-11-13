# Install Flow's CLI and SDK

Flow is source software for Node.js 22.13+ on macOS and Linux. Its executable is a
Node launcher, not a bundled native app. No account, inference or model download
is needed for installation or the local-processing demo.

## Clone and set up

```sh
git clone https://github.com/galElmalah/flow.git
cd flow
npm ci
npm run setup
npm run verify:setup
```

Setup builds the UI, links `~/.local/bin/flow` to this checkout's executable
`cli/flow.mjs`, and installs managed agent skills. It preserves an existing foreign
command instead of overwriting it. No administrator permissions or shell startup
changes are requested. If setup reports a conflict, choose a different directory
or remove the old installation yourself.

If needed, add the default command directory to PATH:

```sh
export PATH="$HOME/.local/bin:$PATH"
flow --version
flow serve
flow open --projects
```

Keep the PATH line in your shell configuration if you want it in future sessions.
The absolute command `~/.local/bin/flow` also works without a PATH change. Commands
from other projects discover their `flow.project.json`. Help and version checks
work offline, even if that project's manifest needs repair.

## Choose an installation or remove the launcher

```sh
npm run cli:install
FLOW_BIN_DIR="$HOME/bin" npm run cli:install
npm run cli:uninstall
```

Use the same `FLOW_BIN_DIR` to remove a custom launcher. Removal affects only this
checkout's symlink, leaving the database, files, skills and foreign commands intact.
The setup command is repeatable. Keep the checkout in place: its source and
`node_modules` are the installed program. To switch versions, stop that server,
remove the old managed launcher, check out the desired revision, run `npm ci` and
`npm run setup`, then restart. Do not share a data directory between concurrently
running versions. Back it up before migrations.

If you prefer npm's global command directory, the existing package `bin` entry also
supports `npm link --ignore-scripts` after building. Check for an existing `flow`
command before linking. No registry package is published by this command.

## JavaScript SDK

In a consuming Node.js project:

```sh
npm install --save /absolute/path/to/flow
```

```js
import { FlowClient, createImageWorkflow, toFlowFile } from "flow";
import { builtInStyles } from "flow/styles";

const client = new FlowClient({ url: "http://localhost:4310" });
console.log(await client.projects(), builtInStyles.length);
```

The root export and `flow/client` provide the HTTP SDK, graph builders and Flow
file helpers. `flow/styles` provides the built-in briefs without a running server.
Start `flow serve` for HTTP operations. A global CLI install does not add a package
to another project's module resolution: install the SDK in that consuming project.
No browser bundle, provider keys, account session or model weights are part of these
imports. Plan before running; see [the agent guide](agents.md).

## Agent hosts

Read [AGENTS.md](../AGENTS.md), [managed skills](agent-skills.md) and [MCP](mcp.md).
CLI, SDK and MCP use the same local services. Keep returned IDs, inspect durable
status and report output lineage. Setup never grants model permissions, chooses a
paid provider, or starts generation. User data remains in ignored `.flow/`.

Flow code and style briefs are MIT licensed. Retain its license and copyright
notice when redistributing. [Third-party terms](../THIRD_PARTY_NOTICES.md), model
licenses and provider charges remain separate.
