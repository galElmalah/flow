// Builds the public documentation site from repository Markdown:
//   npm run docs:build
// Output: website/build/docs/ (entry index.html) and website/build/docs.manifest.json.
// Reads no workspace database, credentials, models or private reports.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildDocumentation,
  documentationImages,
  validateDocumentationBundle,
} from "./lib/docs-site.mjs";
import {
  docsUrl,
  publicDocumentSources,
  publicLayout,
} from "./lib/public-docs.mjs";

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
const images = documentationImages.map((name) => `docs/images/${name}`);
for (const source of [...publicDocumentSources, ...images])
  if (!repositoryFiles.has(source))
    throw new Error(`${source}: not a public repository file`);
const pages = publicDocumentSources.map(publicLayout.page);
if (new Set(pages.map((page) => page.toLowerCase())).size !== pages.length)
  throw new Error("Two documents map to the same page path");

await rm(output, { recursive: true, force: true });
const files = await buildDocumentation(
  root,
  output,
  publicDocumentSources,
  publicLayout,
);
await mkdir(path.join(output, "images"), { recursive: true });
for (const image of images) {
  const target = `images/${path.posix.basename(image)}`;
  await copyFile(path.join(root, image), path.join(output, target));
  files.push(target);
}
await validateDocumentationBundle(output, files);

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
  ".jpg": "image/jpeg",
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
  if (/\.html$/.test(file) && /\/(?:Users|home)\/[^/\s]+\//.test(bytes))
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
