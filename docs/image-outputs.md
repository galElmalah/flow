# Still images, GIFs and SVGs

Use **Image generation** (`generate`) → **Output collection** (`output`) for all image formats, including GIF. `kind` stays `image`; `image.outputFormat` selects the artifact. Use `video-generate` for movie clips. Canvas and inspector GIF previews animate. Downloads and run ZIPs preserve their bytes and extension.

## Codex subscription GIFs

The installed Codex image tool does not expose output-format, image-model or complexity parameters. Flow asks its built-in image generator for a sprite sheet, then extracts the cells in reading order and encodes a looping GIF locally. No second provider or separately billed API is invoked. Reference images can guide the sheet. Generated sheets can have alignment/content errors; inspect the animation before using it.

```sh
node cli/flow.mjs workflow create --project PROJECT_ID \
  --name "Mascot loop" --provider codex --model native \
  --prompt "A tiny astronaut waves, then returns to its starting pose. Fixed camera, seamless loop." \
  --output-format gif --frames 9 --frame-delay 200 --count 1 --json
node cli/flow.mjs plan --workflow WORKFLOW_ID --project PROJECT_ID --json
node cli/flow.mjs run --workflow WORKFLOW_ID --project PROJECT_ID --concurrency 4 --json
```

Creating/planning does not generate. Keep the returned run ID and use `wait RUN_ID` rather than resubmitting after a timeout. Add `--seed-image /absolute/reference.png` for a Codex reference. `--count` counts complete animations per scene/mode, not frames.

## GPT Image 2.6 API

Add an explicit OpenAI-compatible connection in **Settings → Providers**, base URL `https://api.openai.com/v1`, a private API key and image model `gpt-image-2.6-sunburst` or `gpt-image-2.6-flare`. Flow discovers format controls for those model IDs. Account/preview access is required; a Codex subscription does not grant API access. Testing `/models` does not verify GIF entitlement.

- **GIF:** native `output_format:gif`, `frame_count` and `frame_duration_ms` on `/images/generations`. Text-only; image edits cannot return GIF. Flow sends `size:auto` to respect animation pixel limits. Describe subject, motion and looping behavior in the prompt.
- **SVG:** native static vector output on `/images/generations`. Text-only. Flow validates a static SVG subset, rejects scripts/external resources, and serves vectors with a restrictive security policy. Unsupported SVG content fails instead of being embedded inline.
- **Complexity:** `low`, `medium`, `high`, separate from quality. Low can suit quick focused edits; high suits complex layouts. Omit for the model default. This is an API parameter, separate from the agent thinking dial.
- **Markup edits:** upload a separate transparent PNG and set `image.markup` to its local Flow URL. Connect the original image first, followed by any references. Flow sends the layer in the API's `markup` field, verifies oriented dimensions/transparency, and captures it as an annotation-map ancestor. Keep it separate from ordinary seeds and region masks. Source and layer are limited to 16,777,216 pixels. Existing SAM annotation-map references remain a separate edit flow.
- **Background:** auto, opaque, or transparent. Transparency requires PNG or WebP. Existing region-comment editing sends reference/annotation images for markup guidance; GIF/SVG are not region edit targets.

The API guide describes up to 64 GIF frames, while the create-image reference specifies 2–16. Flow uses their shared range **2–16**, delay **20–2000 ms in 10 ms steps**. Default: nine frames, 200 ms each. GIF results arrive complete; partial-image streaming is unsupported.

## Agent contract

Markup example: `createImageWorkflow({images:[sourceUrl],providerId:apiProviderId,model:"gpt-image-2.6-flare",prompt:"Recolor the circled vase blue and remove annotations.",image:{markup:transparentLayerUrl,complexity:"low"}})`. MCP `create_image_workflow` accepts the same image object. Upload both files through Flow first; the layer must differ from the source/references.

Discover `GET /api` → `imageOutputs`, `GET /api/schema/workflow`, and `GET /api/providers`. `modelDetails` advertises `outputFormats`, `animationMethod`, optional `complexityLevels` and `backgrounds`. Readiness checks authentication, not every model entitlement. Unsupported combinations fail preflight; Flow never switches billing paths or creates placeholders.

MCP `create_image_workflow`, JavaScript `createImageWorkflow()`, imports and graph updates accept this generator data:

```json
{
  "label": "Mascot loops",
  "providerId": "codex",
  "model": "native",
  "count": 2,
  "image": { "outputFormat": "gif", "frameCount": 9, "frameDurationMs": 200 }
}
```

For comparisons set `data.modes[].image` per mode. Nine frames × two copies means two jobs. Frame controls require GIF. PNG/JPEG/WebP remain valid references; GIF/SVG cannot silently become raster references or SAM targets.

Lineage captures prompts, references, requested settings, provider/model, original bytes, format, actual dimensions/frames/delays/duration/loop and `animationMethod` (`sprite-sheet` or `native`). Codex `native` selects its current engine; Flow does not claim a pinned Image 2.6 model or invent an unreported actual model. The sprite sheet stays as a provider-original ancestor. Asset JSONL exports carry this evidence for review/training.

Sources checked November 5, 2026: [Images 2.6 announcement](https://openai.com/index/introducing-images-2-6/), [generation guide](https://developers.openai.com/api/docs/guides/image-generation), [create-image reference](https://developers.openai.com/api/reference/resources/images/methods/generate). Codex controls were checked against the installed CLI tool schema and can change with future releases.
