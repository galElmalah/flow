# Contribute to Flow

Use Node.js 22.13 or newer. CI checks the minimum 22.13.0 and current 24 on Linux, plus Node.js 24 on macOS.

```sh
git clone https://github.com/galElmalah/flow.git
cd flow
npm ci
npm run build
npm run dev
```

Open http://localhost:4310. No provider account is needed to browse the canvas or run the bundled Local color lab. Configure providers in **Settings → Providers** when you need inference. Subscription access and API billing are separate.

`npm run setup` also installs Flow's agent skills in your user account. Use it when you want those integrations. Neither `npm ci` nor a build installs global skills or downloads model weights.

## Make a change

Read [AGENTS.md](AGENTS.md) for source navigation and [the architecture map](docs/ARCHITECTURE.md) for module boundaries. Use a separate branch and keep pull requests focused on one behavior.

Use the client, CLI or HTTP API for durable workspace changes. Do not edit SQLite or its JSON mirrors directly. New commands and UI actions should use the same service contract so agents and people have the same capabilities.

Add a behavior test when a change affects scheduling, persistence, provider requests or data validation. Provider tests use local fixtures and fake transports. Tests must not depend on your account, credentials, private images or network inference.

Before opening a pull request, run:

```sh
npm run check
npm run check:release
```

For UI changes, also exercise the feature in the browser. Describe what changed, how you verified it, and any remaining limitation. Never include credentials, workspace databases, local run exports or images without redistribution rights.

## Report a problem

Use [GitHub issues](https://github.com/galElmalah/flow/issues) for bugs and feature requests. Include reproduction steps, operating system, Node.js version and provider name. Remove keys, prompts, local paths and account details from logs before attaching them.

For vulnerabilities, follow [SECURITY.md](SECURITY.md).
