// Renders the complete public docs bundle in memory. tools/build-docs.mjs writes
// and validates it; tests render it into a temporary directory.
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  documentationImages,
  renderMarkdown,
} from "../../tools/lib/docs-site.mjs";
import { orderedPages, pagePath, publicDocumentSources } from "./inventory.mjs";
import { highlight, renderHome, renderPage, searchRecord } from "./shell.mjs";

/** Files copied unchanged: [bundle path, repository source]. */
export const staticFiles = [
  ["assets/docs.css", "website/docs/assets/docs.css"],
  ["assets/docs.js", "website/docs/assets/docs.js"],
  ["assets/favicon.svg", "website/docs/assets/favicon.svg"],
  ["assets/favicon.png", "website/docs/assets/favicon.png"],
  ["assets/apple-touch-icon.png", "website/docs/assets/apple-touch-icon.png"],
  ["assets/og.png", "website/docs/assets/og.png"],
  ["assets/grain.svg", "website/docs/assets/grain.svg"],
  ["assets/Figtree-Variable.woff2", "public/fonts/figtree/Figtree-Variable.woff2"],
  ["assets/Figtree-Italic-Variable.woff2", "public/fonts/figtree/Figtree-Italic-Variable.woff2"],
  ["assets/OFL.txt", "public/fonts/figtree/OFL.txt"],
  ...documentationImages.map((name) => [`images/${name}`, `docs/images/${name}`]),
];

/** Every generated file as [bundle path, contents], in a stable order. */
export async function renderSite(root) {
  const sources = new Set(publicDocumentSources);
  const layout = { page: pagePath, highlight, headingAnchors: true };
  const generated = [];
  const records = [];
  for (const entry of orderedPages) {
    let markdown = await readFile(path.join(root, entry.source), "utf8");
    if (entry.source === "LICENSE") markdown = "# MIT license\n\n" + markdown;
    const { html, headings } = renderMarkdown(entry.source, markdown, sources, layout);
    const title = headings.find(({ level }) => level === 1)?.text || entry.title;
    const rendered = renderPage({ entry, title, html, headings });
    const target = pagePath(entry.source);
    generated.push([target, rendered.html], [target.replace(/\.html$/, ".page.json"), JSON.stringify(rendered.data)]);
    records.push(searchRecord({ entry, title, html, headings }));
  }
  const home = renderHome();
  generated.push(["index.html", home.html], ["index.page.json", JSON.stringify(home.data)]);
  // Loaded on demand by docs.js; a script (not JSON) so search also works from file://.
  generated.push([
    "assets/search-index.js",
    `window.FLOW_DOCS_INDEX = ${JSON.stringify(records)};\n`,
  ]);
  return generated;
}
