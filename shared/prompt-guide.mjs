import { mergeRules } from "./rule-templates.mjs";
import { generationKind } from "./media.mjs";

export function promptGuide({ nodes, edges }, plan) {
  const hasDirection = (node) =>
    node.data.text?.trim() || mergeRules(node.data.rules || []).length;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestors = (id, seen = new Set()) => {
    if (seen.has(id)) return seen;
    seen.add(id);
    edges
      .filter((e) => e.target === id)
      .forEach((e) => ancestors(e.source, seen));
    return seen;
  };
  const endpoints = nodes.filter((n) =>
    ["output", "video-output"].includes(n.type),
  );
  if (!endpoints.length)
    endpoints.push(
      ...nodes.filter((n) =>
        ["image", "video"].includes(generationKind(n.type)),
      ),
    );
  const used = new Set(endpoints.flatMap((node) => [...ancestors(node.id)]));
  const active = nodes.filter((n) => used.has(n.id));
  const textParent = (node) =>
    edges.some(
      (e) =>
        e.target === node.id &&
        ![
          "image",
          "generate",
          "video-generate",
          "output",
          "video-output",
          "section",
        ].includes(byId.get(e.source)?.type),
    );
  const bases = active
    .filter((n) => n.type === "prompt" && hasDirection(n) && !textParent(n))
    .map((n) => ({
      id: n.id,
      label: n.data.label,
      kind: "Base prompt",
      description: "Shared direction added to every connected branch.",
    }));
  const recordBriefs = active
    .filter((n) => n.type === "dataset")
    .flatMap((node) => {
      const fields = ["brief", "prompt"].filter((key) =>
        node.data.records?.some((r) => String(r.fields[key] || "").trim()),
      );
      return fields.length
        ? [
            {
              id: node.id,
              label: node.data.label,
              kind: "Per-record prompts",
              description: `Prompt text is stored in each record’s ${fields.join(" / ")} field. Open a record to edit it.`,
            },
          ]
        : [];
    });
  const fallback =
    !bases.length && !recordBriefs.length
      ? active
          .filter(
            (n) =>
              ["template", "prompt-generate"].includes(n.type) &&
              hasDirection(n),
          )
          .slice(0, 1)
          .map((n) => ({
            id: n.id,
            label: n.data.label,
            kind:
              n.type === "template" ? "Prompt template" : "Prompt instructions",
            description:
              "This node supplies the text used to build the generation prompt.",
          }))
      : [];
  const sets = active
    .filter((n) => n.type === "prompt-set")
    .map((n) => ({
      id: n.id,
      label: n.data.label,
      kind: "Prompt Set",
      description:
        "Open a scene to edit its prompt. Shared template and defaults apply to every enabled scene.",
    }));
  const starts = [...bases, ...sets, ...recordBriefs, ...fallback];
  const optional = active
    .filter((n) => n.type === "prompt" && !hasDirection(n))
    .map((n) => ({
      id: n.id,
      label: n.data.label,
      kind: "Empty · optional",
      description:
        "Adds no text right now. The connected record/template supplies the prompt.",
    }));
  const role = (node) =>
    ({
      prompt: "Direction",
      dataset: "Records",
      "prompt-set": "Scene prompts",
      image: "References",
      template: "Template",
      "prompt-generate": "AI scene writer",
      variations: "Variations",
      filter: "Record filter",
      generate: "Image generator",
      output: "Gallery",
      "video-generate": "Video generator",
      "video-output": "Video gallery",
    })[node.type];
  const ordered = [];
  const visited = new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    edges.filter((e) => e.target === id).forEach((e) => visit(e.source));
    const node = byId.get(id);
    if (node && role(node)) ordered.push(node);
  };
  endpoints.forEach((n) => visit(n.id));
  return {
    starts,
    optional,
    sources: active.filter((n) =>
      ["dataset", "image", "prompt-set"].includes(n.type),
    ),
    flows: endpoints.map((output) => {
      const ids = ancestors(output.id);
      const steps = ordered
        .filter((n) => ids.has(n.id))
        .map((n) => ({ id: n.id, label: n.data.label, kind: role(n) }));
      const count = (type) =>
        plan
          ? active
              .filter((n) => ids.has(n.id) && n.type === type)
              .reduce((sum, n) => sum + (plan.nodes?.[n.id] || 0), 0)
          : null;
      return {
        id: output.id,
        label: output.data.label,
        steps,
        textJobs: count("prompt-generate"),
        imageJobs: count("generate"),
        videoJobs: count("video-generate"),
      };
    }),
  };
}
