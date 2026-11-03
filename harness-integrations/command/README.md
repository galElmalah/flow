# Command harnesses

`index.mjs` executes a configured image command as a fixed argument array, without a
shell. See [../../docs/PROVIDERS.md](../../docs/PROVIDERS.md) for the versioned stdin
and `request.json` protocol, placeholders and environment variables.

Each job has an isolated working directory, references and requested output path.
The command handles its own authentication. Exit code zero without a fresh raster
image is a failure. Cancellation terminates the process group; timeouts are bounded.
Output originals and normalized PNG previews are saved through the registry.

The bundled `local-color` command is deterministic local image processing, not AI
inference. Its implementation remains a runnable extension example at
`examples/harnesses/local-color.mjs`. Custom providers are configured in private
`.weft/providers.json`; built-in IDs are reserved.
