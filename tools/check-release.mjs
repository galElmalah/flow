import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root }).toString().split("\0").filter(Boolean))];
const failures = [];
const forbidden = /(^|\/)(?:\.weft|node_modules|dist|\.venv)(\/|$)|^docs\/(?:qa|screenshots|benchmarks)\/|^examples\/(?:sports-agent|salt-speed)\/|^examples\/quoture\/(?!shared-workflow\.mjs$|README\.md$)|(^|\/)\.weft-project\.json$|\.(?:sqlite(?:-\w+)?|db(?:-\w+)?|safetensors|ckpt|gguf|pt|pth|onnx|pem|key)$|(^|\/)\.env(?:\.(?!example$).*)?$/;
const credentials = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{32,}|github_pat_[A-Za-z0-9_]{50,})\b/,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/,
  /\bAIza[A-Za-z0-9_-]{35}\b/,
  /\bxai-[A-Za-z0-9]{40,}\b/,
];

for (const file of files) {
  if (forbidden.test(file)) failures.push(`${file}: private data or generated files cannot be committed`);
  const info = await stat(path.join(root, file)).catch(() => null);
  if (!info?.isFile()) continue;
  if (info.size > 10 * 1024 * 1024) failures.push(`${file}: files above 10 MB require a separate asset review`);
  const data = await readFile(path.join(root, file));
  if (data.includes(0)) continue;
  const text = data.toString("utf8");
  if (credentials.some((pattern) => pattern.test(text))) failures.push(`${file}: possible credential; remove it and rotate it if real`);
  if (/\/(?:Users|home)\/[^/\s]+\/|\/var\/folders\//.test(text)) failures.push(`${file}: replace machine-specific paths with portable examples`);
}

for (const required of ["LICENSE", "CONTRIBUTING.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md", ".github/workflows/ci.yml"]) {
  if (!files.includes(required)) failures.push(`${required}: required release preparation file is missing`);
}

const sentinels = [".weft/connections.json", ".env.local", "examples/demo/.weft-project.json", "model.safetensors", "workspace.sqlite", "docs/qa/private-run.json"];
const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: root, input: sentinels.join("\n") + "\n" }).toString().trim().split("\n");
for (const sentinel of sentinels) if (!ignored.includes(sentinel)) failures.push(`${sentinel}: add a gitignore rule before uploading source`);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log(`Release file checks passed for ${files.length} source files. This is not a complete secret or license audit.`);
