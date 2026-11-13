import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { documentationLink } from "../tools/lib/docs-site.mjs";
import {
  docsUrl,
  publicDocumentSources,
  publicLayout,
} from "../tools/lib/public-docs.mjs";

const root = path.resolve(import.meta.dirname, "..");
const site = path.join(root, "website/landing/site");

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
    new RegExp(`<a class="u" href="${docsUrl}" target="_blank" rel="noopener noreferrer">Docs</a>`),
  );
  // Every docs deep link must be a page the docs build produces.
  const pages = publicDocumentSources.map(publicLayout.page);
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
  ])
    assert.ok(publicDocumentSources.includes(source), source);
  for (const source of publicDocumentSources)
    assert.doesNotMatch(
      source,
      /^docs\/(?:launch|qa|screenshots|benchmarks|design)\/|overto-navigation|release-review|open-source-readiness|VERIFICATION/,
    );
  const pages = publicDocumentSources.map(publicLayout.page);
  assert.equal(
    new Set(pages.map((page) => page.toLowerCase())).size,
    pages.length,
  );
});

test("public docs resolve nested links to bundled pages and images", () => {
  const sources = new Set(publicDocumentSources);
  const link = (source, href) =>
    documentationLink(source, href, sources, publicLayout);
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
