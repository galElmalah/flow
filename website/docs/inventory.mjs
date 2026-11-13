// The public documentation inventory: which repository Markdown is published,
// how it is grouped in the navigation, and where each page lives in the bundle.
export const docsUrl = "https://gal.overto.work/flow-landing/docs/";
export const landingUrl = "https://gal.overto.work/flow-landing/flow/";
export const repository = "https://github.com/galElmalah/flow";

const adapters = [
  ["claude-code", "Claude Code"],
  ["codex", "Codex"],
  ["comfyui", "ComfyUI"],
  ["command", "Command harnesses"],
  ["fal", "fal"],
  ["gemini", "Gemini CLI"],
  ["gemini-video", "Gemini video"],
  ["grok", "Grok Imagine"],
  ["local-runtime", "Local runtimes"],
  ["ollama", "Ollama"],
  ["openai-compatible", "OpenAI-compatible"],
  ["pi", "Pi"],
].map(([name, title]) => ({
  source: `harness-integrations/${name}/README.md`,
  title,
  summary: `${title} provider adapter notes`,
}));

const page = (source, title, summary, children) => ({
  source,
  title,
  summary,
  ...(children ? { children } : {}),
});

/** Navigation groups. Only these files are rendered. */
export const groups = [
  {
    title: "Start",
    summary: "Install Flow, verify a clean workspace and run the local demo.",
    pages: [
      page("README.md", "Overview", "What Flow does, where it runs and how data stays local"),
      page("SETUP.md", "Set up Flow", "Fresh clone, isolated verification and the local demo"),
      page("docs/installation.md", "CLI and SDK installation", "The flow launcher, PATH, SDK imports and removal"),
      page("docs/settings.md", "Local settings", "Providers, models and workspace preferences"),
    ],
  },
  {
    title: "Agents, CLI, SDK and MCP",
    summary: "Drive the same local services from agents, scripts and MCP hosts.",
    pages: [
      page("AGENTS.md", "AGENTS.md", "The agent entrypoint and repository contracts"),
      page("docs/agents.md", "Agent workflows", "Project discovery, graph edits, planning and runs"),
      page("docs/mcp.md", "MCP setup", "Host configuration and discoverable tools"),
      page("docs/agent-skills.md", "Agent skills", "Managed skills installed by setup"),
      page("docs/inline-agent.md", "Inline agent", "The page-aware agent inside the canvas"),
      page("docs/provider-model-picker.md", "Agent providers and models", "Choosing the inline agent's provider, model and thinking"),
    ],
  },
  {
    title: "Providers and models",
    summary: "Connect CLI harnesses, image APIs and local models explicitly.",
    pages: [
      page("docs/PROVIDERS.md", "Provider setup", "CLI harnesses, image APIs and CLI routing"),
      page("docs/local-models.md", "Local models", "ComfyUI, SAM and explicit model downloads"),
      page("docs/fal-and-seedance.md", "fal and Seedance", "fal image and video models"),
      page("docs/video-workflows.md", "Video workflows", "Video generation through the Gemini API"),
      page("docs/harness-usage.md", "Harness usage", "Subscription usage and Gemini video"),
      page("harness-integrations/README.md", "Provider adapters", "How adapters are registered and dispatched", adapters),
    ],
  },
  {
    title: "Workflows and images",
    summary: "Workflow files, scenes, styles, image versions and lineage.",
    pages: [
      page("examples/README.md", "Examples", "Workflow files, provider configuration and SDK code"),
      page("docs/flow-files.md", "Flow files", "The .flow.json format and upgrades"),
      page("docs/prompt-sets.md", "Prompt Sets", "Named scenes with per-scene overrides"),
      page("docs/styles.md", "Styles", "The built-in style catalog"),
      page("docs/grok-and-lineage.md", "Provider comparison and lineage", "Several modes on the same inputs"),
      page("docs/image-outputs.md", "Image formats", "GIF, SVG and output options"),
      page("docs/image-versions.md", "Image versions", "Regions, comments and edits"),
      page("docs/image-region-names.md", "Region names", "Naming SAM masks with a vision harness"),
      page("docs/canvas-organization.md", "Organize the canvas", "Layout and section frames"),
      page("docs/observability.md", "OpenTelemetry", "Tracing and latency"),
      page("examples/quoture/README.md", "Record branches", "One shared direction feeding several branches"),
    ],
  },
  {
    title: "Project",
    summary: "Architecture, contribution rules, security and licenses.",
    pages: [
      page("docs/ARCHITECTURE.md", "Architecture", "Subsystem boundaries and source map"),
      page("CONTRIBUTING.md", "Contributing", "Checks and contribution rules"),
      page("SECURITY.md", "Security", "Reporting vulnerabilities and the local trust model"),
      page("docs/licenses.md", "Dependency licenses", "Dependency and optional-model inventory"),
      page("THIRD_PARTY_NOTICES.md", "Third-party notices", "Fonts, marks and other notices"),
      page("LICENSE", "MIT license", "Flow source license"),
    ],
  },
];

/** Every published page in reading order (previous/next follow this order). */
export const orderedPages = groups.flatMap((group) =>
  group.pages.flatMap((entry) =>
    [entry, ...(entry.children || [])].map((item) => ({
      ...item,
      group: group.title,
    })),
  ),
);

export const publicDocumentSources = orderedPages.map((entry) => entry.source);

/**
 * Bundle path for a source. Root guides keep their names; docs/*.md move under
 * guide/ so AGENTS.html and guide/agents.html never collide on case-insensitive
 * file systems. Nested READMEs keep their folders.
 */
export const pagePath = (source) => {
  const name = source.replace(/\.md$/i, "");
  return `${name.startsWith("docs/") ? `guide/${name.slice(5)}` : name}.html`;
};
