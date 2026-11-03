# Agent skill setup

`npm run setup` builds Flow and installs three bundled, user-wide skills:

| Skill | Purpose |
| --- | --- |
| `flow-workflows` | Discover/register local projects; create, fork, plan and run batches; compare providers; inspect lineage and open the viewer. |
| `flow-image-editing` | Check SAM setup, name/select regions, attach comments, prepare region/recolor/whole edits, dispatch and inspect image versions. |
| `flow-style-library` | Find styles, start workflows from references and maintain custom style/scene prompts and reference provenance. |

Installation is local to the current OS user. Codex, Gemini CLI and Pi discover the copies in `~/.agents/skills/`. Claude Code uses separate copies in `~/.claude/skills/`. No provider configuration, shell startup files or agent security settings are changed. Installed skills guide authorized platform work; installation does not start inference or grant model/tool permissions.

```sh
npm install
npm run setup

# Offline maintenance; no server or valid consuming-project manifest required:
node cli/flow.mjs skills status --json
node cli/flow.mjs skills install --json
node cli/flow.mjs skills install --target claude-code --json
```

`--target` accepts `all` (default), `codex`, `gemini`, `pi`, or `claude-code`. The first three share the interoperable directory, so installing for any of them makes the skills discoverable to all three. It does not install those harness executables. Plain `npm install` has no global-install hook; run setup to opt into the full local setup.

Each skill includes a Node launcher and a generated `.flow-install.json` receipt pointing to this installation's CLI. Commands work from other repositories without `npm link`, using the consuming working directory for project discovery. Use the script's absolute path, for example:

```sh
node "$HOME/.agents/skills/flow-workflows/scripts/flow.mjs" projects --json
```

The helper passes arguments directly to Node without a shell. The receipt contains installation paths and source-file hashes, never credentials. Skill sources live in this repository's `skills/`; installed copies are derived. Re-running setup leaves matching installations untouched, upgrades unchanged managed copies, and refreshes launchers after the checkout moves. Reinstall from the new checkout after moving it.

Existing foreign directories, symlinks and locally edited copies are reported as conflicts before installation starts. Keep your edits under a different skill name/path before reinstalling. Managed directory updates are staged; an interrupted replacement's backup is recovered on the next install. Skills remain available after Flow stops, but platform commands still need its local server.

Start a new Codex/Claude Code session after installation if discovery has not refreshed. Gemini supports `/skills reload`; Pi supports `/reload`. Custom skills can still be disabled or restricted by each harness's own policies. Only installed-file checks are available if a harness executable is absent.

Location and reload behavior follow the official [Codex skill documentation](https://learn.chatgpt.com/docs/build-skills), [Claude Code skills](https://code.claude.com/docs/en/skills), [Gemini CLI skills](https://geminicli.com/docs/cli/skills/), and [Pi skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md).
