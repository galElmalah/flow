import { falDefaults, falModel } from "../shared/fal.mjs";

// Each expanded scene receives its own references plus the shared ones.
function defaultFalMode({ images = [], records, prompts }) {
  const rows = prompts?.filter((item) => item.enabled !== false) ?? records;
  const counts = rows?.length
    ? rows.map((row) => new Set([...images, ...(row.images || [])]).size)
    : [new Set(images).size];
  if (counts.includes(0) && counts.some((count) => count > 0))
    throw new Error(
      "No single fal endpoint handles both text-only scenes and scenes with references. Split them into workflows or select an explicit model for the scenes you intend to run.",
    );
  const maximum = Math.max(...counts);
  return maximum === 0 ? "text" : maximum === 1 ? "image" : "reference";
}

function falImageModel(inputs) {
  return `bytedance/seedream/v5/flash/${defaultFalMode(inputs) === "text" ? "text-to-image" : "edit"}`;
}

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
  if (records && !records.length)
    throw new Error("Provide at least one record.");
  if (providerId === "fal-image" && !modes?.length)
    model ??= falImageModel({ images, records, prompts });
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
                quality: mode.quality ?? quality ?? "auto",
                image: mode.image ?? image ?? { resolution: "1k" },
                model:
                  mode.model ?? falImageModel({ images, records, prompts }),
              }
            : mode.providerId === "grok-image"
              ? {
                  quality: mode.quality ?? quality ?? "medium",
                  image: mode.image ?? image ?? { resolution: "1k" },
                }
              : {}),
        })),
      }),
    }),
    node("output", "output", 1200, 0, { label: "Output collection" }),
  ];
  const target = promptProviderId ? "prompt-writer" : "generate";
  const promptTarget = prompts
    ? "prompts"
    : records
      ? "record-template"
      : target;
  const edges = [
    edge("prompt", promptTarget),
    edge("generate", "output", "image"),
  ];
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
  function falSettings(model, settings) {
    model ??= `bytedance/seedance-2.5/${settings.mode ?? defaultFalMode(options)}-to-video`;
    const detail = falModel(model);
    if (!detail?.videoModes) return { model, video: settings };
    return {
      model,
      video: { ...falDefaults(detail).video, ...settings },
      ...(detail.videoModes[0] === "image" && { ratio: "auto" }),
    };
  }
  if (options.modes)
    options.modes = options.modes.map((mode) => {
      if (mode.providerId !== "fal-video") return mode;
      return {
        ...mode,
        ...falSettings(mode.model, mode.video ?? video),
      };
    });
  if (providerId === "fal-video" && !options.modes?.length) {
    const primary = falSettings(model, video);
    model = primary.model;
    video = primary.video;
    if (primary.ratio) ratio = primary.ratio;
  }
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
