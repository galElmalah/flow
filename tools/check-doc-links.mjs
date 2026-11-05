import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Check file destinations against Git's public source inventory, including new files.
export function missingMarkdownLinks(markdown, filename, tracked) {
  const text = markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
  const links =
    /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)|^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm;
  const failures = [];
  for (const match of text.matchAll(links)) {
    const destination = (match[1] || match[2]).replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(destination)) continue;
    const target = decodeURIComponent(destination.split(/[?#]/)[0]);
    if (!target) continue;
    const resolved = path.posix.normalize(
      target.startsWith("/")
        ? target.slice(1)
        : path.posix.join(path.posix.dirname(filename), target),
    );
    if (
      !tracked.has(resolved) &&
      ![...tracked].some((file) => file.startsWith(`${resolved}/`))
    ) {
      failures.push(`${filename}: missing tracked link target ${destination}`);
    }
  }
  return failures;
}

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const tracked = new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root },
    )
      .toString()
      .split("\0")
      .filter(Boolean),
  );
  const docs = [...tracked].filter((file) => file.endsWith(".md"));
  const failures = [];
  for (const file of docs) {
    const markdown = await readFile(path.join(root, file), "utf8");
    failures.push(...missingMarkdownLinks(markdown, file, tracked));
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Markdown file links passed for ${docs.length} source documents. External URLs and heading anchors are not checked.`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
