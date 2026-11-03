export const sharedStyle = `SHARED QUOTURE ART DIRECTION:
Calm antique copperplate / woodcut collage, fine charcoal cross-hatching and stipple on warm ivory subjects, tactile paper grain. Clear silhouettes and small legible props at phone size. One restrained ivory classical architectural cue; keep the composition spare and the background open. Any modern object is plain and unbranded. Natural hands, opaque full bleed, important content within the central 80%.
References establish the engraving family only: make a fresh scene, never copy a face, pose or composition. No elaborate interior, crowded shelves, city panorama, halo, sunburst, spotlight, theatrical sky, gold wash, gradient, neon, glossy 3D, robot or code motif. Never render writing, digits, captions, IDs, names, labels, logos, watermark, borders, paper margins, interface or multiple panels. Preserve native originals without crop, padding or recoloring.
Palette, subject and aspect ratio come from the role-specific instructions below.`;

export const quoteArt = `Use case: stylized-concept. Create ONE original Quoture QUOTE illustration for immutable reading ID {{readingID}}. This is an unselected study interpreting only its exact passage. Wide 2:1, native 2048 x 1024 requested.

{{input}}

QUOTE-SPECIFIC RULES:
Generous quiet matte cobalt blue in the established #4166D5 family, warm ivory and charcoal subjects and robes. At most one tiny muted olive, terracotta or teal accent. Attached images are style references only. Preserve the supplied speaker distinction; anonymous figures or the relevant named fictional speaker, never an invented author portrait. No category title or journey narrative. Do not print the passage, source or author. Keep the background open and blue.`;

export const coverScene = `ROLE: {{role}}
IMMUTABLE ASSET ID: {{assetID}}
TOPIC / JOURNEY TITLE (interpret only, never print): {{title}}
TARGET BACKGROUND: {{background}}
TARGET FORMAT: {{ratio}}
SCENE DIRECTION: {{scene}}
SOURCE: {{sourceTitle}} — {{sourceLocator}}

{{input}}

A category is a single clear topic emblem in square 1:1. A journey is a wide 2:1 progression from observation or uncertainty toward understanding, expressed as a clear arrangement or path. These are browse covers, not an illustration for an individual quote. Keep the supplied non-blue palette, one simple architectural cue and generous open background. Omit theatrical beams, elaborate interiors and distant city panoramas even when an older source scene suggests them.`;

export const coverArt = `Use case: stylized-concept. Create ONE original Quoture {{role}} cover for immutable asset ID {{assetID}}, title {{title}}. This is an unselected study. Native aspect ratio {{ratio}}: category square 1:1 (1024 x 1024 requested); journey wide 2:1 (2048 x 1024 requested).

{{input}}

COVER-SPECIFIC RULES:
Dominant flat matte {{background}}, ivory and charcoal engraving. The background, sky and reflections must be clearly non-blue. Cobalt blue is reserved for quote illustrations. Attached images are family references only: retain the record's own palette and scene, not the other reference's objects or layout. A category reads as a topic emblem; a journey expresses a progression or path. No exact quotation, invented author portrait or rendered title. Make a fresh composition with the shared engraving rules above.`;

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

export function buildSharedWorkflow(previous, covers, coverImages) {
  const old = new Map(previous.nodes.map((n) => [n.id, structuredClone(n)]));
  const quotes = old
    .get("quotes")
    .data.records.filter((r) =>
      ["quote", "quote-study"].includes(r.fields.role),
    )
    .map((r) => ({
      ...r,
      fields: {
        ...r.fields,
        role: "quote",
        assetID: r.fields.readingID,
        title: r.fields.author,
        background: "cobalt blue #4166D5",
        ratio: "2:1",
      },
    }));
  const quoteIds = [
    "quote-filter",
    "style-seeds",
    "scene-template",
    "scene-writer",
    "art-template",
    "illustrations",
    "collection",
  ];
  const coverIds = [
    "cover-filter",
    "cover-seeds",
    "cover-scene-template",
    "cover-writer",
    "cover-art-template",
    "category-only",
    "journey-only",
    "category-images",
    "journey-images",
    "cover-collection",
  ];
  const place = (id, x, y, data = {}) => ({
    ...old.get(id),
    position: { x, y },
    data: { ...old.get(id).data, ...data },
  });
  return {
    id: previous.id,
    ...(previous.projectId ? { projectId: previous.projectId } : {}),
    name: "Quoture · quotes + covers",
    nodes: [
      node("quote-flow-frame", "section", 450, -80, {
        label: "01  Quote illustrations",
        subtitle: "Exact passages · cobalt blue · wide 2:1",
        tone: "quote",
        width: 2440,
        height: 690,
        members: quoteIds,
      }),
      node("cover-flow-frame", "section", 450, 690, {
        label: "02  Categories & journeys",
        subtitle: "Topic and path covers · non-blue palettes · square + wide",
        tone: "cover",
        width: 2750,
        height: 1110,
        members: coverIds,
      }),
      place("quotes", 0, 430, {
        label: "Quoture · shared source",
        records: [...quotes, ...covers],
      }),
      node("shared-style", "prompt", 0, 30, {
        label: "Shared · engraving & scenery",
        text: sharedStyle,
      }),
      node("quote-filter", "filter", 500, 30, {
        label: "Quotes only",
        filterField: "role",
        filterValues: ["quote"],
      }),
      place("style-seeds", 500, 285, { label: "Quote · cobalt references" }),
      place("scene-template", 820, 30, {
        label: "Quote · scene template",
        text:
          old
            .get("scene-template")
            .data.text.replace(/\n\nCOMMON ART DIRECTION:[\s\S]*/, "") +
          "\n\nCOMMON ART DIRECTION:\n{{input}}",
      }),
      place("scene-writer", 1220, 30),
      place("art-template", 1600, 30, {
        label: "Quote · artwork rules",
        text: quoteArt,
      }),
      place("illustrations", 2000, 30, { label: "Quote · wide 2:1" }),
      place("collection", 2500, 30, { label: "Quote collection" }),
      node("cover-filter", "filter", 500, 800, {
        label: "Categories & journeys only",
        filterField: "role",
        filterValues: ["category", "journey"],
      }),
      node("cover-seeds", "image", 500, 1080, {
        label: "Covers · ochre & olive references",
        images: coverImages,
      }),
      node("cover-scene-template", "template", 820, 800, {
        label: "Cover · scene template",
        text: coverScene,
      }),
      node("cover-writer", "prompt-generate", 1220, 800, {
        label: "Cover scene writer · Claude",
        providerId: "claude-code",
        model: "default",
        text: "Write one original image-generation scene brief of 100–150 words for ONLY this record. Return only the brief. Preserve its asset identity, topic, supplied non-blue palette and target format. Category: one clear emblem, square 1:1. Journey: a simple visual progression, wide 2:1. Follow the common engraving rules and simplify the old scene into one architectural cue and open background. References establish texture only; do not copy their scene or palette. No blue field, author portrait, quotation, text, dramatic beam, city panorama or extra panels.",
      }),
      node("cover-art-template", "template", 1600, 800, {
        label: "Cover · palette & role rules",
        text: coverArt,
      }),
      node("category-only", "filter", 2010, 800, {
        label: "Categories · square",
        filterField: "role",
        filterValues: ["category"],
      }),
      node("journey-only", "filter", 2010, 1280, {
        label: "Journeys · wide",
        filterField: "role",
        filterValues: ["journey"],
      }),
      node("category-images", "generate", 2320, 800, {
        label: "Category · square 1:1",
        providerId: "codex",
        model: "native",
        count: 1,
        seed: 31000,
        ratio: "1:1",
        quality: "high",
      }),
      node("journey-images", "generate", 2320, 1280, {
        label: "Journey · wide 2:1",
        providerId: "codex",
        model: "native",
        count: 1,
        seed: 32000,
        ratio: "2:1",
        quality: "high",
      }),
      node("cover-collection", "output", 2810, 1030, {
        label: "Cover collection",
      }),
    ],
    edges: [
      edge("quotes", "quote-filter"),
      edge("quotes", "cover-filter"),
      edge("shared-style", "scene-template"),
      edge("shared-style", "cover-scene-template"),
      edge("shared-style", "art-template"),
      edge("shared-style", "cover-art-template"),
      edge("quote-filter", "scene-template"),
      edge("scene-template", "scene-writer"),
      edge("style-seeds", "scene-writer", "image"),
      edge("scene-writer", "art-template"),
      edge("art-template", "illustrations"),
      edge("illustrations", "collection", "image"),
      edge("cover-filter", "cover-scene-template"),
      edge("cover-scene-template", "cover-writer"),
      edge("cover-seeds", "cover-writer", "image"),
      edge("cover-writer", "cover-art-template"),
      edge("cover-art-template", "category-only"),
      edge("cover-art-template", "journey-only"),
      edge("category-only", "category-images"),
      edge("journey-only", "journey-images"),
      edge("category-images", "cover-collection", "image"),
      edge("journey-images", "cover-collection", "image"),
    ],
  };
}
