import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function downloadCheckpoint(
  url,
  file,
  onProgress,
  fetchFile = fetch,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchFile(url);
      if (!response.ok || !response.body)
        throw new Error(`Model download failed (${response.status}).`);
      const totalBytes = Number(response.headers.get("content-length")) || null;
      let downloadedBytes = 0,
        reported = 0;
      const report = () =>
        onProgress({
          downloadedBytes,
          totalBytes,
          percent: totalBytes
            ? Math.min(100, (downloadedBytes / totalBytes) * 100)
            : null,
        });
      report();
      await pipeline(
        Readable.fromWeb(response.body),
        new Transform({
          transform(chunk, encoding, callback) {
            downloadedBytes += chunk.length;
            if (Date.now() - reported > 150) {
              report();
              reported = Date.now();
            }
            callback(null, chunk);
          },
        }),
        createWriteStream(file),
      );
      if (totalBytes && downloadedBytes !== totalBytes)
        throw new Error("Model download was incomplete.");
      report();
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}
