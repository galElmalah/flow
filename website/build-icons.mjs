// Generate app, website and repository branding from the approved Liquid wordmark.
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const mark = await readFile(path.join(root, 'public/branding/flow-liquid.svg'), 'utf8');
const dimensions = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(mark);
if (!dimensions) throw new Error('The brand master needs a zero-origin SVG viewBox.');
const [, width, height] = dimensions;
const source = mark.replace(/(<svg\b[^>]*>)/, `$1<rect width="${width}" height="${height}" rx="${Math.min(Number(width), Number(height)) * 0.175}" fill="#070708"/>`);
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(size => sharp(Buffer.from(source)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const entry = 6 + 16 * index;
  header[entry] = header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
const icon = Buffer.concat([header, ...frames]);
for (const directory of ['public', 'website/docs/assets', 'website/landing/site/assets']) {
  await writeFile(path.join(root, directory, 'favicon.svg'), source);
  await writeFile(path.join(root, directory, 'favicon.ico'), icon);
  if (directory !== 'public') await writeFile(path.join(root, directory, 'flow-liquid.svg'), mark);
  for (const [name, size] of [['favicon.png', 32], ['apple-touch-icon.png', 180]])
    await sharp(Buffer.from(source)).resize(size, size).png().toFile(path.join(root, directory, name));
}
await sharp(Buffer.from(mark)).resize(128, 128).flatten({ background: '#070708' }).png().toFile(path.join(root, 'public/branding/flow-liquid.png'));
console.log('Generated Liquid branding for the app, websites, README and browser icons.');
