import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  documentationLink,
  renderDocumentation,
  validateDocumentationBundle,
} from "../tools/lib/docs-site.mjs";

const sources = new Set(["SETUP.md", "docs/installation.md", "docs/agents.md"]);
test("published documentation resolves real bundle pages and opens external destinations outside the frame", () => {
  assert.deepEqual(
    documentationLink("docs/agents.md", "../SETUP.md#install", sources),
    { href: "../SETUP.html#install" },
  );
  assert.deepEqual(
    documentationLink(
      "SETUP.md",
      "https://github.com/galElmalah/flow/blob/main/docs/agents.md",
      sources,
    ),
    { href: "docs/agents.html" },
  );
  assert.deepEqual(
    documentationLink(
      "SETUP.md",
      "https://github.com/galElmalah/flow",
      sources,
    ),
    {
      href: "https://github.com/galElmalah/flow",
      target: "_blank",
      rel: "noopener noreferrer",
    },
  );
  const html = renderDocumentation(
    "SETUP.md",
    "# Setup\n\n[SDK](docs/installation.md) and [repository](https://github.com/galElmalah/flow).\n\n## Install\n\n```sh\nnpm ci\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
    sources,
  );
  assert.match(html, /href="docs\/installation.html"/);
  assert.match(
    html,
    /href="https:\/\/github.com\/galElmalah\/flow" target="_blank"/,
  );
  assert.match(html, /<h2 id="install">/);
  assert.match(html, /<pre><code>npm ci/);
  assert.doesNotMatch(html, /<script|href="javascript:/);
});

test("publication preflight rejects the original same-frame link mistake and missing pages or assets", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "flow-doc-links-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "docs"));
  const entry = path.join(root, "index.html");
  await writeFile(
    entry,
    '<a href="https://github.com/galElmalah/flow">Docs</a>',
  );
  await assert.rejects(
    validateDocumentationBundle(root, ["index.html"]),
    /external links must open separately/,
  );
  await writeFile(entry, '<a href="docs/setup.html">Setup</a>');
  await assert.rejects(
    validateDocumentationBundle(root, ["index.html"]),
    /missing bundled link/,
  );
  await writeFile(entry, '<img src="missing.png" alt="Seed">');
  await assert.rejects(
    validateDocumentationBundle(root, ["index.html"]),
    /missing bundled link/,
  );
  await writeFile(
    entry,
    '<a href="docs/setup.html">Setup</a><a href="https://github.com/galElmalah/flow" target="_blank" rel="noopener noreferrer">Repository</a>',
  );
  await writeFile(
    path.join(root, "docs/setup.html"),
    '<a href="../index.html">Overview</a>',
  );
  await validateDocumentationBundle(root, ["index.html", "docs/setup.html"]);
  await writeFile(entry, '<link rel="canonical" href="https://example.com/docs/">');
  await validateDocumentationBundle(root, ["index.html"]);
  await writeFile(entry, '<link rel="stylesheet" href="https://example.com/styles.css">');
  await assert.rejects(validateDocumentationBundle(root, ["index.html"]), /bundle external dependencies/);
});
