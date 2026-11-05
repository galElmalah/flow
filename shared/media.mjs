const artifacts = {
  image: { basename: "output.png", mimeType: "image/png", extension: "png" },
  video: { basename: "output.mp4", mimeType: "video/mp4", extension: "mp4" },
  text: { basename: "output.txt", mimeType: "text/plain", extension: "txt" },
};
export const mediaKind = (job) => job?.kind || "image";
export const isMediaJob = (job) => ["image", "video"].includes(mediaKind(job));
export const imageMimeType = (format) =>
  ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
  })[format];
export function mediaArtifact(value) {
  const kind = typeof value === "string" ? value : mediaKind(value);
  if (kind === "image" && typeof value !== "string") {
    const format = value.metadata?.outputFormat || "png";
    if (!imageMimeType(format))
      throw new Error(`Unsupported image artifact: ${format}`);
    return {
      basename: `output.${format}`,
      mimeType: imageMimeType(format),
      extension: format,
    };
  }
  const artifact = artifacts[kind];
  if (!artifact) throw new Error(`Unsupported output kind: ${kind}`);
  return artifact;
}
export const editableImage = (item) =>
  mediaKind(item) === "image" &&
  !/\.(gif|svg)(?:$|[?#])/i.test(item?.output || item?.url || "");
export const generationKind = (type) =>
  ({ generate: "image", "prompt-generate": "text", "video-generate": "video" })[
    type
  ] || null;
