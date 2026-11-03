import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { AssetDetails } from "./AssetDetails.jsx";
import { useAssetLineage } from "../media/useAssetLineage.mjs";
import { assetImage, assetLabel } from "../../shared/asset-inspection.mjs";

// Inspect parents without changing the image being edited or its unsaved comments.
export function AssetLineagePanel({ image }) {
  const [trail, setTrail] = useState([]);
  const current = trail.at(-1) || image;
  const state = useAssetLineage(current);
  const panel = useRef(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "start" });
  }, [current.output]);
  return (
    <section
      className="embedded-image-lineage"
      ref={panel}
      aria-label="Image source lineage"
    >
      {trail.length > 0 && (
        <>
          <button
            className="tray-lineage-back"
            onClick={() => setTrail((items) => items.slice(0, -1))}
          >
            <ChevronLeft size={14} />
            Back to previous source
          </button>
          <img
            className="lineage-source-preview"
            src={current.output}
            alt={
              state.lineage
                ? assetLabel(state.lineage.asset)
                : "Selected source"
            }
          />
        </>
      )}
      <AssetDetails
        image={current}
        lineageState={state}
        onInspect={(asset) =>
          setTrail((items) => [...items, assetImage(asset)])
        }
      />
    </section>
  );
}
