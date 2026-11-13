import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { builtInStyles } from "../shared/styles/catalog.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "docs", "launch");
await mkdir(output, { recursive: true });
const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const files = execFileSync("git", ["ls-files", "-z", "public", "docs/images"], {
  cwd: root,
})
  .toString()
  .split("\0")
  .filter((file) => /\.(png|jpg|svg|woff2)$/.test(file));
const assets = await Promise.all(
  files.map(async (file) => {
    const bytes = await readFile(path.join(root, file));
    const terms = file.startsWith("public/fonts/")
      ? "SIL OFL 1.1; included font notice"
      : file.startsWith("public/harnesses/")
        ? "Lobe Icons MIT; included notice; trademarks remain their owners'"
        : file === "public/assets/paper-seed.png"
          ? "Generation/reference provenance incomplete; public release clearance pending"
          : file.startsWith("docs/images/")
            ? "Owner-selected product capture; public clearance of depicted media pending"
            : "Flow MIT";
    return {
      path: file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      terms,
    };
  }),
);
await writeFile(
  path.join(output, "assets.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      scope:
        "Tracked visual assets only; no local gallery, credentials, model weights or generated runs",
      assets,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(output, "styles.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      license: "MIT",
      imagePreviewsBundled: false,
      styles: builtInStyles,
    },
    null,
    2,
  ) + "\n",
);
const categories = new Set(builtInStyles.map((style) => style.category));
const additions = builtInStyles.slice(216);
const rows = additions
  .map(
    (style) =>
      `<tr><td>${escape(style.name)}</td><td>${escape(style.category)}</td><td>${escape(style.description)}</td></tr>`,
  )
  .join("\n");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flow — open-source release explainer</title><meta name="description" content="Flow: local visual workflows, installable CLI, JavaScript SDK and agent tools. Release review and bundled asset inventory.">
<style>
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#222;background:#fff;font-size:16px;line-height:1.65}*{box-sizing:border-box}body{margin:0}main{max-width:880px;margin:auto;padding:48px 24px 64px}header{max-width:680px}h1{font-size:44px;letter-spacing:-.04em;margin:0 0 8px;line-height:1.15}h2{font-size:23px;font-weight:600;margin:36px 0 12px}p{margin:8px 0 16px}a{color:inherit;text-underline-offset:4px}a:focus-visible,summary:focus-visible{outline:2px solid #686868;outline-offset:4px}.meta,figcaption{color:#686868;font-size:13px}.lead{font-size:19px;line-height:1.5}figure{margin:24px 0}img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid #dededb}figcaption{margin-top:8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.pair figure{margin:0}pre{background:#fafafa;border:1px solid #dededb;border-radius:6px;padding:16px;overflow-x:auto;line-height:1.55;font-size:13px}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}p code,li code{font-size:.9em;background:#fafafa}ul{padding-left:22px}li{margin:8px 0}.path{font-size:15px;word-spacing:6px;color:#686868;border-block:1px solid #dededb;padding:16px 0;margin:24px 0}details{margin:20px 0}summary{cursor:pointer;text-decoration:underline;text-underline-offset:4px}.table-wrap{max-height:380px;overflow:auto;margin-top:16px;border-block:1px solid #dededb}table{border-collapse:collapse;width:100%;font-size:13px}th{text-align:left;position:sticky;top:0;background:#fff}td,th{padding:10px 12px;border-bottom:1px solid #dededb;vertical-align:top}footer{border-top:1px solid #dededb;padding-top:20px;margin-top:40px;font-size:13px;color:#686868}button{font:inherit} @media(max-width:600px){main{padding:28px 18px}h1{font-size:36px}.pair{grid-template-columns:1fr}pre{font-size:12px}.path{word-spacing:0}}
</style></head><body><main>
<header><p class="meta">Flow · release preparation · November 13, 2026</p><h1>A local canvas.<br>Built for you and your agents.</h1><p class="lead">Connect seed images, shared instructions and named scenes. Generate parallel image, GIF or video batches, then inspect every output's prompt, inputs and lineage.</p><p><a href="https://github.com/galElmalah/flow">Repository</a> · <a href="https://github.com/galElmalah/flow/blob/main/docs/installation.md">CLI / SDK guide</a> · <a href="https://github.com/galElmalah/flow/blob/main/docs/open-source-readiness.md">Release checklist</a></p></header>
<figure><img src="../images/helmet-campaign.jpg" width="2469" height="1049" alt="SALT / SPEED campaign on the real Flow canvas, connecting shared prompts to helmet, vehicle, clothing and action scenes"><figcaption>Real Flow campaign. A shared art direction branches into scenes and one collection.</figcaption></figure>
<p class="path">Seed + direction → Prompt Set → provider → collection</p>
<h2>Clone once. Use it from any project.</h2><p>Node.js 22.13+ and npm, on macOS or Linux. No Flow account is needed. Setup installs a user-level executable and agent skills; it does not configure providers, start paid inference or download weights.</p>
<pre><code>git clone https://github.com/galElmalah/flow.git
cd flow
npm ci
npm run setup
npm run verify:setup
export PATH="$HOME/.local/bin:$PATH"
flow --version
flow serve
flow open --projects</code></pre>
<p>The <code>flow</code> command points to your checkout. Keep it in place. To upgrade, update that checkout and rerun <code>npm ci</code> and <code>npm run setup</code>. To switch clones, uninstall the old launcher first. Foreign commands are preserved. <code>npm run cli:uninstall</code> removes only this launcher's symlink.</p>
<h2>One platform, three agent interfaces.</h2><p><strong>CLI:</strong> discover → create or fork → plan → run → wait → inspect. <strong>SDK:</strong> the same services from JavaScript. <strong>MCP:</strong> discoverable tools for agent hosts. The repository includes <code>AGENTS.md</code> and managed workflow, style-library and image-editing skills.</p>
<pre><code># In a consuming Node.js project:
npm install --save /absolute/path/to/flow</code></pre>
<pre><code>import { FlowClient } from "flow";
import { builtInStyles } from "flow/styles";

const flow = new FlowClient({ url: "http://localhost:4310" });
console.log(await flow.projects(), builtInStyles.length);</code></pre>
<p><a href="https://github.com/galElmalah/flow/blob/main/AGENTS.md">Give an agent AGENTS.md</a>. It explains project ownership, versioned <code>.flow.json</code> files, provider checks, planned counts, run IDs and saved lineage.</p>
<h2>Real product assets, included.</h2><div class="pair"><figure><img loading="lazy" src="../images/region-comment.jpg" width="1778" height="1235" alt="A selected white cycling jersey with the inline instruction Make it pink"><figcaption>Select a named region and comment on it.</figcaption></figure><figure><img loading="lazy" src="../images/pink-jersey-result.jpg" width="1778" height="1235" alt="The pink jersey result with retained regions and version history"><figcaption>Local recoloring preserves the surrounding scene.</figcaption></figure></div>
<details><summary>See the original helmet seed and its workflow</summary><figure><img loading="lazy" src="../images/helmet-seed-workflow.jpg" width="2000" height="1100" alt="Original helmet reference connected to the campaign workflow"><figcaption>The seed remains visible alongside the generated work.</figcaption></figure></details>
<p><strong>${builtInStyles.length} built-in style briefs in ${categories.size} families.</strong> Three Astra agents researched ${additions.length} additions, including pointillism, cameo glass, ikat, double exposure, manga screentones and pinscreen animation. Each keeps its rendering prompt separate from its scene.</p>
<p><a href="styles.json" download>Download the complete style catalog</a> · <a href="assets.json" download>Download the asset hashes and terms</a></p><p class="meta">The four selected product captures are in this report and the repository. New style-preview images have not been generated. Personal galleries, credentials, run exports and model weights are excluded.</p>
<details><summary>Browse all ${additions.length} new styles</summary><div class="table-wrap" tabindex="0" role="region" aria-label="New style briefs"><table><thead><tr><th>Style</th><th>Family</th><th>Visual treatment</th></tr></thead><tbody>${rows}</tbody></table></div></details>
<h2>MIT source. No Flow license fee.</h2><p>Use, modify, redistribute, sublicense or sell Flow code and its style briefs, including commercially. Retain the copyright and MIT license notice. Fonts, provider marks, dependencies and downloaded models keep their own terms. API usage can cost money; a Flow license does not include inference credits.</p>
<h2>Release review</h2><p>Astra independently reviewed code, setup, licensing and tracked assets. Current checks exercise build, behavioral tests, isolated local processing, SDK imports, CLI installation and MCP discovery. The repository remains private while these public-release decisions are outstanding:</p><ul><li><strong>Historical assets:</strong> the original paper fixture and former Pi mark need clearance or a reviewed history/snapshot release plan. Old demo workspace IDs also remain in Git history.</li><li><strong>Depicted media:</strong> the owner-selected screenshots are approved for this private report; public redistribution of their artwork and references still needs clearance.</li><li><strong>Release commit:</strong> check the final CI and full-history secret scan, then make an explicit decision to change repository visibility.</li></ul>
<p>Flow binds to loopback for a trusted local user. Windows and self-contained native binaries are not claimed. Model downloads and live-provider entitlement tests are separate from source setup.</p>
<footer><a href="https://github.com/galElmalah/flow/blob/main/LICENSE">MIT license</a> · <a href="https://github.com/galElmalah/flow/blob/main/THIRD_PARTY_NOTICES.md">Third-party notices</a> · <a href="https://github.com/galElmalah/flow/blob/main/docs/asset-provenance.md">Asset provenance</a><p>Build this report from tracked source with <code>node tools/build-explainer.mjs</code>. It reads no local workspace database.</p></footer>
</main></body></html>`;
const linkedHtml = html.replace(
  /(<img[^>]+src="([^"]+)"[^>]*>)/g,
  (_, tag, src) =>
    `<a href="${src}" target="_blank" rel="noopener" title="Open full-resolution image">${tag}</a>`,
);
await writeFile(path.join(output, "index.html"), linkedHtml);
console.log(
  JSON.stringify({
    report: "docs/launch/index.html",
    styles: builtInStyles.length,
    additions: additions.length,
    assets: assets.length,
  }),
);
