import React, { useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";

export function PromptValue({ title, value, open = false }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!value) return null;
  return (
    <details className="tray-prompt" open={open}>
      <summary>{title}</summary>
      <button
        className="tray-copy"
        aria-label={`Copy ${title}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopyError("");
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1600);
          } catch {
            setCopied(false);
            setCopyError(
              "Could not copy. Select the prompt below and copy it manually.",
            );
          }
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
      {copyError && (
        <p className="tray-help" role="alert">
          {copyError}
        </p>
      )}
      <pre>{value}</pre>
    </details>
  );
}
