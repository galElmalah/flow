import React, { useState } from "react";
import { Copy, Check, FolderOpen } from "lucide-react";

export function ProjectLocation({ path }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  if (!path) return null;
  return (
    <div className="project-location">
      <span>
        <FolderOpen size={13} /> Local folder
      </span>
      <code title={path}>{path}</code>
      <button
        type="button"
        aria-label="Copy project folder path"
        title={copied ? "Copied" : "Copy folder path"}
        onClick={async (event) => {
          event.stopPropagation();
          try {
            await navigator.clipboard.writeText(path);
            setCopied(true);
            setError("");
          } catch {
            setError("Could not copy. Select the path to copy it.");
          }
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy"}
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
