import { open, stat } from "node:fs/promises";
export async function verifyImage(file) {
  const size = (await stat(file)).size;
  if (size < 64 || size > 64 * 1024 * 1024)
    throw new Error("The harness did not produce a valid image file.");
  const f = await open(file, "r");
  const buf = Buffer.alloc(16);
  try {
    await f.read(buf, 0, 16, 0);
  } finally {
    await f.close();
  }
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "png";
  if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return "jpg";
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  throw new Error("The harness output is not a PNG, JPEG, or WebP image.");
}
