import { z } from "zod";
import { projectIdSchema } from "./projects.mjs";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const imageEditModeSchema = z.enum(["region", "recolor", "whole"]);
export const imageEditColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const anchorSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
export const editorIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const openEditorSchema = z
  .object({
    source: z.string().min(1).max(500),
    runId: id.optional(),
    jobId: id.optional(),
    projectId: projectIdSchema.optional(),
  })
  .strict();
export const nameRegionsSchema = z
  .object({
    providerId: id.default("codex-text"),
    model: z.string().min(1).max(120).optional(),
  })
  .strict();
export const segmentSchema = z
  .object({
    point: z
      .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
      .strict()
      .optional(),
    names: z.union([z.literal(false), nameRegionsSchema]).optional(),
  })
  .strict();
export const editorPatchSchema = z
  .object({
    revision: z.number().int().min(0),
    layer: z
      .object({
        id,
        label: z.string().trim().min(1).max(120).optional(),
        visible: z.boolean().optional(),
        locked: z.boolean().optional(),
      })
      .strict()
      .optional(),
    order: z.array(id).min(1).max(160).optional(),
    comment: z
      .object({
        regionIds: z.array(id).min(1).max(160),
        text: z.string().trim().min(1).max(4000),
        anchor: anchorSchema.optional(),
      })
      .strict()
      .optional(),
    resolve: z.object({ id, resolved: z.boolean() }).strict().optional(),
  })
  .strict()
  .refine(
    (v) =>
      [v.layer, v.order, v.comment, v.resolve].filter(Boolean).length === 1,
    "Choose one change per request.",
  );
export const editRequestSchema = z
  .object({
    mode: imageEditModeSchema.default("whole"),
    color: imageEditColorSchema.optional(),
    strength: z.number().min(0).max(1).optional(),
    revision: z.number().int().min(0),
    regionIds: z.array(id).max(160).default([]),
    instructions: z.string().trim().max(8000).default(""),
    providerId: id.default("codex"),
    model: z.string().min(1).max(120).optional(),
    count: z.number().int().min(1).max(100).default(1),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode !== "whole" && !input.regionIds.length)
      context.addIssue({
        code: "custom",
        path: ["regionIds"],
        message: "Select at least one region.",
      });
    if (input.mode === "recolor" && !input.color)
      context.addIssue({
        code: "custom",
        path: ["color"],
        message: "Choose a recolor color.",
      });
    if (input.mode === "recolor" && input.count !== 1)
      context.addIssue({
        code: "custom",
        path: ["count"],
        message: "Recolor creates one version at a time.",
      });
    if (
      input.mode !== "recolor" &&
      (input.color !== undefined || input.strength !== undefined)
    )
      context.addIssue({
        code: "custom",
        path: ["mode"],
        message: "Color and strength apply only to recoloring.",
      });
  });
export function toggleRegion(selected, id, additive = false) {
  if (!id) return additive ? selected : [];
  if (!additive) return selected.length === 1 && selected[0] === id ? [] : [id];
  return selected.includes(id)
    ? selected.filter((value) => value !== id)
    : [...selected, id];
}
export function editTargets(editor, selected, draft) {
  return [
    ...new Set([
      ...selected,
      ...editor.comments.filter((c) => !c.resolved).flatMap((c) => c.regionIds),
      ...(draft?.text?.trim() ? draft.regionIds : []),
    ]),
  ];
}
export function editBrief(
  editor,
  { regionIds, instructions, mode = "whole", color, strength = 1 },
) {
  const selected = editor.regions.filter((r) => regionIds.includes(r.id));
  const comments = editor.comments.filter(
    (c) =>
      mode !== "recolor" &&
      !c.resolved &&
      (mode === "whole" || c.regionIds.some((id) => regionIds.includes(id))),
  );
  if (mode === "recolor")
    return `Recolor ${selected.map((region) => region.label).join(", ")} to ${color} at ${Math.round(strength * 100)}% strength. Local luminance-preserving color adjustment; preserve alpha and all pixels outside the selection.`;
  if (mode === "region" && !instructions.trim() && !comments.length)
    throw new Error(
      "Add instructions or an unresolved region comment before creating an edit.",
    );
  return [
    mode === "whole"
      ? "Regenerate the entire image from the original reference, applying the requested changes and region comments. Preserve the current composition, objects, lighting and visual style unless the instructions ask for changes. Selected regions and any annotation map provide location guidance only; render a complete coherent image with natural edges, never a pasted cutout. Every part of the image may change; no region mask limits this generation."
      : `Edit the ORIGINAL source image at ${editor.width} × ${editor.height} pixels. The second reference is an annotation map, never an intended output. The numbered highlighted regions are the only requested edit targets.`,
    `Selected regions: ${selected.map((r) => `${r.label} (${r.id})`).join(", ")}.`,
    instructions.trim(),
    ...comments.map(
      (c) =>
        `Region comment [${c.regionIds.map((id) => editor.regions.find((r) => r.id === id)?.label || id).join(", ")}]${c.anchor ? ` at image position ${Math.round(c.anchor.x * 100)}%, ${Math.round(c.anchor.y * 100)}%` : ""}: ${c.text}`,
    ),
    mode === "whole"
      ? "Use the reference as creative guidance. Follow the user's changes and return image artwork only, without annotations or interface."
      : "Keep the exact framing and dimensions. The platform will composite only the selected pixels onto the original; include sufficient surrounding context so the edit aligns. To expand an object's silhouette, the user must select that surrounding area too. Never render mask colors, region outlines, labels or interface.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function needsRegionName(region) {
  return (
    !region.locked &&
    region.labelSource !== "manual" &&
    /^Region \d+$/.test(region.label)
  );
}
