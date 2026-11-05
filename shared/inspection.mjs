import { generationKind } from "./media.mjs";

export const recordFields = (job) => job?.records?.[0]?.fields || {};
export function recordTitle(job) {
  const f = recordFields(job);
  const prefix =
    f.role === "category"
      ? "Category · "
      : f.role === "journey"
        ? "Journey · "
        : "";
  return (
    f.author || prefix + (f.title || f.assetID || job?.records?.[0]?.id || "")
  );
}
export function recordIdentity(job) {
  const f = recordFields(job);
  return f.readingID || f.assetID || job?.records?.[0]?.id;
}

const text = (label, description) => ({ type: "text", label, description });
const image = (label, description) => ({ type: "image", label, description });
const video = (label, description) => ({ type: "video", label, description });
export const nodeInterfaces = {
  "prompt-set": {
    summary: "Keep named scenes together and generate them as a batch.",
    description:
      "Add one row per scene and connect shared instructions and reference images once. Each enabled scene becomes a separate prompt, with optional copies, aspect ratio and seed overrides.",
    example:
      "Running, cycling and swimming become three scene prompts. One copy and one generation mode produce three images.",
    inputs: [
      text(
        "Shared instructions",
        "Direction prepended to every scene, without duplicating it across rows.",
      ),
      image(
        "Reference images",
        "Optional shared references carried to every scene.",
      ),
    ],
    outputs: [
      text(
        "Scene prompts",
        "One resolved prompt per enabled scene, with its ID, references and generation overrides attached.",
      ),
    ],
  },
  image: {
    summary: "Upload images to guide the look or starting scene.",
    description:
      "Add one or more seed images or style references. Connected steps receive those images without changing the originals.",
    example:
      "Use a motion-blurred sports photo as the reference for a new cycling scene.",
    inputs: [],
    outputs: [
      image(
        "Reference images",
        "Passes every uploaded reference to connected nodes without changing the originals.",
      ),
    ],
  },
  dataset: {
    summary: "Import rows so each record gets its own output.",
    description:
      "Import CSV or JSON records, such as quotes, products or article concepts. Each row carries its named fields and record ID into the following steps.",
    example:
      "A list of ten quotes gives a template ten separate records to illustrate.",
    inputs: [],
    outputs: [
      text(
        "Records",
        "One context per row, with its named fields, immutable record ID and any row-specific images.",
      ),
    ],
  },
  prompt: {
    summary: "Write shared instructions for connected branches.",
    description:
      "Write the base art direction here. These instructions are added to incoming text and passed to connected steps; this node does not call an AI model.",
    example: "“Black-and-white sports photography, motion blur, no text.”",
    inputs: [
      text(
        "Upstream text",
        "Optional text to combine with these instructions.",
      ),
      image("Reference images", "Optional images carried into the next step."),
    ],
    outputs: [
      text(
        "Combined prompt",
        "Upstream text followed by these instructions. Record fields and image references continue with it.",
      ),
    ],
  },
  template: {
    summary: "Fill a reusable prompt with each record’s fields.",
    description:
      "Write a reusable brief using {{field}} placeholders. Each record fills those placeholders with its own values. {{input}} inserts upstream text, including an AI-written brief. No AI call is needed to fill the template.",
    example: "“A scene about {{meaning}}, set in {{scenery}}.”",
    inputs: [
      text(
        "Text & record fields",
        "Named fields fill {{field}} placeholders. {{input}} inserts the upstream text or generated scene brief.",
      ),
      image(
        "Reference images",
        "Carries incoming images forward without changing them.",
      ),
    ],
    outputs: [
      text(
        "Filled prompt",
        "The resolved template for one record, with that record's identity and reference images preserved.",
      ),
    ],
  },
  filter: {
    summary: "Send only matching records into a branch.",
    description:
      "Choose a record field and the exact values to keep. Matching rows continue with their prompts, references and IDs; other rows skip this branch.",
    example:
      "Send role = quote to illustrations and role = category to cover artwork.",
    inputs: [
      text(
        "Source records",
        "Records containing the field configured on this filter.",
      ),
    ],
    outputs: [
      text(
        "Matching records",
        "Only rows whose field equals one of the accepted values. Prompts, references and IDs stay attached.",
      ),
    ],
  },
  "prompt-generate": {
    summary: "Ask a text model to write or expand a prompt.",
    description:
      "Send a brief or record to the selected text model. It writes one response per input, replacing the incoming text while keeping the record and references for later steps.",
    example:
      "Turn each quote into a visual scene, then send that brief to Image generation.",
    inputs: [
      text(
        "Brief & instructions",
        "The incoming brief plus this node's instructions are sent to its text harness.",
      ),
      image(
        "Visual references",
        "Optional images the harness can consult while writing the brief.",
      ),
    ],
    outputs: [
      text(
        "Generated brief",
        "The harness response replaces incoming text. Enabled rules, the source record and visual references continue downstream.",
      ),
    ],
  },
  variations: {
    summary: "Create a separate prompt direction from each line.",
    description:
      "Write one variation per line. Each non-empty line is added to the incoming prompt to create another direction. Connecting multiple variation nodes combines their possibilities.",
    example:
      "“Dawn”, “Midday” and “Dusk” create three directions from the same base prompt.",
    inputs: [
      text(
        "Base prompt",
        "A prompt and any attached record fields or references.",
      ),
    ],
    outputs: [
      text(
        "Prompt variations",
        "One direction per non-empty line, for every incoming record.",
      ),
    ],
  },
  generate: {
    summary: "Generate still images, GIF animations or SVGs with supported models.",
    description:
      "Run the selected image model on each incoming scene, record or variation. Choose PNG, JPEG, WebP, animated GIF or SVG when supported. Codex GIFs use a generated sprite sheet assembled locally; GPT Image 2.6 API models also offer native GIF, SVG and complexity controls. Copies create extra results per input; modes compare providers or settings. GIFs stay in the image collection; use Video generation for movie clips.",
    example: "Four scenes × two copies × one mode produce eight images.",
    inputs: [
      text(
        "Image prompt",
        "The fully resolved prompt, including generated text and any additional direction on this node.",
      ),
      image(
        "Seed / reference images",
        "Original uploads or images from an upstream generation step. Their role depends on the selected provider.",
      ),
    ],
    outputs: [
      image(
        "Generated images",
        "One result per copy and input context, retaining its prompt, record, provider settings and generation receipt.",
      ),
    ],
  },
  "video-generate": {
    summary: "Generate clips from scene and motion instructions.",
    description:
      "Run the selected video model using the connected prompt and any supported image references. Set clip length, aspect ratio and other available controls on this node.",
    example:
      "Animate a cycling photo with a slow camera pan and natural forward motion.",
    inputs: [
      text(
        "Video prompt",
        "The resolved scene, motion and camera direction, including generated briefs and enabled rules.",
      ),
      image(
        "Image references",
        "Optional local images used as visual input when the selected video model supports them.",
      ),
    ],
    outputs: [
      video(
        "Generated videos",
        "One locally saved MP4 per copy and input context, with its original inputs and provider receipt.",
      ),
    ],
  },
  "video-output": {
    summary: "Collect clips for playback, download and inspection.",
    description:
      "Bring generated videos from connected branches into one collection. Open a clip to play it, inspect its saved inputs or download it. Run this flow runs its upstream steps.",
    example: "Review the clips from several video models together.",
    inputs: [
      video(
        "Flow videos",
        "Combines connected video results. This terminal collection cannot feed videos into image or prompt sockets.",
      ),
    ],
    outputs: [],
  },
  output: {
    summary: "Collect images and inspect their inputs and lineage.",
    description:
      "Bring image results from one or more branches into a gallery. Open a result to see its prompt, references, settings and ancestry. Run this flow runs the connected upstream steps.",
    example:
      "Collect running and cycling images in one gallery, then open a result to inspect how it was made.",
    inputs: [
      image(
        "Flow results",
        "Combines the images from connected generators without pairing or multiplying their records.",
      ),
    ],
    outputs: [
      image(
        "Image collection",
        "Each collected image can be inspected, downloaded or passed into another generation step.",
      ),
    ],
  },
  section: {
    summary: "Group and navigate a part of the canvas.",
    description:
      "Use a frame to label and visually organize a workflow branch. It has no connections, changes no prompts and creates no generation jobs.",
    example:
      "Keep quote illustrations and journey covers in separately named frames.",
    inputs: [],
    outputs: [],
  },
};

const fieldDescriptions = {
  input:
    "Text from connected nodes, including generated scene briefs. Resolved separately for each record.",
  readingID:
    "The permanent identifier for this exact passage. It stays attached to every quote image.",
  assetID: "The permanent identifier for the category or journey artwork.",
  quote:
    "The exact source passage to interpret. It is context for the illustration, not text to print in the image.",
  author:
    "The passage's author or work attribution. A fictional speaker may be different.",
  speaker:
    "Who speaks in the source passage, including fictional or literary context.",
  meaning:
    "The passage's interpretation and context, used to choose an appropriate scene.",
  scene: "The requested subject, props, setting and visual composition.",
  sourceTitle:
    "The source work or catalog from which this record was imported.",
  sourceLocator: "The exact location or catalog entry for this source record.",
  role: "Routes the record as a quote, category or journey.",
  title: "The category or journey topic to represent visually.",
  background: "The record's intended background palette.",
  ratio:
    "The record's intended image format; the image node sets the actual requested ratio.",
};
export const describeField = (field) =>
  fieldDescriptions[field] ||
  `Value from the “${field}” field of each input record.`;
export const templateParameters = (value = "") => [
  ...new Set(
    Array.from(
      value.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g),
      (m) => m[1],
    ),
  ),
];

export function upstreamNodes(graph, nodeId, include = () => true) {
  const nodes = new Map((graph?.nodes || []).map((n) => [n.id, n]));
  const seen = new Set([nodeId]),
    result = [];
  function visit(id) {
    for (const edge of (graph?.edges || []).filter((e) => e.target === id)) {
      if (seen.has(edge.source)) continue;
      seen.add(edge.source);
      if (!include(nodes.get(edge.source))) continue;
      visit(edge.source);
      if (nodes.has(edge.source)) result.push(nodes.get(edge.source));
    }
  }
  visit(nodeId);
  return result;
}

export function inspectGeneration(job, run) {
  // A saved run owns its inputs. Never infer an old image's provenance from the current canvas.
  const saved = run?.jobs?.find((j) => j.id === job.id) || job;
  const byId = new Map((run?.jobs || []).map((j) => [j.id, j]));
  const nodes = new Map((run?.graph?.nodes || []).map((n) => [n.id, n]));
  const references = (owner) =>
    (owner.images || []).map((ref, index) => {
      const parent = ref.jobId && byId.get(ref.jobId);
      const url = ref.asset || parent?.output;
      const source =
        ref.asset &&
        [...nodes.values()].find((n) => n.data.images?.includes(ref.asset));
      return {
        url,
        jobId: ref.jobId,
        label: source?.data.label || parent?.label || `Reference ${index + 1}`,
      };
    });
  const seen = new Set(),
    stages = [];
  function visit(owner) {
    const ids = new Set(
      [
        ...(owner.dependencies || []),
        ...(owner.promptParts || []).map((p) => p.jobId),
        ...(owner.images || []).map((r) => r.jobId),
      ].filter(Boolean),
    );
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const parent = byId.get(id);
      if (!parent) {
        stages.push({ id, missing: true });
        continue;
      }
      visit(parent);
      stages.push({
        ...parent,
        references: references(parent),
        instructions: nodes.get(parent.nodeId)?.data.text,
      });
    }
  }
  if (run?.jobs) visit(saved);
  const producers = new Set([
    saved.nodeId,
    ...stages.map((stage) => stage.nodeId),
  ]);
  const fields = Object.assign(
    {},
    ...(saved.records || []).map((record) => record.fields),
  );
  return {
    job: saved,
    records: (saved.records || []).map((record) => ({
      ...record,
      label: nodes.get(record.nodeId)?.data.label || "Source record",
    })),
    references: references(saved),
    stages,
    sources: upstreamNodes(run?.graph, saved.nodeId, (node) => {
      if (!node) return false;
      if (generationKind(node.type)) return producers.has(node.id);
      if (
        node.type === "filter" &&
        Object.hasOwn(fields, node.data.filterField)
      )
        return node.data.filterValues?.includes(fields[node.data.filterField]);
      return true;
    }).filter((n) =>
      ["prompt", "prompt-set", "template", "variations"].includes(n.type),
    ),
  };
}
