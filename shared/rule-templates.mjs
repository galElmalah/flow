import { z } from "zod";

export const ruleTemplateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  title: z.string().trim().min(1).max(100),
  group: z.string().trim().min(1).max(60).default("My rules"),
  text: z.string().trim().min(1).max(4000),
});
export const appliedRuleSchema = ruleTemplateSchema.extend({
  enabled: z.boolean().default(true),
});
export const ruleNodeTypes = [
  "prompt",
  "template",
  "prompt-set",
  "prompt-generate",
  "generate",
  "video-generate",
];

export const builtInRules = [
  {
    id: "fresh-scenery",
    title: "Fresh scenery",
    group: "Scene variety",
    text: "Create scenery specific to this brief. Choose a fresh arrangement of setting, foreground objects and background elements within the requested style and setting constraints. Do not reproduce the scenery from a style reference.",
  },
  {
    id: "vary-composition",
    title: "Vary composition",
    group: "Scene variety",
    text: "Explore a distinct viewpoint, framing and arrangement of subjects while preserving the brief's meaning, required subjects and aspect ratio. Keep the focal action easy to read.",
  },
  {
    id: "style-without-likeness",
    title: "Style without likeness",
    group: "References",
    text: "Use references designated as style references for visual treatment, palette and texture only. Invent new faces for anonymous subjects; do not reproduce a style reference person's likeness. Preserve any person explicitly designated as an identity reference.",
  },
  {
    id: "distinct-faces",
    title: "Distinct faces in this scene",
    group: "People",
    text: "Give each unrelated person in this scene visibly distinct facial features, including face shape, nose, brows and hair. Avoid cloned faces. Preserve explicitly requested shared identity, family resemblance or twins.",
  },
  {
    id: "varied-cast",
    title: "Varied anonymous cast",
    group: "People",
    text: "For unspecified anonymous people, choose varied appearances, ages appropriate to the scene, hair textures and body types. Preserve specified identities and character continuity. Do not add people solely to satisfy this direction.",
  },
  {
    id: "varied-skin-tones",
    title: "Varied skin tones",
    group: "People",
    text: "For unspecified anonymous people, include a natural variety of skin tones when multiple people are present. Portray each with equal care and visual dignity. Do not associate skin tone with occupation, status, morality, temperament or ability. Preserve explicitly specified identities and appearances.",
  },
  {
    id: "clear-focal-action",
    title: "Clear focal action",
    group: "Composition",
    text: "Make the main subject and action immediately understandable at small size. Use clear silhouettes and a restrained background; keep essential props distinct and readable.",
  },
  {
    id: "no-incidental-lettering",
    title: "No incidental lettering",
    group: "Composition",
    text: "Do not introduce incidental text, letters, digits, logos, signatures or watermarks. Preserve only text explicitly required by the brief.",
  },
];

export const rulePresets = [
  {
    id: "fresh-illustration",
    title: "Fresh illustration",
    rules: ["fresh-scenery", "vary-composition", "style-without-likeness"],
  },
  {
    id: "varied-people",
    title: "Varied anonymous people",
    rules: ["distinct-faces", "varied-cast", "varied-skin-tones"],
  },
  {
    id: "small-screen",
    title: "Small-screen artwork",
    rules: ["clear-focal-action", "no-incidental-lettering"],
  },
];

export function mergeRules(...groups) {
  const rules = new Map();
  for (const rule of groups.flat()) {
    if (rule.enabled === false) continue;
    const key = JSON.stringify([rule.id, rule.title, rule.text]);
    if (!rules.has(key)) rules.set(key, { ...rule, enabled: true });
  }
  return [...rules.values()];
}

export function rulesText(rules) {
  const enabled = mergeRules(rules);
  return enabled.length
    ? "GENERATION RULES:\n" +
        enabled.map((r) => `- ${r.title}: ${r.text}`).join("\n")
    : "";
}

export function addRuleTemplates(current, templates) {
  const ids = new Set(current.map((r) => r.id));
  return [
    ...current,
    ...templates
      .filter((r) => !ids.has(r.id))
      .map((r) => ({ ...r, enabled: true })),
  ];
}

export function inheritedRules(nodeId, nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set([nodeId]);
  const rules = [];
  function visit(id) {
    for (const edge of edges.filter((e) => e.target === id)) {
      if (visited.has(edge.source)) continue;
      visited.add(edge.source);
      visit(edge.source);
      const source = byId.get(edge.source);
      for (const rule of mergeRules(source?.data.rules || []))
        rules.push({
          ...rule,
          sourceId: source.id,
          sourceLabel: source.data.label,
        });
    }
  }
  visit(nodeId);
  return rules;
}

export function ruleConflicts(nodeId, nodes, edges) {
  const node = nodes.find((item) => item.id === nodeId);
  const rules = mergeRules(
    inheritedRules(nodeId, nodes, edges),
    node?.data.rules || [],
  );
  if (!rules.some((r) => r.id === "varied-skin-tones")) return [];
  const ids = new Set([nodeId]);
  const visit = (id) => {
    for (const edge of edges.filter((item) => item.target === id)) {
      if (ids.has(edge.source)) continue;
      ids.add(edge.source);
      visit(edge.source);
    }
  };
  visit(nodeId);
  const conflict =
    /(?:ivory|white)[\s/-]+(?:subjects?|figures?|people|faces?|skin)\b|(?:subjects?|figures?|people|faces?|skin)\s+(?:(?:must\s+be|are|in)\s+)?(?:ivory|white)\b/iu;
  return nodes
    .filter((item) => ids.has(item.id) && conflict.test(item.data.text || ""))
    .map(
      (item) =>
        `“${item.data.label}” asks for ivory or white subjects. Review that wording alongside the skin-tone rule.`,
    );
}
