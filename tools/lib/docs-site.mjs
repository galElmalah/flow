import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const repository = "https://github.com/galElmalah/flow";
const posix = path.posix;
const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
const relative = (from, to) =>
  posix.relative(posix.dirname(from), to) || posix.basename(to);
/** Product captures in `docs/images/`; the only images rendered inline. */
export const documentationImages = [
  "helmet-campaign.jpg",
  "helmet-seed-workflow.jpg",
  "region-comment.jpg",
  "pink-jersey-result.jpg",
];
const imagePaths = new Map(
  documentationImages.map((name) => [
    `docs/images/${name}`,
    `images/${name}`,
  ]),
);

/**
 * Where a publication places its files, relative to the bundle root. The release
 * explainer keeps its guide under `launch/guide/`. The public docs pass their own
 * `page` mapping plus optional `highlight(language, text)` and `headingAnchors`.
 */
const launchLayout = {
  page: (source) => `launch/guide/${source.replace(/\.md$/i, "")}.html`,
  index: "launch/guide/index.html",
  stylesheet: "launch/guide/site.css",
  home: "launch/index.html",
  homeLabel: "Back to overview",
  navigation: [
    ["SETUP.md", "Start here"],
    ["docs/installation.md", "CLI / SDK"],
    ["docs/agents.md", "Agent workflows"],
    ["docs/mcp.md", "MCP"],
    ["docs/PROVIDERS.md", "Providers"],
    ["docs/flow-files.md", "Flow files"],
    ["docs/styles.md", "Styles"],
    ["docs/open-source-readiness.md", "Release"],
  ],
  links: [],
};

/** Bundle links stay inside the site; other destinations use a separate tab. */
export function documentationLink(
  source,
  href,
  sources,
  layout = launchLayout,
) {
  const pagePath = layout.page;
  if (!href || href.startsWith("#")) return { href: href || "#" };
  const github = href.match(
    /^https:\/\/github\.com\/galElmalah\/flow\/blob\/main\/([^?#]+)(.*)$/,
  );
  if (github && sources.has(decodeURIComponent(github[1])))
    return {
      href:
        relative(pagePath(source), pagePath(decodeURIComponent(github[1]))) +
        github[2],
    };
  if (/^(?:https?:|mailto:|\/\/)/i.test(href))
    return { href, target: "_blank", rel: "noopener noreferrer" };
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return {};
  const [, pathname, suffix] = href.match(/^([^?#]*)(.*)$/);
  const resolved = posix.normalize(
    pathname.startsWith("/")
      ? pathname.slice(1)
      : posix.join(posix.dirname(source), decodeURIComponent(pathname)),
  );
  const document = sources.has(resolved)
    ? resolved
    : sources.has(`${resolved.replace(/\/$/, "")}/README.md`)
      ? `${resolved.replace(/\/$/, "")}/README.md`
      : null;
  if (document)
    return { href: relative(pagePath(source), pagePath(document)) + suffix };
  if (imagePaths.has(resolved))
    return {
      href: relative(pagePath(source), imagePaths.get(resolved)) + suffix,
    };
  // Source files outside the documentation bundle remain deliberate external links.
  if (resolved.startsWith("../")) return {};
  return {
    href: `${repository}/blob/main/${resolved.split("/").map(encodeURIComponent).join("/")}${suffix}`,
    target: "_blank",
    rel: "noopener noreferrer",
  };
}

const textContent = (children) =>
  Array.isArray(children)
    ? children.map(textContent).join("")
    : children && typeof children === "object"
      ? textContent(children.props?.children)
      : String(children ?? "");
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
const externalLink = ([href, label]) =>
  `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;

/**
 * Sanitized Markdown → HTML with resolved links and stable heading IDs. Returns
 * the rendered `headings` in document order so navigation matches the page.
 */
export function renderMarkdown(source, markdown, sources, layout = launchLayout) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] || source;
  const ids = new Map();
  const headings = [];
  const link = (href) => documentationLink(source, href, sources, layout);
  const components = {
    a: ({ href, children }) => h("a", link(href), children),
    img: ({ src, alt }) => {
      const target = link(src);
      return target.target
        ? h("a", target, alt || "Reference image")
        : h("img", { src: target.href, alt: alt || "", loading: "lazy" });
    },
    code: ({ children, className }) => {
      if (!layout.highlight) return h("pre", {}, h("code", {}, children));
      const language = /\blanguage-([\w+-]+)/.exec(className || "")?.[1] || "";
      const text = textContent(children).replace(/\n$/, "");
      // Tokens are plain strings; React escapes them, so accents add no markup risk.
      const tokens = layout
        .highlight(language, text)
        .map(([kind, value], key) =>
          kind ? h("span", { key, className: kind }, value) : value,
        );
      return h(
        "div",
        { className: "code-block", "data-language": language || undefined },
        h("pre", {}, h("code", {}, ...tokens)),
      );
    },
    inlineCode: ({ children }) => h("code", {}, children),
    table: ({ children }) =>
      h(
        "div",
        { className: "table-scroll", tabIndex: 0 },
        h("table", {}, children),
      ),
  };
  for (let level = 1; level <= 6; level++)
    components[`h${level}`] = ({ children }) => {
      const text = textContent(children);
      const base = slug(text);
      const count = ids.get(base) || 0;
      ids.set(base, count + 1);
      const id = count ? `${base}-${count}` : base;
      headings.push({ level, id, text });
      const anchor =
        layout.headingAnchors && level >= 2 && level <= 3
          ? h(
              "a",
              {
                className: "anchor",
                href: `#${id}`,
                "aria-label": `Link to section: ${text}`,
              },
              "#",
            )
          : null;
      // The heading's name stays its visible title; the permalink has its own label.
      return h(
        `h${level}`,
        anchor ? { id, "aria-label": text } : { id },
        children,
        anchor,
      );
    };
  const body = renderToStaticMarkup(
    h(
      Streamdown,
      {
        mode: "static",
        controls: false,
        skipHtml: true,
        // Keep HTML sanitization. Relative bundle paths use our resolver instead of
        // the streaming chat's remote-origin allowlist. No client scripts are emitted.
        rehypePlugins: [defaultRehypePlugins.sanitize],
        components,
      },
      markdown,
    ),
  );
  return { title, html: body, headings };
}

export function renderDocumentation(
  source,
  markdown,
  sources,
  layout = launchLayout,
) {
  const { title, html: body } = renderMarkdown(
    source,
    markdown,
    sources,
    layout,
  );
  const current = layout.page(source);
  const nav =
    `<a href="${escape(relative(current, layout.index))}">All docs</a>` +
    layout.navigation
      .filter(([file]) => sources.has(file))
      .map(
        ([file, label]) =>
          `<a href="${escape(relative(current, layout.page(file)))}"${file === source ? ' aria-current="page"' : ""}>${label}</a>`,
      )
      .join("") +
    layout.links.map(externalLink).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Flow</title><link rel="stylesheet" href="${escape(relative(current, layout.stylesheet))}"></head><body><header><a class="brand" href="${escape(relative(current, layout.home))}">Flow</a><nav aria-label="Documentation">${nav}</nav></header><main><article>${body}</article><footer>Source: <a href="${repository}/blob/main/${source}" target="_blank" rel="noopener noreferrer">${escape(source)}</a> · <a href="${escape(relative(current, layout.home))}">${escape(layout.homeLabel)}</a></footer></main></body></html>`;
}

const css = `:root{color-scheme:light;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#222;background:#fff}*{box-sizing:border-box}body{margin:0}header,main{max-width:960px;margin:auto;padding:24px}.brand{font-size:22px;font-weight:600;text-decoration:none}nav{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:20px;font-size:14px}a{color:inherit;text-underline-offset:4px}nav a{padding:4px 0}nav [aria-current]{font-weight:600}main{padding-top:8px}article{max-width:860px}h1{font-size:32px;line-height:1.25;margin:24px 0}h2{font-size:23px;line-height:1.4;margin:36px 0 12px}h3{font-size:19px;margin-top:28px}p,ul,ol{margin:12px 0 20px}li{margin:5px 0}code{font:0.88em/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}p code,li code{background:#fafafa;padding:2px 4px}pre{white-space:pre;overflow:auto;background:#fafafa;border:1px solid #dededb;border-radius:6px;padding:16px;margin:20px 0}pre code{overflow-wrap:normal}blockquote{margin:20px 0;padding-left:20px;border-left:2px solid #dededb;color:#686868}img{max-width:100%;height:auto;display:block;border-radius:6px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #dededb;vertical-align:top;min-width:100px}.table-scroll{overflow:auto;max-width:100%;margin:20px 0}footer{margin-top:48px;padding-top:20px;border-top:1px solid #dededb;color:#686868;font-size:13px}a:focus-visible,.table-scroll:focus-visible{outline:2px solid #686868;outline-offset:4px}h1,h2,h3,h4,h5,h6{scroll-margin-top:20px}@media(max-width:600px){header,main{padding:20px 16px}h1{font-size:27px}nav{gap:6px 16px}pre{padding:12px;font-size:14px}}`;

const write = async (file, contents) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
};

/**
 * Renders the release explainer's guide into `output`, the bundle root, and
 * returns every written bundle path. The public docs use website/docs/ instead.
 */
export async function buildDocumentation(
  root,
  output,
  sourceFiles,
  layout = launchLayout,
) {
  const sources = new Set(sourceFiles);
  const files = [layout.stylesheet, layout.index];
  const href = (source) => escape(relative(layout.index, layout.page(source)));
  await write(path.join(output, layout.stylesheet), css);
  const links = [...sources]
    .sort()
    .map((source) => `<li><a href="${href(source)}">${escape(source)}</a></li>`)
    .join("");
  await write(
    path.join(output, layout.index),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Documentation · Flow</title><link rel="stylesheet" href="${escape(relative(layout.index, layout.stylesheet))}"></head><body><header><a class="brand" href="${escape(relative(layout.index, layout.home))}">Flow</a></header><main><h1>Documentation</h1><p>Start with <a href="${href("SETUP.md")}">Setup</a>, then use the CLI, SDK and MCP guides. These pages are included in this publication.</p><ul>${links}</ul></main></body></html>`,
  );
  for (const source of sources) {
    const target = layout.page(source);
    let markdown = await readFile(path.join(root, source), "utf8");
    if (source === "LICENSE") markdown = "# MIT license\n\n" + markdown;
    await write(
      path.join(output, target),
      renderDocumentation(source, markdown, sources, layout),
    );
    files.push(target);
  }
  return files;
}

/**
 * The original failure must fail locally before a publication is accepted. With
 * `fragments`, every `page.html#id` link must also name a real element ID.
 */
export async function validateDocumentationBundle(
  root,
  files,
  { fragments = false } = {},
) {
  const known = new Set(files);
  for (const file of files)
    if (!(await stat(path.join(root, file))).isFile())
      throw new Error(`Missing publication file: ${file}`);
  const pages = new Map();
  for (const file of files.filter((file) => file.endsWith(".html")))
    pages.set(file, await readFile(path.join(root, file), "utf8"));
  const ids = new Map(
    [...pages].map(([file, html]) => [
      file,
      new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])),
    ]),
  );
  for (const [file, html] of pages) {
    if (fragments)
      for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]*#[^"]+)"/g)) {
        if (/^(?:https?:|\/\/|mailto:)/i.test(href)) continue;
        const [pathname, fragment] = href.split("#");
        const target = pathname
          ? posix.normalize(posix.join(posix.dirname(file), pathname))
          : file;
        const id = decodeURIComponent(fragment);
        if (ids.has(target) && !ids.get(target).has(id))
          throw new Error(`${file}: link ${href} names a missing section`);
      }
    for (const [tag, href] of [
      ...html.matchAll(
        /<(?:a|img|link|script)\b[^>]*\b(?:href|src)="([^"]*)"[^>]*>/g,
      ),
    ].map((match) => [match[0], match[1]])) {
      if (/^(?:https?:|\/\/|mailto:)/i.test(href)) {
        if (/^<link\b/.test(tag) && /\brel="canonical"/.test(tag) && /^https:/.test(href))
          continue; // A canonical address is metadata, not a loaded dependency.
        if (!/^<a\b/.test(tag))
          throw new Error(
            `${file}: bundle external dependencies instead of loading ${href}`,
          );
        if (!/\btarget="_blank"/.test(tag) || !/\brel="[^"]*noopener/.test(tag))
          throw new Error(
            `${file}: external links must open separately: ${href}`,
          );
      } else if (!href.startsWith("#")) {
        const target = posix.normalize(
          posix.join(
            posix.dirname(file),
            decodeURIComponent(href.split(/[?#]/)[0]),
          ),
        );
        if (!known.has(target))
          throw new Error(`${file}: missing bundled link ${href}`);
      }
    }
  }
}
