import React from "react";
import { reasoningLabel } from "../../shared/reasoning.mjs";

export function ThinkingDial({
  value,
  onChange,
  levels = ["low", "medium", "high", "xhigh"],
}) {
  const choices = ["inherit", ...levels],
    index = Math.max(0, choices.indexOf(value));
  return (
    <div className="agent-thinking-dial">
      <label>
        <span>
          Thinking <strong>{reasoningLabel(choices[index])}</strong>
        </span>
        <input
          type="range"
          aria-label="Thinking level"
          aria-valuetext={reasoningLabel(choices[index])}
          min="0"
          max={choices.length - 1 || 1}
          step="1"
          value={index}
          disabled={!levels.length}
          onChange={(event) => onChange(choices[Number(event.target.value)])}
        />
      </label>
      <button
        type="button"
        className={index === 0 ? "is-active" : ""}
        aria-label="Use provider default thinking level"
        aria-pressed={index === 0}
        onClick={() => onChange("inherit")}
      >
        Auto
      </button>
      {!levels.length && <small>Provider default</small>}
    </div>
  );
}
