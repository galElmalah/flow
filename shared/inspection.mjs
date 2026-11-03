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
    description:
      "Named scene prompts sharing one template and defaults. Each enabled scene becomes its own input, retaining its stable ID and overrides.",
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
    description:
      "Original images used as starting points or visual references.",
    inputs: [],
    outputs: [
      image(
        "Reference images",
        "Passes every uploaded reference to connected nodes without changing the originals.",
      ),
    ],
  },
  dataset: {
    description:
      "A shared source of records. Every row keeps its identity throughout the workflow.",
    inputs: [],
    outputs: [
      text(
        "Records",
        "One context per row, with its named fields, immutable record ID and any row-specific images.",
      ),
    ],
  },
  prompt: {
    description: "Reusable instructions shared by connected branches.",
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
    description: "Fills the template separately for each incoming record.",
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
    description:
      "Routes records by an exact field value; unmatched records do not enter this branch.",
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
    description:
      "Uses the selected text harness to write one scene or prompt per input record.",
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
    description:
      "Adds each variation to the incoming prompt to create parallel directions.",
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
    description:
      "Generates images with the selected image provider, using one prompt for each record and variation.",
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
    description:
      "Generates a video through the selected API provider, retaining its prompt, records and durable remote interaction. Gemini Pro or Flow credits are not connected by signing into a coding harness.",
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
    description:
      "Collects video results without multiplying their records. Open a clip to play it, inspect its inputs or download it.",
    inputs: [
      video(
        "Flow videos",
        "Combines connected video results. This terminal collection cannot feed videos into image or prompt sockets.",
      ),
    ],
    outputs: [],
  },
  output: {
    description:
      "Collects image results from this flow. Open its gallery to inspect every result and its inputs.",
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
    description:
      "A visual frame for organizing a flow. It does not alter inputs or create jobs.",
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
