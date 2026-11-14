// Builds the public documentation site from repository Markdown:
//   npm run docs:build
// Output: website/build/docs/ (entry index.html) and website/build/docs.manifest.json.
// Reads no workspace database, credentials, models or private reports.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDocumentationBundle } from "./lib/docs-site.mjs";
import {
  docsUrl,
  pagePath,
  publicDocumentSources,
} from "../website/docs/inventory.mjs";
import { renderSite, staticFiles } from "../website/docs/site.mjs";

const root = path.resolve(import.meta.dirname, "..");
const build = path.join(root, "website", "build");
const output = path.join(build, "docs");

// Sources must be repository files that Git does not ignore; ignored private
// material such as docs/qa/ or .flow/ can never enter the bundle.
const repositoryFiles = new Set(
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root },
  )
    .toString()
    .split("\0")
    .filter(Boolean),
);
for (const source of [
  ...publicDocumentSources,
  ...staticFiles.map(([, source]) => source),
])
  if (!repositoryFiles.has(source))
    throw new Error(`${source}: not a public repository file`);
const pages = publicDocumentSources.map(pagePath);
if (new Set(pages.map((page) => page.toLowerCase())).size !== pages.length)
  throw new Error("Two documents map to the same page path");

await rm(output, { recursive: true, force: true });
const files = [];
const emit = async (target, contents) => {
  const file = path.join(output, target);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  files.push(target);
};
for (const [target, contents] of await renderSite(root))
  await emit(target, contents);
for (const [target, source] of staticFiles)
  await emit(target, await readFile(path.join(root, source)));

await validateDocumentationBundle(output, files, { fragments: true });
const css = await readFile(path.join(output, "assets/docs.css"), "utf8");
for (const [, url] of css.matchAll(/url\(([^)#]+)\)/g))
  if (!files.includes(path.posix.join("assets", url)))
    throw new Error(`docs.css: undeclared asset ${url}`);

const written = [];
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else written.push(path.relative(output, file).split(path.sep).join("/"));
  }
};
await walk(output);
const extra = written.filter((file) => !files.includes(file));
if (extra.length) throw new Error(`Undeclared output: ${extra.join(", ")}`);

// Each `files` entry is usable as-is in an Overto site manifest; the wrapper
// fields describe where this inventory belongs and are not part of that request.
const mediaTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};
const manifest = {
  schemaVersion: 1,
  project: "flow-landing",
  slug: "docs",
  url: docsUrl,
  directory: "website/build/docs",
  entry: "index.html",
  files: [],
};
for (const file of [...files].sort()) {
  const bytes = await readFile(path.join(output, file));
  if (/\.(?:html|js|json)$/.test(file) && /\/(?:Users|home)\/[^/\s]+\//.test(bytes))
    throw new Error(`${file}: contains a machine-specific path`);
  const mediaType = mediaTypes[path.posix.extname(file).toLowerCase()];
  if (!mediaType) throw new Error(`${file}: no declared media type`);
  manifest.files.push({
    path: file,
    mediaType,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  path.join(build, "docs.manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    output: manifest.directory,
    entry: manifest.entry,
    manifest: "website/build/docs.manifest.json",
    pages: files.filter((file) => file.endsWith(".html")).length,
    files: files.length,
  }),
);
