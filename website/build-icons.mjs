// Regenerate browser and touch icons from the shared Flow mark.
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const source = await readFile(path.join(root, 'website/docs/assets/favicon.svg'));
for (const directory of ['website/docs/assets', 'website/landing/site/assets']) {
  await writeFile(path.join(root, directory, 'favicon.svg'), source);
  for (const [name, size] of [['favicon.png', 32], ['apple-touch-icon.png', 180]])
    await sharp(source, { density: 576 }).resize(size, size).png().toFile(path.join(root, directory, name));
}
console.log('Generated matching SVG, PNG and Apple touch icons for both sites.');
