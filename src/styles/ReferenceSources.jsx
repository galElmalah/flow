import React from "react";
import { ArrowUpRight, Globe } from "lucide-react";

export function ReferenceSources({ sources = [], compact = false }) {
  if (!sources.length) return null;
  return (
    <details className={`style-sources ${compact ? "is-compact" : ""}`}>
      <summary>
        <Globe size={14} />
        {compact ? "Related references" : "Web references"}
        <span>{sources.length}</span>
      </summary>
      <div className="style-source-grid">
        {sources.map((source) => (
          <article key={source.id}>
            <small>{source.group}</small>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.name}
              <ArrowUpRight size={14} />
            </a>
            <p>{source.description}</p>
            <p className="style-source-reuse">{source.reuse}</p>
            {source.policyUrl && (
              <a
                className="style-source-policy"
                href={source.policyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Source terms <ArrowUpRight size={11} />
              </a>
            )}
          </article>
        ))}
      </div>
    </details>
  );
}
