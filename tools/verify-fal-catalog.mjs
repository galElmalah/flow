import assert from "node:assert/strict";
import { falModels } from "../shared/fal.mjs";

// Public schema reads only. This script never authenticates or submits inference.
const reports = await Promise.all(
  falModels.map(async (model) => {
    const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(model.id)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    assert.equal(
      response.status,
      200,
      `${model.id}: public schema unavailable`,
    );
    const spec = await response.json();
    const input = Object.values(spec.components?.schemas || {}).find(
      (s) =>
        s.properties?.prompt && !s.properties?.images && !s.properties?.video,
    );
    assert.ok(input, `${model.id}: input schema not found`);
    const fields = input.properties;
    const requiredFields = model.capabilities.includes("video")
      ? [
          "prompt",
          "duration",
          "resolution",
          "aspect_ratio",
          "generate_audio",
          "codec",
        ]
      : [
          "prompt",
          "image_size",
          "num_images",
          "output_format",
          "enable_safety_checker",
        ];
    if (model.videoModes?.[0] === "image")
      requiredFields.push("image_url", "end_image_url");
    if (model.maxImages > 2 || model.id.endsWith("/edit"))
      requiredFields.push("image_urls");
    if (model.seeded) requiredFields.push("seed");
    for (const field of requiredFields)
      assert.ok(fields[field], `${model.id}: missing input ${field}`);
    if (model.capabilities.includes("video")) {
      for (const resolution of model.videoResolutions)
        assert.ok(
          fields.resolution.enum.includes(resolution),
          `${model.id}: unsupported resolution ${resolution}`,
        );
      for (
        let n = model.durationSeconds.min;
        n <= model.durationSeconds.max;
        n++
      )
        assert.ok(
          fields.duration.enum.includes(String(n)),
          `${model.id}: unsupported duration ${n}`,
        );
      if (fields.aspect_ratio.enum)
        for (const ratio of model.ratios)
          assert.ok(
            fields.aspect_ratio.enum.includes(ratio),
            `${model.id}: unsupported ratio ${ratio}`,
          );
      assert.ok(
        fields.codec.enum.includes("H264"),
        `${model.id}: H264 unsupported`,
      );
    }
    return {
      model: model.id,
      status: "schema-verified",
      fields: requiredFields,
      source: url,
    };
  }),
);
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      inferenceSubmitted: false,
      models: reports,
    },
    null,
    2,
  ),
);
