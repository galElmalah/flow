import React, { useContext } from "react";
import { Image as ImageIcon, Upload, Maximize } from "lucide-react";
import { StudioContext } from "../studio/context.jsx";
import { cls } from "../studio/ui.mjs";
import { accents } from "./catalog.mjs";
import { Header, Socket } from "./NodeChrome.jsx";
export function SeedNode({ id, data, selected }) {
  const { uploadImages, openImage, readOnly } = useContext(StudioContext);
  const image = data.images?.[0];
  const references = (data.images || []).map((output, index) => ({
    id: `${id}-reference-${index}`,
    output,
    label: data.label,
  }));
  const inspect = (event) => {
    event.stopPropagation();
    if (image) openImage({ ...references[0], collection: references });
  };
  const filename =
    image?.split(/[?#]/)[0].split("/").pop() || "Reference image";
  return (
    <div
      className={cls("studio-node seed-node", selected && "is-selected")}
      style={{ "--accent": accents.image }}
    >
      <Header id={id} type="image" label={data.label} />
      <div
        className="node-image-wrap nodrag"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {image ? (
          <>
            <button
              className="node-image-open"
              aria-label={`Inspect ${data.label} image lineage`}
              onClick={inspect}
            >
              <img src={image} alt="Seed reference" />
            </button>
            <button
              className="image-expand"
              title="View reference"
              onClick={inspect}
            >
              <Maximize size={14} />
            </button>
          </>
        ) : (
          <button
            className="upload-empty"
            disabled={readOnly}
            onClick={() => uploadImages(id)}
          >
            <Upload size={26} />
            <span>Upload a reference</span>
            <small>PNG, JPG or WebP · up to 32 MB</small>
          </button>
        )}
      </div>
      <div className="seed-file">
        <ImageIcon size={13} />
        <span title={image ? filename : undefined}>
          {image ? filename.slice(0, 22) : "No image added"}
        </span>
        {data.images?.length > 1 && (
          <span className="file-tag">+{data.images.length - 1}</span>
        )}
      </div>
      <button
        className="replace-image nodrag"
        disabled={readOnly}
        onClick={() => uploadImages(id)}
      >
        <Upload size={13} /> {image ? "Replace image" : "Upload image"}{" "}
        <span>↥</span>
      </button>
      <Socket type="image" kind="source" top={156} label="Image" />
    </div>
  );
}
