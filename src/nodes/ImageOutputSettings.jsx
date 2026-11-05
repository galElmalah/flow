import React from "react";
import { Autocomplete } from "../components/Autocomplete.jsx";

export function ImageOutputSettings({
  detail,
  image = {},
  index,
  readOnly,
  onChange,
}) {
  const formats = detail?.outputFormats || ["png"];
  const format = image.outputFormat || "png";
  const patch = (values) => onChange({ ...image, ...values });
  return (
    <>
      {(formats.length > 1 || format !== "png") && (
        <label>
          Output format
          <Autocomplete
            label={`Output format for mode ${index + 1}`}
            value={format}
            options={formats.map((value) => ({
              value,
              label: value === "gif" ? "GIF · animated" : value.toUpperCase(),
            }))}
            disabled={readOnly}
            onChange={(outputFormat) => {
              const next = { ...image, outputFormat };
              if (outputFormat !== "gif") {
                delete next.frameCount;
                delete next.frameDurationMs;
              }
              if (!["png", "webp"].includes(outputFormat))
                delete next.background;
              onChange(next);
            }}
          />
        </label>
      )}
      {format === "gif" && (
        <>
          <label>
            Frames
            <input
              type="number"
              min="2"
              max="16"
              aria-label={`GIF frames for mode ${index + 1}`}
              value={image.frameCount || 9}
              readOnly={readOnly}
              onChange={(event) =>
                patch({
                  frameCount: Math.max(
                    2,
                    Math.min(16, Math.round(Number(event.target.value) || 9)),
                  ),
                })
              }
            />
          </label>
          <label>
            Frame delay · ms
            <input
              type="number"
              min="20"
              max="2000"
              step="10"
              aria-label={`GIF frame delay for mode ${index + 1}`}
              value={image.frameDurationMs || 200}
              readOnly={readOnly}
              onChange={(event) =>
                patch({
                  frameDurationMs: Math.max(
                    20,
                    Math.min(
                      2000,
                      Math.round(Number(event.target.value) / 10) * 10 || 200,
                    ),
                  ),
                })
              }
            />
          </label>
          <small>
            {detail?.animationMethod === "sprite-sheet"
              ? "Codex generates a sprite sheet; Flow assembles a looping GIF locally. References supported."
              : "Native GIF · text-only generation. References and region masks are not supported."}
          </small>
        </>
      )}
      {detail?.complexityLevels && (
        <label>
          Complexity
          <Autocomplete
            label={`Image complexity for mode ${index + 1}`}
            value={image.complexity || "default"}
            options={[
              { value: "default", label: "Model default" },
              ...detail.complexityLevels.map((value) => ({
                value,
                label: value,
              })),
            ]}
            disabled={readOnly}
            onChange={(value) => {
              const next = { ...image };
              if (value === "default") delete next.complexity;
              else next.complexity = value;
              onChange(next);
            }}
          />
        </label>
      )}
      {detail?.backgrounds && ["png", "webp"].includes(format) && (
        <label>
          Background
          <Autocomplete
            label={`Image background for mode ${index + 1}`}
            value={image.background || "auto"}
            options={detail.backgrounds.map((value) => ({
              value,
              label: value,
            }))}
            disabled={readOnly}
            onChange={(background) => patch({ background })}
          />
        </label>
      )}
    </>
  );
}
