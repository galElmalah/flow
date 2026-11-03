import React, { useEffect, useRef, useState } from "react";

export function RegionLabel({ region, busy, onRename }) {
  const [value, setValue] = useState(region.label);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setValue(region.label);
  }, [region.label]);
  return (
    <input
      aria-label={`Layer name ${region.label}`}
      value={value}
      disabled={busy || region.locked}
      maxLength={120}
      onChange={(event) => {
        dirty.current = true;
        setValue(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.stopPropagation();
          dirty.current = false;
          setValue(region.label);
          event.currentTarget.blur();
        }
      }}
      onBlur={async () => {
        if (!value.trim() || value === region.label) {
          dirty.current = false;
          setValue(region.label);
        } else if (dirty.current) {
          const saved = await onRename(value.trim());
          if (saved) {
            dirty.current = false;
            setValue(
              saved.regions.find((r) => r.id === region.id)?.label || value,
            );
          }
        }
      }}
    />
  );
}
