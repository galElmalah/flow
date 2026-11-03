#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { FlowClient } from "../client/index.mjs";

// QA sheets only: original reference images stay untouched.
const client = new FlowClient();
const { styles, categories } = await client.styles();
const directory = path.resolve(
  import.meta.dirname,
  "../docs/qa/style-library/sheets",
);
await mkdir(directory, { recursive: true });
const xml = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const sheets = [];
for (const category of categories) {
  const ready = styles.filter(
    (style) => style.category === category && style.references.length,
  );
  if (!ready.length) continue;
  const composites = [];
  for (const [index, style] of ready.entries()) {
    const response = await client.response(style.references[0].url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const thumb = await sharp(bytes)
      .resize(240, 240, { fit: "contain", background: "#151515" })
      .png()
      .toBuffer();
    const left = (index % 3) * 256 + 8,
      top = Math.floor(index / 3) * 280 + 8;
    composites.push({ input: thumb, left, top });
    const label = Buffer.from(
      `<svg width="240" height="24"><text x="0" y="17" font-family="Arial" font-size="12" fill="white">${xml(style.name)}</text></svg>`,
    );
    composites.push({ input: label, left, top: top + 244 });
  }
  const file = path.join(
    directory,
    category.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".png",
  );
  await sharp({
    create: {
      width: 768,
      height: Math.ceil(ready.length / 3) * 280,
      channels: 3,
      background: "#151515",
    },
  })
    .composite(composites)
    .png()
    .toFile(file);
  console.log(`${category}: ${ready.length} actual references → ${file}`);
  sheets.push({ category, file, count: ready.length });
}
if (process.argv.includes("--overview")) {
  if (sheets.reduce((total, sheet) => total + sheet.count, 0) !== styles.length)
    throw new Error(
      "Every style needs a reference before exporting the full overview.",
    );
  const composites = [];
  const rowHeight =
    Math.max(
      ...(await Promise.all(
        sheets.map(
          async (sheet) => (await sharp(sheet.file).metadata()).height,
        ),
      )),
    ) + 60;
  for (const [index, sheet] of sheets.entries()) {
    const left = (index % 4) * 768,
      top = Math.floor(index / 4) * rowHeight;
    const header = Buffer.from(
      `<svg width="768" height="60"><text x="12" y="38" font-family="Arial" font-size="26" fill="white">${xml(sheet.category)} · ${sheet.count} styles</text></svg>`,
    );
    composites.push({ input: header, left, top });
    composites.push({ input: sheet.file, left, top: top + 60 });
  }
  const file = path.resolve(directory, "../all-styles.jpg");
  await sharp({
    create: {
      width: 3072,
      height: Math.ceil(sheets.length / 4) * rowHeight,
      channels: 3,
      background: "#151515",
    },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(file);
  console.log(`Full style library → ${file}`);
}
