const artifacts = {
  image: { basename: "output.png", mimeType: "image/png", extension: "png" },
  video: { basename: "output.mp4", mimeType: "video/mp4", extension: "mp4" },
  text: { basename: "output.txt", mimeType: "text/plain", extension: "txt" },
};
export const mediaKind = (job) => job?.kind || "image";
export const isMediaJob = (job) => ["image", "video"].includes(mediaKind(job));
export function mediaArtifact(kind) {
  const artifact = artifacts[kind];
  if (!artifact) throw new Error(`Unsupported output kind: ${kind}`);
  return artifact;
}
export const generationKind = (type) =>
  ({ generate: "image", "prompt-generate": "text", "video-generate": "video" })[
    type
  ] || null;
