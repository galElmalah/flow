import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  documentationLink,
  renderMarkdown,
  validateDocumentationBundle,
} from "../tools/lib/docs-site.mjs";
import {
  docsUrl,
  groups,
  orderedPages,
  pagePath,
  publicDocumentSources,
} from "../website/docs/inventory.mjs";
import { highlight, searchRecord } from "../website/docs/shell.mjs";
import { renderSite, staticFiles } from "../website/docs/site.mjs";

const root = path.resolve(import.meta.dirname, "..");
const site = path.join(root, "website/landing/site");
const layout = { page: pagePath };
let rendered;
const bundle = async () => (rendered ||= new Map(await renderSite(root)));

test("landing page links resolve inside its bundle and open other sites separately", async () => {
  const html = await readFile(path.join(site, "index.html"), "utf8");
  for (const [tag, href] of html.matchAll(
    /<(?:a|img|script|link)\b[^>]*?\b(?:href|src)="([^"]*)"[^>]*>/g,
  )) {
    if (/^https?:/.test(href)) {
      if (!tag.startsWith("<a")) continue; // canonical and social metadata
      assert.match(tag, /target="_blank"/, href);
      assert.match(tag, /rel="[^"]*noopener/, href);
    } else if (!href.startsWith("#"))
      assert.ok(existsSync(path.join(site, href)), `missing ${href}`);
  }
  const nav = html.match(/<nav>[\s\S]*?<\/nav>/)[0];
  assert.match(
    nav,
    new RegExp(`<a class="u docs" href="${docsUrl}" target="_blank" rel="noopener noreferrer">Docs</a>`),
  );
  // Narrow layouts hide the other header links but keep Docs.
  assert.match(
    html,
    /@media \(max-width: 900px\) \{\s*nav \.l \{[^}]*\}\s*nav \.l a:not\(\.docs\) \{ display: none; \}/,
  );
  // Every docs deep link must be a page the docs build produces.
  const pages = publicDocumentSources.map(pagePath);
  for (const [, page] of html.matchAll(new RegExp(`${docsUrl}([^"#]*)`, "g")))
    assert.ok(
      page === "" || pages.includes(page),
      `landing links to a page the docs do not build: ${page}`,
    );
});

test("public docs contain setup, agent, SDK, MCP, provider and example guides but no release reports", () => {
  for (const source of [
    "SETUP.md",
    "AGENTS.md",
    "docs/installation.md",
    "docs/agents.md",
    "docs/mcp.md",
    "docs/PROVIDERS.md",
    "examples/README.md",
    "harness-integrations/codex/README.md",
  ])
    assert.ok(publicDocumentSources.includes(source), source);
  for (const source of publicDocumentSources)
    assert.doesNotMatch(
      source,
      /^docs\/(?:launch|qa|screenshots|benchmarks|design)\/|overto-navigation|release-review|open-source-readiness|VERIFICATION/,
    );
  const pages = publicDocumentSources.map(pagePath);
  assert.equal(new Set(pages.map((page) => page.toLowerCase())).size, pages.length);
  assert.equal(new Set(publicDocumentSources).size, publicDocumentSources.length);
});

test("public docs resolve nested links to bundled pages and images", () => {
  const sources = new Set(publicDocumentSources);
  const link = (source, href) => documentationLink(source, href, sources, layout);
  assert.deepEqual(link("docs/agents.md", "../SETUP.md#install"), {
    href: "../SETUP.html#install",
  });
  assert.deepEqual(link("SETUP.md", "docs/installation.md"), {
    href: "guide/installation.html",
  });
  assert.deepEqual(
    link("harness-integrations/codex/README.md", "../../docs/PROVIDERS.md"),
    { href: "../../guide/PROVIDERS.html" },
  );
  assert.deepEqual(link("README.md", "docs/images/helmet-campaign.jpg"), {
    href: "images/helmet-campaign.jpg",
  });
  assert.deepEqual(link("examples/README.md", "../docs/mcp.md"), {
    href: "../guide/mcp.html",
  });
  assert.deepEqual(link("AGENTS.md", "docs/overto-navigation.md"), {
    href: "https://github.com/galElmalah/flow/blob/main/docs/overto-navigation.md",
    target: "_blank",
    rel: "noopener noreferrer",
  });
});

test("code accents escape their source and Markdown HTML stays sanitized", () => {
  const sources = new Set(["SETUP.md"]);
  const { html, headings } = renderMarkdown(
    "SETUP.md",
    '# Setup\n\n## Install `flow`\n\n```sh\necho "<script>alert(1)</script>" --json # note\n```\n\n<img src=x onerror=alert(1)>\n\n## Install `flow`\n',
    sources,
    { page: pagePath, highlight, headingAnchors: true },
  );
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<span class="s">&quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;<\/span>/);
  assert.match(html, /<span class="p">--json<\/span>/);
  assert.match(html, /<span class="c"># note<\/span>/);
  assert.deepEqual(
    headings.map(({ level, id }) => [level, id]),
    [[1, "setup"], [2, "install-flow"], [2, "install-flow-1"]],
  );
  // The heading is named by its visible title only; the permalink keeps its own label.
  assert.match(
    html,
    /<h2 id="install-flow-1" aria-label="Install flow">Install <code>flow<\/code><a class="anchor" href="#install-flow-1" aria-label="Link to section: Install flow">#<\/a><\/h2>/,
  );
  assert.deepEqual(highlight("unknown", "a < b"), [[null, "a < b"]]);
});

test("every page has the docs shell, its current nav item and contents linked to real sections", async () => {
  const pages = await bundle();
  assert.equal(
    [...pages.keys()].filter((file) => file.endsWith(".html")).length,
    publicDocumentSources.length + 1,
  );
  for (const [file, html] of pages) {
    if (!file.endsWith(".html")) continue;
    assert.match(html, /<header class="topbar">/, file);
    assert.match(html, /<nav id="sidebar" class="sidebar" aria-label="Documentation">/, file);
    assert.match(html, /<main id="content"/, file);
    assert.match(html, /<a class="skip" href="#content">/, file);
    const current = [...html.matchAll(/<a href="([^"]+)" aria-current="page"|<a class="side-home" href="([^"]+)" aria-current="page"/g)];
    assert.equal(current.length, 1, `${file}: one current page in the navigation`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), current[0][1] || current[0][2]));
    assert.equal(target, file, `${file}: navigation marks itself as current`);
    if (file === "index.html") continue;
    const article = html.match(/<article class="doc">([\s\S]*)<\/article>/)[1];
    const ids = [...article.matchAll(/<h([23]) id="([^"]+)"/g)].map((match) => match[2]);
    const aside = html.match(/<aside class="toc"[\s\S]*?<\/aside>/)?.[0] || "";
    const toc = [...aside.matchAll(/<a href="#([^"]+)">/g)].map((match) => match[1]);
    assert.deepEqual(toc, ids, `${file}: contents list matches rendered h2/h3`);
    const inline = html.match(/<details class="toc-inline">[\s\S]*?<\/details>/)?.[0] || "";
    assert.deepEqual([...inline.matchAll(/<a href="#([^"]+)">/g)].map((match) => match[1]), ids);
    assert.match(html, /<nav class="pager"[^>]*><a class="prev" rel="prev" href="[^"]+">/, file);
  }
  const mcp = pages.get("guide/mcp.html");
  assert.match(mcp, /<html lang="en" class="no-js" data-root="\.\.\/" data-public-root="https:\/\/gal\.overto\.work\/flow-landing\/docs\/">/);
  assert.match(mcp, /href="\.\.\/assets\/docs\.css"/);
  assert.match(mcp, /href="https:\/\/github\.com\/galElmalah\/flow\/edit\/main\/docs\/mcp\.md" target="_blank" rel="noopener noreferrer"/);
  const last = orderedPages.at(-1);
  assert.doesNotMatch(pages.get(pagePath(last.source)), /class="next"/);
  assert.match(pages.get("harness-integrations/codex/README.html"), /<details class="side-sub" open>/);
});

test("search index covers every page and its real section anchors", async () => {
  const pages = await bundle();
  const source = pages.get("assets/search-index.js");
  const index = JSON.parse(source.slice("window.FLOW_DOCS_INDEX = ".length).trim().replace(/;$/, ""));
  assert.deepEqual(index.map((page) => page.u), orderedPages.map((entry) => pagePath(entry.source)));
  for (const page of index) {
    const html = pages.get(page.u);
    assert.ok(page.t && page.g && page.s.length, page.u);
    for (const [id, heading, text] of page.s) {
      assert.equal(typeof text, "string");
      assert.doesNotMatch(text, /<[a-z]/i, `${page.u}: index text is plain`);
      if (id) {
        assert.ok(html.includes(` id="${id}"`), `${page.u}#${id}`);
        assert.ok(heading, `${page.u}#${id} has a heading`);
      }
    }
  }
  const mcp = index.find((page) => page.u === "guide/mcp.html");
  assert.ok(mcp.s.some(([, , text]) => /stdio MCP server/.test(text)));
  // Real MCP tool names from deep inside a long section are searchable and point
  // at the section that documents them.
  for (const tool of ["segment_image", "prepare_image_edit", "send_image_edit"]) {
    const section = mcp.s.find(([, , text]) => text.includes(tool));
    assert.ok(section, `${tool} is indexed`);
    assert.equal(section[0], "full-ui-operation-coverage");
    assert.ok(section[2].indexOf(tool) > 1200, `${tool} sits beyond the old 1200-character cut`);
  }
  const script = await readFile(path.join(root, "website/docs/assets/docs.js"), "utf8");
  assert.match(script, /assets\/search-index\.js/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|eval\(|new Function/);
});

test("search records keep complete section text, however long", () => {
  const filler = "Plain words about local workflows. ".repeat(80);
  const markdown = `# Long\n\nIntro ${filler} introtailterm\n\n## Tools\n\n${filler}\n\nThe last tool is \`deep_tool_name\`.\n`;
  const entry = { source: "docs/mcp.md", title: "MCP setup", group: "Agents" };
  const { html, headings } = renderMarkdown(entry.source, markdown, new Set([entry.source]), {
    page: pagePath,
    highlight,
    headingAnchors: true,
  });
  const record = searchRecord({ entry, title: "Long", html, headings });
  const [intro, tools] = record.s;
  assert.ok(intro[2].indexOf("introtailterm") > 1200);
  assert.deepEqual(tools.slice(0, 2), ["tools", "Tools"]);
  assert.ok(tools[2].endsWith("The last tool is deep_tool_name."));
  assert.ok(tools[2].indexOf("deep_tool_name") > 1200);
});

test("enhanced triggers are real buttons, text never fades in and touch copy targets are 40px", async () => {
  const pages = await bundle();
  // Without JavaScript, menu and search are links to the full page list.
  const html = pages.get("guide/mcp.html");
  assert.match(html, /<a class="menu-btn" href="\.\.\/index\.html#browse"/);
  assert.match(html, /<a class="search-btn search-trigger" href="\.\.\/index\.html#browse"/);
  const script = await readFile(path.join(root, "website/docs/assets/docs.js"), "utf8");
  // docs.js replaces them with <button type="button"> so Enter and Space activate
  // natively once, without page scrolling; anchors are never given role=button.
  assert.match(script, /el\("button", \{ type: "button", class: link\.className \}\)/);
  assert.match(script, /link\.replaceWith\(button\)/);
  assert.match(script, /const menu = toButton\(\$\("\.menu-btn"\)\)/);
  assert.match(script, /\$\$\("\.search-trigger", scope\)\.map\(toButton\)/);
  assert.doesNotMatch(script, /"role", "button"/);
  const css = await readFile(path.join(root, "website/docs/assets/docs.css"), "utf8");
  const enter = css.match(/@keyframes enter \{([^}]*\})\s*\}/)[1];
  assert.doesNotMatch(enter, /opacity/, "entrance motion keeps text opaque");
  const touch = css.match(/@media \(max-width: 959px\), \(pointer: coarse\) \{([\s\S]*?)\n\}/)[1];
  assert.match(touch, /\.code-block \{ padding-top: 44px; \}/);
  assert.match(touch, /\.code-block \.copy \{[^}]*height: 40px;[^}]*border: 7px solid transparent;[^}]*background-clip: padding-box;/);
});

test("the rendered bundle declares every asset, resolves links and section fragments", async (t) => {
  const pages = await bundle();
  const output = await mkdtemp(path.join(tmpdir(), "flow-docs-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const files = [];
  for (const [file, contents] of pages) {
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await writeFile(path.join(output, file), contents);
    files.push(file);
  }
  for (const [file, source] of staticFiles) {
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await copyFile(path.join(root, source), path.join(output, file));
    files.push(file);
  }
  await validateDocumentationBundle(output, files, { fragments: true });
  for (const required of ["assets/docs.css", "assets/docs.js", "assets/Figtree-Variable.woff2", "assets/favicon.svg", "images/helmet-campaign.jpg", "assets/search-index.js"])
    assert.ok(files.includes(required), required);
  const css = await readFile(path.join(root, "website/docs/assets/docs.css"), "utf8");
  for (const [, url] of css.matchAll(/url\(([^)#]+)\)/g))
    assert.ok(files.includes(`assets/${url}`), `docs.css loads ${url}`);
  assert.doesNotMatch(css, /@import|https?:\/\//, "no external CSS dependencies");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media print/);
  const home = pages.get("index.html");
  assert.match(home, /<h2 id="browse">All pages<\/h2>/);
  for (const group of groups)
    for (const entry of group.pages)
      assert.ok(home.includes(`href="${pagePath(entry.source)}"`), entry.source);
  await assert.rejects(
    (async () => {
      await writeFile(path.join(output, "index.html"), '<a href="SETUP.html#missing-section">x</a>');
      await validateDocumentationBundle(output, files, { fragments: true });
    })(),
    /names a missing section/,
  );
});


test("navigation payloads contain exactly the matching article and metadata without the shell", async () => {
  const pages = await bundle();
  const htmlPages = [...pages].filter(([file]) => file.endsWith(".html"));
  assert.equal([...pages.keys()].filter((file) => file.endsWith(".page.json")).length, htmlPages.length);
  for (const [file, html] of htmlPages) {
    const payload = JSON.parse(pages.get(file.replace(/\.html$/, ".page.json")));
    assert.equal(payload.path, file);
    assert.ok(payload.title && payload.description && payload.bodyClass);
    assert.equal(payload.main, html.match(/<main id="content"[\s\S]*?<\/main>/)[0], file);
    assert.doesNotMatch(payload.main, /<script|<header class="topbar"|id="sidebar"/, file);
    assert.match(html, /<style>html,body\{background:#060607;color:#f4f1ea\}<\/style>/, "direct loads start dark before CSS arrives");
  }
});

test('both sites publish real icons and unfurl images, with correct deep-link metadata', async () => {
  const pages = await bundle();
  const assets = new Map(staticFiles);
  const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
  const checkPage = async (html, base, pathname, resolve) => {
    const meta = new Map([...html.matchAll(/<meta\b[^>]*>/g)].map(([tag]) => {
      const a = attributes(tag); return [a.property || a.name, a.content];
    }));
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map(([tag]) => attributes(tag));
    const canonical = new URL(pathname === 'index.html' ? '' : pathname, base).href;
    assert.equal(links.find((a) => a.rel === 'canonical').href, canonical);
    assert.equal(meta.get('og:url'), canonical);
    assert.equal(meta.get('og:type'), 'website');
    assert.equal(meta.get('twitter:card'), 'summary_large_image');
    for (const field of ['title', 'description', 'image', 'image:alt']) {
      assert.ok(meta.get(`og:${field}`), `${pathname}: ${field}`);
      assert.equal(meta.get(`og:${field}`), meta.get(`twitter:${field}`));
    }
    const preview = new URL(meta.get('og:image'));
    assert.ok(preview.href.startsWith(base));
    const image = await sharp(resolve(preview.href.slice(base.length))).metadata();
    assert.equal(image.width, Number(meta.get('og:image:width')));
    assert.equal(image.height, Number(meta.get('og:image:height')));
    assert.ok(image.width >= 1200 && image.height >= 630);
    for (const [rel, type, width] of [['icon', 'image/svg+xml', null], ['icon', 'image/png', 32], ['apple-touch-icon', undefined, 180]]) {
      const icon = links.find((a) => a.rel === rel && (!type || a.type === type));
      assert.ok(icon, `${pathname}: ${rel} ${type || ''}`);
      const url = new URL(icon.href, canonical);
      assert.ok(url.href.startsWith(base));
      const bytes = await readFile(resolve(url.href.slice(base.length)));
      if (width) assert.equal((await sharp(bytes).metadata()).width, width);
      else assert.match(bytes.toString(), /<svg/);
    }
  };
  for (const [file, html] of pages) {
    if (!file.endsWith('.html')) continue;
    await checkPage(html, docsUrl, file, (asset) => {
      assert.ok(assets.has(asset), `undeclared preview asset ${asset}`);
      return path.join(root, assets.get(asset));
    });
  }
  await checkPage(await readFile(path.join(site, 'index.html'), 'utf8'),
    'https://gal.overto.work/flow-landing/flow/', 'index.html', (asset) => path.join(site, asset));
  assert.deepEqual(await readFile(path.join(site, 'assets/favicon.svg')),
    await readFile(path.join(root, 'website/docs/assets/favicon.svg')));
});
