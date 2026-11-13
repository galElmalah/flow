// Layout and page inventory for the public documentation site. The renderer,
// sanitizer and link resolver are shared with the release explainer.
export const docsUrl = "https://gal.overto.work/flow-landing/docs/";
const landingUrl ="https://gal.overto.work/flow-landing/flow/";
const repository = "https://github.com/galElmalah/flow";

const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

const providerAdapters = [
  "claude-code",
  "codex",
  "comfyui",
  "command",
  "fal",
  "gemini",
  "gemini-video",
  "grok",
  "local-runtime",
  "ollama",
  "openai-compatible",
  "pi",
].map((name) => `harness-integrations/${name}/README.md`);

/** Public Markdown, grouped as on the docs home. Only these files are rendered. */
const sections = [
  [
    "Start",
    [
      ["README.md", "Overview", "What Flow does, where it runs and how data stays local"],
      ["SETUP.md", "Set up Flow", "Fresh clone, isolated verification and the local demo"],
      ["docs/installation.md", "CLI and SDK installation", "The flow launcher, PATH, SDK imports and removal"],
      ["docs/settings.md", "Local settings", "Providers, models and workspace preferences"],
    ],
  ],
  [
    "Agents, CLI, SDK and MCP",
    [
      ["AGENTS.md", "AGENTS.md", "The agent entrypoint and repository contracts"],
      ["docs/agents.md", "Agent workflows", "Project discovery, graph edits, planning and runs"],
      ["docs/mcp.md", "MCP setup", "Host configuration and discoverable tools"],
      ["docs/agent-skills.md", "Agent skills", "Managed skills installed by setup"],
      ["docs/inline-agent.md", "Inline agent", "The page-aware agent inside the canvas"],
      ["docs/provider-model-picker.md", "Agent providers and models", "Choosing the inline agent's provider, model and thinking"],
    ],
  ],
  [
    "Providers and models",
    [
      ["docs/PROVIDERS.md", "Provider setup", "CLI harnesses, image APIs and CLI routing"],
      ["docs/local-models.md", "Local models", "ComfyUI, SAM and explicit model downloads"],
      ["docs/fal-and-seedance.md", "fal and Seedance", "fal image and video models"],
      ["docs/video-workflows.md", "Video workflows", "Video generation through the Gemini API"],
      ["docs/harness-usage.md", "Harness usage", "Subscription usage and Gemini video"],
      ["harness-integrations/README.md", "Provider adapters", "How adapters are registered and dispatched"],
    ],
  ],
  [
    "Workflows and images",
    [
      ["examples/README.md", "Examples", "Workflow files, provider configuration and SDK code"],
      ["docs/flow-files.md", "Flow files", "The .flow.json format and upgrades"],
      ["docs/prompt-sets.md", "Prompt Sets", "Named scenes with per-scene overrides"],
      ["docs/styles.md", "Styles", "The built-in style catalog"],
      ["docs/grok-and-lineage.md", "Provider comparison and lineage", "Several modes on the same inputs"],
      ["docs/image-outputs.md", "Image formats", "GIF, SVG and output options"],
      ["docs/image-versions.md", "Image versions", "Regions, comments and edits"],
      ["docs/image-region-names.md", "Region names", "Naming SAM masks with a vision harness"],
      ["docs/canvas-organization.md", "Organize the canvas", "Layout and section frames"],
      ["docs/observability.md", "OpenTelemetry", "Tracing and latency"],
      ["examples/quoture/README.md", "Record branches", "One shared direction feeding several branches"],
    ],
  ],
  [
    "Project",
    [
      ["docs/ARCHITECTURE.md", "Architecture", "Subsystem boundaries and source map"],
      ["CONTRIBUTING.md", "Contributing", "Checks and contribution rules"],
      ["SECURITY.md", "Security", "Reporting vulnerabilities and the local trust model"],
      ["docs/licenses.md", "Dependency licenses", "Dependency and optional-model inventory"],
      ["THIRD_PARTY_NOTICES.md", "Third-party notices", "Fonts, marks and other notices"],
      ["LICENSE", "MIT license", "Flow source license"],
    ],
  ],
];

export const publicDocumentSources = [
  ...sections.flatMap(([, pages]) => pages.map(([source]) => source)),
  ...providerAdapters,
];

const quickStart = `git clone ${repository}.git
cd flow
npm ci
npm run setup
npm run verify:setup
node tools/demo.mjs --json`;
const discovery = `node cli/flow.mjs help run --json
node cli/flow.mjs serve --json
node cli/flow.mjs guide --json
node cli/flow.mjs schema --json
node cli/flow.mjs providers --json`;

export const publicLayout = {
  // Root guides keep their names; docs/*.md move under guide/ so AGENTS.html
  // and guide/agents.html never collide on case-insensitive file systems.
  page: (source) => {
    const page = source.replace(/\.md$/i, "");
    return `${page.startsWith("docs/") ? `guide/${page.slice(5)}` : page}.html`;
  },
  index: "index.html",
  stylesheet: "site.css",
  home: "index.html",
  homeLabel: "Docs home",
  title: "Flow documentation",
  navigation: [
    ["SETUP.md", "Setup"],
    ["docs/installation.md", "CLI / SDK"],
    ["AGENTS.md", "AGENTS.md"],
    ["docs/agents.md", "Agent workflows"],
    ["docs/mcp.md", "MCP"],
    ["docs/PROVIDERS.md", "Providers"],
    ["examples/README.md", "Examples"],
  ],
  links: [
    [landingUrl, "Website"],
    [repository, "GitHub"],
  ],
  indexBody: (href, sources) => {
    const list = (pages) =>
      `<ul>${pages
        .filter(([source]) => sources.has(source))
        .map(
          ([source, title, summary]) =>
            `<li><a href="${href(source)}">${escape(title)}</a> — ${escape(summary)}</li>`,
        )
        .join("")}</ul>`;
    const adapters = providerAdapters
      .filter((source) => sources.has(source))
      .map(
        (source) =>
          `<a href="${href(source)}">${escape(source.split("/")[1])}</a>`,
      )
      .join(" · ");
    return `<h1>Flow documentation</h1>
<p>Flow is a local canvas for image, GIF and video workflows, with a CLI, JavaScript SDK and MCP server for agents. It runs on your computer: there is no hosted Flow app or account. Each clone has its own local database and uses the providers you connect.</p>
<h2>Run it locally</h2>
<p>Node.js 22.13 or newer and npm on macOS or Linux. No provider account, API key, GPU or model download is needed for the demo. Follow <a href="${href("SETUP.md")}">Set up Flow</a> for the full sequence, then open <code>http://localhost:4310</code>.</p>
<pre><code>${escape(quickStart)}</code></pre>
<h2>For agents</h2>
<p>Read <a href="${href("SETUP.md")}">SETUP.md</a>, then <a href="${href("AGENTS.md")}">AGENTS.md</a>. Command help works offline; the other commands discover the running local server's routes, graph schema and provider readiness. MCP hosts use the same services; see <a href="${href("docs/mcp.md")}">MCP setup</a>. The JavaScript client is described in <a href="${href("docs/installation.md")}">CLI and SDK installation</a> and <a href="${href("docs/agents.md")}">agent workflows</a>.</p>
<pre><code>${escape(discovery)}</code></pre>
${sections
  .map(
    ([title, pages]) =>
      `<h2>${escape(title)}</h2>${list(pages)}` +
      (title === "Providers and models" && adapters
        ? `<p>Adapter notes: ${adapters}</p>`
        : ""),
  )
  .join("\n")}
<footer>Built from the Markdown in the <a href="${repository}" target="_blank" rel="noopener noreferrer">public repository</a>. MIT licensed.</footer>`;
  },
};
