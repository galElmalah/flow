import path from "node:path";
import { realpathSync } from "node:fs";
import { mediaKind } from "../shared/media.mjs";

function confinedFile(root, directory, relative) {
  const base = path.join(realpathSync(root), directory);
  const target = path.resolve(root, directory, relative);
  if (!realpathSync(target).startsWith(base + path.sep))
    throw new Error("Invalid image path.");
  return target;
}

export function createAssetPath({ root, dataRoot, store }) {
  return function assetPath(url) {
    // Asset references are canonical workspace URLs, not encoded filesystem paths.
    if (
      typeof url !== "string" ||
      /[%\\?#\u0000-\u001f]/.test(url) ||
      url.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error("Invalid image path.");
    const asset = /^\/assets\/([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*)$/.exec(
      url,
    );
    if (asset) return confinedFile(root, "public/assets", asset[1]);
    const upload =
      /^\/files\/uploads\/([a-zA-Z0-9_-]+\.(?:png|jpe?g|webp))$/.exec(url);
    if (upload) return confinedFile(dataRoot, "uploads", upload[1]);
    const generated =
      /^\/files\/runs\/([a-f0-9-]+)\/([a-f0-9-]+)\/(output\.(?:png|jpeg|webp|gif|svg)|original-attempt-\d+\.(?:png|jpg|webp|gif|svg)|input-\d+\.(?:png|jpe?g|webp))$/.exec(
        url,
      );
    if (generated) {
      const run = store.runs.get(generated[1]),
        job = run?.jobs.find((job) => job.id === generated[2]),
        name = generated[3];
      const final =
        job?.status === "completed" &&
        mediaKind(job) === "image" &&
        job.output === url;
      const original =
        job?.status === "completed" &&
        mediaKind(job) === "image" &&
        job.metadata?.originalFile === name;
      const input = job?.lineage?.inputs.find(
        (ref) => ref.snapshotFile === name && ref.snapshotAssetId,
      );
      const captured = input && store.assetRecord(input.snapshotAssetId);
      if (
        final ||
        original ||
        (captured?.kind === "image" && captured.url === url)
      )
        return confinedFile(dataRoot, "runs", generated.slice(1).join("/"));
    }
    const editor =
      /^\/files\/editors\/([a-f0-9]{32})\/([a-zA-Z0-9-]+\.png)$/.exec(url);
    if (editor)
      return confinedFile(dataRoot, "editors", editor.slice(1).join("/"));
    throw new Error("Images must be uploaded to this local workspace.");
  };
}
