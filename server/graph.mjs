import { randomUUID } from "node:crypto";
import { expandTemplate } from "../shared/records.mjs";
import { validateGraph } from "../shared/graph.mjs";
import { mergeRules, rulesText } from "../shared/rule-templates.mjs";
import { generationModes, modeSummary } from "../shared/generation-modes.mjs";
import { generationKind } from "../shared/media.mjs";
import {
  defaultPromptTemplate,
  promptItemFields,
  promptSettings,
  promptSetSelectionSchema,
} from "../shared/prompt-sets.mjs";

function combine(groups) {
  let values = [{ text: [], images: [] }];
  for (const group of groups) {
    const next = [];
    for (const a of values)
      for (const b of group) {
        if (
          a.promptSet &&
          b.promptSet &&
          a.promptSet.nodeId !== b.promptSet.nodeId
        )
          throw new Error("Connect only one Prompt Set per generation branch.");
        const records = new Map((a.records || []).map((r) => [r.nodeId, r]));
        if (
          (b.records || []).some(
            (r) => records.has(r.nodeId) && records.get(r.nodeId).id !== r.id,
          )
        )
          continue;
        for (const r of b.records || []) records.set(r.nodeId, r);
        const fields = { ...a.fields };
        for (const [key, value] of Object.entries(b.fields || {})) {
          if (Object.hasOwn(fields, key) && fields[key] !== value)
            throw new Error(
              `Different record lists define conflicting “${key}” fields.`,
            );
          fields[key] = value;
        }
        next.push({
          records: [...records.values()],
          fields,
          text: [...a.text, ...b.text],
          images: [...a.images, ...b.images],
          rules: mergeRules(a.rules || [], b.rules || []),
          ...((a.promptSet || b.promptSet) && {
            promptSet: a.promptSet || b.promptSet,
          }),
        });
        if (next.length > 5000)
          throw new Error(
            "This workflow expands beyond 5,000 combinations. Reduce variations.",
          );
      }
    values = next;
  }
  return values;
}

export function planWorkflow(input, options = {}) {
  const { graph, order } = validateGraph(input);
  const selection =
    options.promptSet === undefined
      ? null
      : promptSetSelectionSchema.parse(options.promptSet);
  if (selection) {
    const set = graph.nodes.find(
      (n) => n.id === selection.nodeId && n.type === "prompt-set",
    );
    if (!set) throw new Error("Selected Prompt Set does not exist.");
    selection.itemIds ??= (set.data.prompts || [])
      .filter((item) => item.enabled !== false)
      .map((item) => item.id);
    if (!selection.itemIds.length)
      throw new Error("Enable at least one scene in this Prompt Set.");
    for (const id of selection.itemIds) {
      const item = set.data.prompts?.find((p) => p.id === id);
      if (!item) throw new Error(`Prompt Set scene “${id}” does not exist.`);
      if (item.enabled === false)
        throw new Error(`Enable “${item.label}” before running it.`);
    }
  }
  const jobs = [],
    values = new Map(),
    filteredEmpty = new Set();
  const targets = options.nodeId || selection ? new Set() : null;
  if (targets) {
    if (options.nodeId && !graph.nodes.some((n) => n.id === options.nodeId))
      throw new Error("Selected node does not exist.");
    const include = (id) => {
      if (targets.has(id)) return;
      targets.add(id);
      graph.edges
        .filter((e) => e.target === id)
        .forEach((e) => include(e.source));
    };
    if (options.nodeId) include(options.nodeId);
    if (selection) {
      if (options.nodeId && !targets.has(selection.nodeId))
        throw new Error(
          "The selected Prompt Set does not feed the chosen node.",
        );
      const descendants = new Set();
      const visit = (id) => {
        if (descendants.has(id)) return;
        descendants.add(id);
        graph.edges
          .filter((e) => e.source === id)
          .forEach((e) => visit(e.target));
      };
      visit(selection.nodeId);
      const allowed = new Set();
      const upstream = (id) => {
        if (allowed.has(id)) return;
        allowed.add(id);
        graph.edges
          .filter((e) => e.target === id)
          .forEach((e) => upstream(e.source));
      };
      graph.nodes
        .filter(
          (n) =>
            descendants.has(n.id) &&
            generationKind(n.type) &&
            (!options.nodeId || targets.has(n.id)),
        )
        .forEach((n) => upstream(n.id));
      if (options.nodeId)
        for (const id of [...targets]) {
          if (!allowed.has(id)) targets.delete(id);
        }
      else for (const id of allowed) targets.add(id);
    }
  }
  for (const n of order) {
    if (targets && !targets.has(n.id)) continue;
    if (n.type === "section") {
      values.set(n.id, []);
      continue;
    }
    if (
      graph.edges.some((e) => e.target === n.id && filteredEmpty.has(e.source))
    )
      filteredEmpty.add(n.id);
    const incoming = graph.edges
      .filter((e) => e.target === n.id)
      .map((e) => values.get(e.source) || []);
    const contexts = (
      ["output", "video-output"].includes(n.type)
        ? incoming.flat()
        : combine(incoming)
    ).map((ctx) => ({
      ...ctx,
      rules: mergeRules(ctx.rules || [], n.data.rules || []),
    }));
    if (n.type === "image") {
      if (!n.data.images?.length) {
        values.set(n.id, []);
        continue;
      }
      values.set(n.id, [
        { text: [], images: n.data.images.map((asset) => ({ asset })) },
      ]);
    } else if (n.type === "prompt-set") {
      const items = (n.data.prompts || []).filter(
        (item) =>
          item.enabled !== false &&
          (!selection ||
            selection.nodeId !== n.id ||
            selection.itemIds.includes(item.id)),
      );
      if (!items.length)
        if (n.data.prompts?.length) {
          filteredEmpty.add(n.id);
          values.set(n.id, []);
          continue;
        } else throw new Error(`Add at least one scene in “${n.data.label}”.`);
      values.set(
        n.id,
        contexts.flatMap((ctx) =>
          items.map((item) => {
            if (!item.scene.trim())
              throw new Error(`Write a scene prompt for “${item.label}”.`);
            if (ctx.promptSet)
              throw new Error(
                "Connect only one Prompt Set per generation branch.",
              );
            const fields = { ...ctx.fields, ...promptItemFields(item) };
            const template = n.data.text ?? defaultPromptTemplate;
            const ownText = expandTemplate(template, { ...ctx, fields });
            return {
              ...ctx,
              fields,
              text: ownText,
              records: [
                ...(ctx.records || []),
                { nodeId: n.id, id: item.id, fields: promptItemFields(item) },
              ],
              images: [
                ...ctx.images,
                ...(item.images || []).map((asset) => ({ asset })),
              ],
              promptSet: {
                nodeId: n.id,
                itemId: item.id,
                label: item.label,
                index: n.data.prompts.findIndex((p) => p.id === item.id),
                template: n.data.text ?? defaultPromptTemplate,
                scene: item.scene,
                concept: item.concept || "",
                defaults: promptSettings(n.data),
                overrides: promptSettings(item),
              },
            };
          }),
        ),
      );
    } else if (n.type === "dataset") {
      if (!n.data.records?.length)
        throw new Error(`Import at least one record into “${n.data.label}”.`);
      values.set(
        n.id,
        contexts.flatMap((ctx) =>
          n.data.records.map((row) => ({
            ...ctx,
            text: [],
            fields: row.fields,
            records: [{ nodeId: n.id, id: row.id, fields: row.fields }],
            images: [
              ...ctx.images,
              ...(row.images || []).map((asset) => ({ asset })),
            ],
          })),
        ),
      );
    } else if (n.type === "filter") {
      const field = n.data.filterField,
        accepted = n.data.filterValues;
      if (!field || !accepted?.length)
        throw new Error(
          `Choose a field and at least one value in “${n.data.label}”.`,
        );
      for (const ctx of contexts)
        if (!Object.hasOwn(ctx.fields || {}, field))
          throw new Error(
            `Field “${field}” is missing before “${n.data.label}”.`,
          );
      const matching = contexts.filter((ctx) =>
        accepted.includes(ctx.fields[field]),
      );
      if (!matching.length) filteredEmpty.add(n.id);
      values.set(n.id, matching);
    } else if (n.type === "template") {
      if (!n.data.text?.trim())
        throw new Error(`Write a prompt template in “${n.data.label}”.`);
      values.set(
        n.id,
        contexts.map((ctx) => ({
          ...ctx,
          text: expandTemplate(n.data.text, ctx),
        })),
      );
    } else if (n.type === "prompt") {
      values.set(
        n.id,
        contexts.map((v) => ({
          ...v,
          text: [...v.text, ...(n.data.text ? [{ literal: n.data.text }] : [])],
        })),
      );
    } else if (n.type === "variations") {
      const lines = (n.data.lines || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!lines.length)
        throw new Error(`Add at least one variation to “${n.data.label}”.`);
      values.set(
        n.id,
        contexts.flatMap((v) =>
          lines.map((line) => ({
            ...v,
            text: [...v.text, { literal: line }],
          })),
        ),
      );
    } else if (generationKind(n.type)) {
      const kind = generationKind(n.type);
      const modes = generationModes(n.data, kind, options);
      const settings = modes.map((mode) => {
        const count =
          kind === "text"
            ? 1
            : (options.count ?? mode.count ?? n.data.count ?? 1);
        const seed = options.seed ?? mode.seed ?? n.data.seed ?? 42;
        if (!Number.isInteger(count) || count < 1 || count > 500)
          throw new Error("Copies per variation must be 1–500.");
        if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
          throw new Error("Seed must be an integer between 0 and 2147483647.");
        return { mode, count, seed };
      });
      const copiesPerInput = Math.max(
        ...settings.map((setting) => setting.count),
      );
      const result = [];
      if (!contexts.length && filteredEmpty.has(n.id)) {
        values.set(n.id, []);
        continue;
      }
      if (!contexts.length)
        throw new Error(
          `An input to “${n.data.label}” has no images. Add a seed image.`,
        );
      for (const [inputIndex, ctx] of contexts.entries()) {
        const groupId = randomUUID();
        const promptParts = [
          ...ctx.text,
          ...(n.data.text ? [{ literal: n.data.text }] : []),
          ...(ctx.rules.length ? [{ literal: rulesText(ctx.rules) }] : []),
        ];
        const prompt = promptParts
          .map((p) => p.literal || "")
          .filter(Boolean)
          .join("\n\n");
        if (!promptParts.some((part) => part.jobId || part.literal?.trim()))
          throw new Error(`Connect a prompt to “${n.data.label}”.`);
        for (const setting of settings) {
          const { mode } = setting;
          const defaults = ctx.promptSet?.defaults || {},
            overrides = ctx.promptSet?.overrides || {};
          const count =
            kind === "text"
              ? 1
              : (options.count ??
                overrides.count ??
                defaults.count ??
                setting.count);
          const exactSeed = options.seed ?? overrides.seed;
          const seed = exactSeed ?? defaults.seed ?? setting.seed;
          const set =
            ctx.promptSet &&
            graph.nodes.find((node) => node.id === ctx.promptSet.nodeId);
          const stride = set
            ? Math.max(
                ...settings.map((s) => s.count),
                ...set.data.prompts.map(
                  (item) => options.count ?? item.count ?? set.data.count ?? 1,
                ),
              )
            : copiesPerInput;
          for (let i = 0; i < count; i++) {
            const id = randomUUID();
            const job = {
              id,
              kind,
              nodeId: n.id,
              label: n.data.label,
              providerId: mode.providerId,
              model: mode.model,
              mode: { ...structuredClone(mode), count },
              comparison: { groupId, inputIndex, copyIndex: i },
              promptParts,
              prompt,
              rules: ctx.rules,
              ...(kind === "image" && n.data.edit
                ? { edit: structuredClone(n.data.edit) }
                : {}),
              ...(kind === "video"
                ? {
                    video: {
                      resolution: "720p",
                      ...(mode.video || n.data.video),
                    },
                  }
                : {}),
              ...(kind === "image" && (mode.image || n.data.image)
                ? { image: { ...(mode.image || n.data.image) } }
                : {}),
              images: [
                ...new Map(
                  ctx.images.map((ref) => [
                    ref.asset ? `asset:${ref.asset}` : `job:${ref.jobId}`,
                    ref,
                  ]),
                ).values(),
              ],
              records: ctx.records || [],
              ...(ctx.promptSet && {
                promptSet: structuredClone(ctx.promptSet),
              }),
              dependencies: [
                ...new Set(
                  [...ctx.images, ...promptParts]
                    .filter((x) => x.jobId)
                    .map((x) => x.jobId),
                ),
              ],
              seed:
                (seed +
                  (exactSeed !== undefined && ctx.promptSet
                    ? 0
                    : (ctx.promptSet?.index ?? inputIndex) * stride) +
                  i) %
                2147483648,
              ratio:
                overrides.ratio ||
                defaults.ratio ||
                mode.ratio ||
                n.data.ratio ||
                (kind === "video" ? "16:9" : "1:1"),
              quality:
                mode.quality ||
                n.data.quality ||
                (mode.providerId === "grok-image" ? "medium" : "high"),
              status: "queued",
              attempts: 0,
            };
            if (job.image?.markup) {
              if (job.images.some((ref) => ref.asset === job.image.markup))
                throw new Error(
                  "Keep the transparent markup layer separate from the source/reference images.",
                );
              job.images.push({ asset: job.image.markup, role: "markup" });
            }
            jobs.push(job);
            result.push(
              kind === "text"
                ? { ...ctx, text: [{ jobId: id }], images: ctx.images }
                : kind === "video"
                  ? { ...ctx, text: [], images: [], videos: [{ jobId: id }] }
                  : { ...ctx, text: [], images: [{ jobId: id }] },
            );
            if (jobs.length > 5000)
              throw new Error("A run can contain at most 5,000 jobs.");
          }
        }
      }
      values.set(n.id, result);
    } else values.set(n.id, contexts);
  }
  if (!jobs.length)
    throw new Error(
      "Add an image, video or AI prompt generation node to run this workflow.",
    );
  return {
    graph,
    jobs,
    total: jobs.length,
    modes: modeSummary(jobs),
    contexts: Object.fromEntries(
      [...values].map(([id, ctx]) => [id, ctx.length]),
    ),
    textJobs: jobs.filter((j) => j.kind === "text").length,
    imageJobs: jobs.filter((j) => j.kind === "image").length,
    videoJobs: jobs.filter((j) => j.kind === "video").length,
  };
}
