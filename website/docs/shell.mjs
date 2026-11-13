// HTML shell for the public documentation site. Markdown arrives already
// sanitized and link-resolved from tools/lib/docs-site.mjs; this module adds the
// navigation, table of contents, home page and search records around it.
import path from "node:path";
import {
  groups,
  landingUrl,
  orderedPages,
  pagePath,
  repository,
} from "./inventory.mjs";

const posix = path.posix;
const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const relative = (from, to) =>
  posix.relative(posix.dirname(from), to) || posix.basename(to);
const sourceUrl = (kind, source) =>
  `${repository}/${kind}/main/${source.split("/").map(encodeURIComponent).join("/")}`;
const external = (href, label, className = "") =>
  `<a${className ? ` class="${className}"` : ""} href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}<svg class="ext" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2 3 9"/></svg><span class="sr-only"> (opens in a new tab)</span></a>`;

// Lightweight syntax accents. Each rule returns [class, text] tokens; text is
// escaped by the caller, so no source text can become markup.
const shell =
  /(?<c>(?:^|(?<=\s))#.*$)|(?<s>"(?:\\.|[^"\\\n])*"|'[^'\n]*')|(?<n>\$\{?[A-Za-z_]\w*\}?)|(?<p>(?<=\s)--?[A-Za-z][\w-]*)|(?<k>^[ \t]*(?:[A-Za-z_][\w.-]*)(?=[ \t]|$))/gm;
const script =
  /(?<c>\/\/.*$|\/\*[\s\S]*?\*\/)|(?<s>"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(?<k>\b(?:import|from|export|const|let|var|await|async|function|return|new|if|else|for|of|in|while|class|extends|try|catch|throw|default|typeof|null|undefined|true|false)\b)|(?<n>\b\d+(?:\.\d+)?\b)/gm;
const json =
  /(?<p>"(?:\\.|[^"\\\n])*"(?=\s*:))|(?<s>"(?:\\.|[^"\\\n])*")|(?<k>\b(?:true|false|null)\b)|(?<n>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/gm;
const config = /(?<c>(?:^|(?<=\s))#.*$)|(?<s>"(?:\\.|[^"\\\n])*"|'[^'\n]*')/gm;
const rules = {
  sh: shell,
  bash: shell,
  zsh: shell,
  shell,
  console: shell,
  js: script,
  mjs: script,
  javascript: script,
  jsx: script,
  ts: script,
  typescript: script,
  json,
  jsonc: script,
  yaml: config,
  yml: config,
  toml: config,
  ini: config,
  env: config,
};

export function highlight(language, text) {
  const rule = rules[language.toLowerCase()];
  if (!rule) return [[null, text]];
  const tokens = [];
  let last = 0;
  for (const match of text.matchAll(rule)) {
    const kind = Object.entries(match.groups).find(([, value]) => value)?.[0];
    if (!kind || !match[0]) continue;
    if (match.index > last) tokens.push([null, text.slice(last, match.index)]);
    tokens.push([kind, match[0]]);
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push([null, text.slice(last)]);
  return tokens;
}

const codeBlock = (language, text) =>
  `<div class="code-block" data-language="${escape(language)}"><pre><code>${highlight(
    language,
    text,
  )
    .map(([kind, value]) =>
      kind ? `<span class="${kind}">${escape(value)}</span>` : escape(value),
    )
    .join("")}</code></pre></div>`;

const icons = {
  menu: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h9"/></svg>',
  search:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="m13.2 13.2 3.8 3.8"/></svg>',
  arrow: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5"/></svg>',
  back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10H4m5-5-5 5 5 5"/></svg>',
};

function sidebar(current) {
  const link = (target, label, active) =>
    `<a href="${escape(relative(current, target))}"${active ? ' aria-current="page"' : ""}>${escape(label)}</a>`;
  const list = (title, index, pages) =>
    `<div class="side-group"><p class="side-title" id="side-${index}">${escape(title)}</p><ul aria-labelledby="side-${index}">${pages
      .map((entry) => {
        const target = pagePath(entry.source);
        if (!entry.children) return `<li>${link(target, entry.title, target === current)}</li>`;
        const open =
          target === current ||
          entry.children.some((child) => pagePath(child.source) === current);
        return `<li>${link(target, entry.title, target === current)}<details class="side-sub"${open ? " open" : ""}><summary>${entry.children.length} adapter notes</summary><ul>${entry.children
          .map((child) => {
            const childTarget = pagePath(child.source);
            return `<li>${link(childTarget, child.title, childTarget === current)}</li>`;
          })
          .join("")}</ul></details></li>`;
      })
      .join("")}</ul></div>`;
  return `<nav id="sidebar" class="sidebar" aria-label="Documentation"><div class="side-head"><span>Documentation</span><button class="drawer-close" type="button" aria-label="Close navigation" hidden>${icons.back}</button></div><div class="side-scroll">${link(
    "index.html",
    "Docs home",
    current === "index.html",
  ).replace("<a ", '<a class="side-home" ')}${groups
    .map((group, index) => list(group.title, index, group.pages))
    .join("")}<div class="side-links">${external(landingUrl, "Website")}${external(repository, "GitHub")}</div></div></nav>`;
}

function frame({ current, title, description, bodyClass, main }) {
  const root = relative(current, "index.html").replace(/index\.html$/, "") || "./";
  const asset = (name) => escape(relative(current, `assets/${name}`));
  const home = escape(relative(current, "index.html"));
  const html = `<!doctype html>
<html lang="en" class="no-js" data-root="${escape(root)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<meta name="color-scheme" content="dark">
<style>html,body{background:#060607;color:#f4f1ea}</style>
<meta name="theme-color" content="#060607">
<link rel="icon" href="${asset("favicon.svg")}" type="image/svg+xml">
<link rel="preload" href="${asset("Figtree-Variable.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset("docs.css")}">
<script defer src="${asset("docs.js")}"></script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#content">Skip to content</a>
<header class="topbar">
<a class="menu-btn" href="${home}#browse" aria-controls="sidebar" aria-label="All pages">${icons.menu}</a>
<a class="brand" href="${home}" aria-label="Flow documentation home"><i aria-hidden="true"></i>flow<span>docs</span></a>
<a class="search-btn search-trigger" href="${home}#browse" aria-label="Search documentation" aria-keyshortcuts="Meta+K Control+K">${icons.search}<span class="label">Search docs</span><kbd aria-hidden="true">⌘K</kbd></a>
<nav class="top-links" aria-label="Flow">${external(landingUrl, "Website")}${external(repository, "GitHub")}</nav>
<div class="progress" aria-hidden="true"><i></i></div>
</header>
<div class="shell">
${sidebar(current)}
<div class="scrim" aria-hidden="true"></div>
${main}
</div>
</body>
</html>
`;
  return { html, data: { path: current, title, description, bodyClass, main } };
}

function tocList(headings) {
  return `<ol class="toc-list">${headings
    .map(
      ({ level, id, text }) =>
        `<li class="l${level}"><a href="#${escape(id)}">${escape(text)}</a></li>`,
    )
    .join("")}</ol>`;
}

/** One article page with sidebar, right-hand contents, pager and source links. */
export function renderPage({ entry, title, html, headings }) {
  const current = pagePath(entry.source);
  const index = orderedPages.findIndex((item) => item.source === entry.source);
  const previous = index > 0 ? orderedPages[index - 1] : null;
  const next = orderedPages[index + 1] || null;
  const toc = headings.filter(({ level }) => level === 2 || level === 3);
  const pager = (item, rel, label) => {
    const target = item ? pagePath(item.source) : "index.html";
    const name = item ? item.title : "Docs home";
    return `<a class="${rel}" rel="${rel}" href="${escape(relative(current, target))}"><span>${label}</span><b>${escape(name)}</b></a>`;
  };
  const inline = toc.length
    ? `<details class="toc-inline"><summary>On this page<span>${toc.length} sections</span></summary>${tocList(toc)}</details>`
    : "";
  const body = html.replace(/<\/h1>/, `</h1>${inline}`);
  const aside = toc.length
    ? `<aside class="toc" aria-labelledby="toc-title"><div class="toc-panel"><p class="toc-title" id="toc-title">On this page</p><div class="toc-scroll"><span class="toc-marker" aria-hidden="true"></span>${tocList(toc)}</div><a class="toc-top" href="#content">Back to top</a></div></aside>`
    : "";
  const main = `<main id="content" class="main" tabindex="-1">
<article class="doc">
<p class="eyebrow">${escape(entry.group)}</p>
${body}
<nav class="pager" aria-label="Previous and next page">${pager(previous, "prev", "Previous")}${next ? pager(next, "next", "Next") : ""}</nav>
<footer class="doc-foot">${external(sourceUrl("edit", entry.source), "Edit this page on GitHub")}${external(sourceUrl("blob", entry.source), `Source: ${escape(entry.source)}`)}<span>Flow · MIT licensed</span></footer>
</article>
${aside}
</main>`;
  return frame({
    current,
    title: `${title} · Flow docs`,
    description: entry.summary,
    bodyClass: toc.length ? "page has-toc" : "page",
    main,
  });
}

/** The designed docs home: hero, quick start, interfaces and the full index. */
export function renderHome() {
  const href = (source) => escape(pagePath(source));
  const quickStart = `git clone ${repository}.git
cd flow
npm ci
npm run setup
npm run verify:setup
node tools/demo.mjs --json`;
  const interfaces = [
    ["CLI", "flow plan · run · wait", "docs/installation.md"],
    ["SDK", "FlowClient in JavaScript", "docs/agents.md"],
    ["MCP", "Discoverable tools for agent hosts", "docs/mcp.md"],
    ["Skills", "Installed for Claude Code &amp; Codex", "docs/agent-skills.md"],
  ];
  const card = (group) => {
    const pages = group.pages.flatMap((entry) => [entry, ...(entry.children || [])]);
    return `<li class="card"><h3>${escape(group.title)}</h3><p>${escape(group.summary)}</p><ul>${group.pages
      .slice(0, 4)
      .map((entry) => `<li><a href="${href(entry.source)}">${escape(entry.title)}</a></li>`)
      .join("")}</ul><a class="more" href="${href(group.pages[0].source)}">${pages.length} pages ${icons.arrow}</a></li>`;
  };
  const browse = groups
    .map(
      (group) =>
        `<div><h3>${escape(group.title)}</h3><ul>${group.pages
          .map(
            (entry) =>
              `<li><a href="${href(entry.source)}">${escape(entry.title)}</a>${
                entry.children
                  ? `<ul>${entry.children
                      .map((child) => `<li><a href="${href(child.source)}">${escape(child.title)}</a></li>`)
                      .join("")}</ul>`
                  : ""
              }</li>`,
          )
          .join("")}</ul></div>`,
    )
    .join("");
  const main = `<main id="content" class="main" tabindex="-1">
<section class="hero" aria-labelledby="home-title">
<div class="aurora" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i>
<svg class="lines" viewBox="0 0 1440 560" preserveAspectRatio="none" focusable="false"><defs><linearGradient id="flow-line" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#b8f3ff" stop-opacity="0"/><stop offset=".25" stop-color="#b8f3ff"/><stop offset=".55" stop-color="#d7b8ff"/><stop offset=".8" stop-color="#ffc2e2"/><stop offset="1" stop-color="#ffc2e2" stop-opacity="0"/></linearGradient></defs><path d="M-60 410C240 330 430 140 730 220S1180 450 1500 170"/><path d="M-60 460C260 390 470 230 770 290S1210 470 1500 260"/><path d="M-60 330C300 260 500 70 800 150S1170 380 1500 90"/></svg>
</div>
<div class="hero-copy">
<p class="eyebrow"><span class="pulse" aria-hidden="true"></span>Flow documentation</p>
<h1 id="home-title">Run it locally.<br><em>Drive it from your agents.</em></h1>
<p class="lead">Flow is a local canvas for image, GIF and video workflows. The CLI, JavaScript SDK and MCP server use the same services as the canvas, and every output keeps its prompt, inputs and lineage.</p>
<div class="cta"><a class="btn btn-primary" href="${href("SETUP.md")}">Set up Flow ${icons.arrow}</a><a class="btn" href="${href("AGENTS.md")}">Agent guide</a><a class="btn btn-ghost search-trigger" href="#browse">${icons.search}Search<kbd aria-hidden="true">⌘K</kbd></a></div>
<ul class="facts" aria-label="At a glance"><li>Runs on your machine</li><li>No Flow account</li><li>CLI · SDK · MCP</li><li>MIT licensed</li></ul>
</div>
<figure class="shot"><a href="${href("README.md")}" aria-label="Read the overview"><img src="images/helmet-campaign.jpg" width="2469" height="1049" alt="The Flow canvas: a SALT / SPEED helmet campaign where one shared art direction branches into four scenes and a collection of generated images"></a><figcaption>A real Flow canvas. One shared direction, four scenes, one collection.</figcaption></figure>
</section>
<section class="band" aria-labelledby="quick-start">
<div class="band-head"><p class="eyebrow">Two minutes</p><h2 id="quick-start">Quick start</h2><p>Node.js 22.13+ and npm on macOS or Linux. The demo needs no provider account, API key, GPU or model download.</p></div>
<div class="quick">${codeBlock("sh", quickStart)}<ol class="steps"><li><b>Install and verify</b><span><code>npm run setup</code> installs the <code>flow</code> launcher and agent skills. <code>verify:setup</code> checks an isolated workspace.</span></li><li><b>Run the demo</b><span>Four real images through Local color lab. It returns project, workflow and run IDs.</span></li><li><b>Open the canvas</b><span><code>http://localhost:4310</code>. Connect a provider in Settings when you want AI inference.</span></li></ol></div>
<p class="band-link"><a href="${href("SETUP.md")}">Read the full setup guide ${icons.arrow}</a></p>
</section>
<section class="band" aria-labelledby="interfaces">
<div class="band-head"><p class="eyebrow">One platform</p><h2 id="interfaces">Four ways in</h2><p>Every interface calls the same local services. Graph edits and planning never start inference.</p></div>
<ul class="surfaces">${interfaces
    .map(
      ([name, text, source]) =>
        `<li><a href="${href(source)}"><b>${name}</b><span>${text}</span>${icons.arrow}</a></li>`,
    )
    .join("")}</ul>
</section>
<section class="band" aria-labelledby="explore">
<div class="band-head"><p class="eyebrow">Guides</p><h2 id="explore">Explore the docs</h2></div>
<ul class="cards">${groups.map(card).join("")}</ul>
</section>
<section class="band" aria-labelledby="browse">
<div class="band-head"><h2 id="browse">All pages</h2></div>
<div class="browse">${browse}</div>
<footer class="home-foot">Built from the Markdown in the ${external(repository, "public repository")}. Flow is MIT licensed.</footer>
</section>
</main>`;
  return frame({
    current: "index.html",
    title: "Flow documentation",
    description:
      "Set up Flow locally and use its canvas, CLI, JavaScript SDK and MCP server.",
    bodyClass: "home",
    main,
  });
}

const decode = (text) =>
  text
    .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
const plain = (html) =>
  decode(
    html
      .replace(/<a class="anchor"[^>]*>#<\/a>/g, "")
      .replace(/<(?:br|\/p|\/li|\/tr|\/h\d|\/pre)\b[^>]*>/g, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();

/** Search record: page title, group and complete text for each h2/h3 section. */
export function searchRecord({ entry, title, html, headings }) {
  const names = new Map(headings.map(({ id, text }) => [id, text]));
  const sections = html.split(/(?=<h[23] id=")/).map((part, index) => {
    const id = index ? /^<h[23] id="([^"]+)"/.exec(part)[1] : "";
    const text = plain(index ? part.replace(/^<h[23][^>]*>[\s\S]*?<\/h[23]>/, "") : part.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, ""));
    // Complete section text: search must match any public word. The UI shortens
    // only the displayed snippet.
    return [id, index ? names.get(id) : title, text];
  });
  return { u: pagePath(entry.source), t: entry.title, g: entry.group, s: sections };
}
