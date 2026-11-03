import React from "react";
import { mediaKind } from "../../shared/media.mjs";

export function MediaPreview({
  item,
  alt = "Generated output",
  controls = false,
  className,
  ...props
}) {
  return mediaKind(item) === "video" ? (
    <video
      className={className}
      src={item.output}
      controls={controls}
      playsInline
      preload="metadata"
      aria-label={alt}
      {...props}
    />
  ) : (
    <img
      className={className}
      src={item.output}
      alt={alt}
      loading="lazy"
      {...props}
    />
  );
}
