import * as codex from "./codex/text.mjs";
import * as claude from "./claude-code/index.mjs";
import * as gemini from "./gemini/index.mjs";
import * as pi from "./pi/index.mjs";
import { runTextHarness } from "./shared/text.mjs";
import { executableExists } from "./shared/process.mjs";

const adapters = new Map(
  [codex, claude, gemini, pi].map((adapter) => [adapter.provider.id, adapter]),
);

export const harnesses = [...adapters.values()].map(({ provider }) => ({
  ...provider,
  kind: "harness",
  models: ["default"],
  capabilities: ["text"],
  timeoutMs: 600000,
}));

function adapterFor(id) {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Unknown text harness: ${id}`);
  return adapter;
}

export function harnessInvocation(provider, context, imageBlocks) {
  return adapterFor(provider.id).invocation(context, imageBlocks);
}

export function parseHarnessText(id, stdout) {
  const adapter = adapterFor(id);
  if (!adapter.parse)
    throw new Error(`${adapter.provider.name} uses the app-server text protocol.`);
  return adapter.parse(stdout);
}

export function runHarness(provider, context) {
  const adapter = adapterFor(provider.id);
  if (adapter.run) return adapter.run(provider, context);
  return runTextHarness(provider, context, {
    invocation: adapter.imageInvocation || adapter.invocation,
    parse: adapter.parse,
    stream: adapter.stream,
  });
}

export async function harnessStatus(provider, context = {}) {
  const adapter = adapterFor(provider.id);
  const installed = await executableExists(provider.executable);
  if (!installed)
    return {
      ready: false,
      installed: false,
      authenticated: false,
      status: provider.setup,
    };
  return {
    installed: true,
    ...(adapter.status
      ? await adapter.status(provider, context)
      : {
          ready: true,
          authenticated: null,
          status: "CLI installed · sign-in not verified",
        }),
  };
}
