import { falDefaults, falModel } from "../shared/fal.mjs";

export function createImageWorkflow({
  id = globalThis.crypto.randomUUID(),
  name = "Image studies",
  projectId,
  prompt = "",
  images = [],
  records,
  prompts,
  promptSetDefaults,
  template,
  providerId,
  model,
  promptProviderId,
  promptModel,
  promptInstructions,
  count = 1,
  seed = 42,
  ratio = "1:1",
  quality,
  image,
  modes,
} = {}) {
  if (prompts && records)
    throw new Error("Use a Prompt Set or records in this recipe, not both.");
  if (providerId === "fal-image")
    model ??= `bytedance/seedream/v5/flash/${images.length ? "edit" : "text-to-image"}`;
  const node = (id, type, x, y, data) => ({
    id,
    type,
    position: { x, y },
    data: { label: id, ...data },
  });
  const edge = (source, target, type = "text") => ({
    id: `${source}-${target}`,
    source,
    target,
    targetHandle: type,
  });
  const nodes = [
    node("prompt", "prompt", 0, images.length ? 420 : 320, {
      label: "Scenery direction",
      text: prompt,
    }),
    node("generate", "generate", 800, 0, {
      label: "Image generation",
      providerId,
      model,
      count,
      seed,
      ratio,
      quality:
        quality ??
        (providerId === "fal-image"
          ? "auto"
          : providerId === "grok-image"
            ? "medium"
            : "high"),
      ...(image || ["grok-image", "fal-image"].includes(providerId)
        ? { image: image || { resolution: "1k" } }
        : {}),
      ...(modes && {
        modes: modes.map((mode) => ({
          ...mode,
          count: mode.count ?? count,
          label: mode.label || mode.id,
          ...(mode.providerId === "fal-image"
            ? {
                quality: mode.quality || "auto",
                image: mode.image || { resolution: "1k" },
                model:
                  mode.model ||
                  `bytedance/seedream/v5/flash/${images.length ? "edit" : "text-to-image"}`,
              }
            : mode.providerId === "grok-image"
              ? {
                  quality: mode.quality || "medium",
                  image: mode.image || { resolution: "1k" },
                }
              : {}),
        })),
      }),
    }),
    node("output", "output", 1200, 0, { label: "Output collection" }),
  ];
  const target = promptProviderId ? "prompt-writer" : "generate";
  const edges = [edge("prompt", target), edge("generate", "output", "image")];
  if (promptProviderId) {
    nodes.push(
      node("prompt-writer", "prompt-generate", 400, 0, {
        label: "AI prompt writer",
        providerId: promptProviderId,
        model: promptModel,
        text:
          promptInstructions ||
          "Write a detailed image-generation prompt from the incoming brief. Return only the final prompt.",
      }),
    );
    edges.push(edge("prompt-writer", "generate"));
  }
  if (images.length) {
    nodes.push(node("seed", "image", 0, 0, { label: "Seed images", images }));
    edges.push(edge("seed", target, "image"));
  }
  if (prompts) {
    nodes.push(
      node("prompts", "prompt-set", 400, 600, {
        label: "Scene prompts",
        prompts,
        ...(template !== undefined ? { text: template } : {}),
        ...promptSetDefaults,
      }),
    );
    edges.push(edge("prompts", target));
  } else if (records?.length) {
    nodes.push(
      node("records", "dataset", 0, images.length ? 860 : 700, {
        label: "Source records",
        records,
      }),
      node("record-template", "template", 400, images.length ? 860 : 700, {
        label: "Per-record scene",
        text:
          template ||
          Object.keys(records[0].fields)
            .map((key) => `${key}: {{${key}}}`)
            .join("\n"),
      }),
    );
    edges.push(
      edge("records", "record-template"),
      edge("record-template", target),
    );
  } else if (template)
    throw new Error("Provide records before a record template.");
  return {
    id,
    name,
    ...(projectId !== undefined ? { projectId } : {}),
    nodes,
    edges,
  };
}

/** Create a video branch without submitting inference or connecting subscription credits. */
export function createVideoWorkflow({
  name = "Video studies",
  providerId = "gemini-video",
  model,
  ratio = "16:9",
  video = { resolution: "720p" },
  promptInstructions = "Write a detailed video-generation prompt from the incoming brief, including motion and camera direction. Return only the final prompt.",
  ...options
} = {}) {
  if (providerId === "fal-video") {
    const mode =
      video.mode ||
      ((options.images?.length || 0) === 0
        ? "text"
        : options.images.length === 1
          ? "image"
          : "reference");
    model ??= `bytedance/seedance-2.5/${mode}-to-video`;
    const detail = falModel(model);
    if (detail?.videoModes) {
      video = { ...falDefaults(detail).video, ...video };
      if (detail.videoModes[0] === "image") ratio = "auto";
    }
  }
  if (options.modes)
    options.modes = options.modes.map((mode) => {
      if (mode.providerId !== "fal-video") return mode;
      const behavior =
        mode.video?.mode ||
        ((options.images?.length || 0) === 0
          ? "text"
          : options.images.length === 1
            ? "image"
            : "reference");
      const model = mode.model || `bytedance/seedance-2.5/${behavior}-to-video`,
        detail = falModel(model);
      if (!detail?.videoModes) return mode;
      return {
        ...mode,
        model,
        video: { ...falDefaults(detail).video, ...video, ...mode.video },
        ...(detail.videoModes[0] === "image" ? { ratio: "auto" } : {}),
      };
    });
  const graph = createImageWorkflow({
    ...options,
    name,
    providerId,
    model:
      model ??
      (providerId === "grok-video"
        ? "grok-imagine-video-1.5"
        : providerId === "gemini-video"
          ? "gemini-omni-1.1-flash"
          : undefined),
    ratio,
    promptInstructions,
  });
  for (const node of graph.nodes) {
    if (node.type === "generate") {
      node.type = "video-generate";
      node.data.label = "Video generation";
      node.data.video = { ...video };
      delete node.data.quality;
      delete node.data.image;
    } else if (node.type === "output") {
      node.type = "video-output";
      node.data.label = "Video collection";
    }
  }
  for (const edge of graph.edges)
    if (edge.source === "generate" && edge.target === "output")
      edge.targetHandle = "video";
  return graph;
}
