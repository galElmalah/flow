# Examples

Every file here is tracked, portable source. None contains credentials, local
gallery images or generated outputs. Run commands from the Flow checkout after
[setup](../SETUP.md). Plan before running; a plan never starts inference.

## Workflow files

These use the versioned [Flow file format](../docs/flow-files.md).

| File                                                                 | What it shows                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [local-color-batch.flow.json](local-color-batch.flow.json)           | 100 Local color lab studies from one bundled reference; no AI provider needed     |
| [layered-color-studies.flow.json](layered-color-studies.flow.json)   | Two stages: three local color studies feed three duotone finishing jobs           |
| [mixed-providers.flow.json](mixed-providers.flow.json)               | One prompt and reference split into a Codex branch and a local branch             |
| [paper-studies.flow.json](paper-studies.flow.json)                   | A seed image, shared prompt and variations feeding one generation node            |
| [mascot-loop.flow.json](mascot-loop.flow.json)                       | A looping GIF generated through Codex; see [image formats](../docs/image-outputs.md) |

Import a file into a registered project, then plan it:

```sh
node cli/flow.mjs import --from examples/local-color-batch.flow.json --project PROJECT_ID --json
node cli/flow.mjs plan --workflow WORKFLOW_ID --project PROJECT_ID --json
```

[Provider setup](../docs/PROVIDERS.md#cli-routing) explains running
the local examples. Use `--count 1` to reduce a batch before running it.

## Providers and local models

- [providers.example.json](providers.example.json): a file-based command harness
  and an OpenAI-compatible image API. Keys come from environment variables. See
  [provider setup](../docs/PROVIDERS.md).
- [harnesses/local-color.mjs](harnesses/local-color.mjs) and
  [harnesses/recolor.mjs](harnesses/recolor.mjs): command providers that process
  images locally. They are not AI models.
- [comparison-modes.json](comparison-modes.json): named provider/model modes for
  one generation node. See [provider comparison](../docs/grok-and-lineage.md).
- [local-models/](local-models/sd15-recipe.json): ComfyUI weight and recipe
  descriptors used by [local models](../docs/local-models.md). Applying them
  downloads weights only when you run the documented command.

## Code

- [quoture/shared-workflow.mjs](quoture/shared-workflow.mjs) builds one shared
  source and art direction feeding several record branches. See
  [record branches](quoture/README.md).
- The public landing page's SALT / SPEED example, a four-scene `.flow.json` and
  an SDK `build.mjs`, lives in
  [website/landing/site/examples](../website/landing/site/examples/build.mjs).
  `npm run landing:verify` checks it against this checkout without inference.

For the JavaScript client and MCP tools, read [agent workflows](../docs/agents.md)
and [MCP setup](../docs/mcp.md).
