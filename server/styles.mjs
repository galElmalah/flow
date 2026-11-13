import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { builtInStyles } from "../shared/styles/catalog.mjs";
import {
  styleSourceCollections,
  sourceIdsForStyle,
} from "../shared/styles/sources.mjs";
import { validateGraph } from "../shared/graph.mjs";
import {
  styleIdSchema,
  styleReferenceSchema,
  startStyleSchema,
  createStyleSchema,
  updateStyleSchema,
} from "../shared/styles/schema.mjs";

const missing = (message) => Object.assign(new Error(message), { status: 404 });
const styleIds = (job) => [
  ...new Set(
    (job.records || []).map((record) => record.fields?.styleId).filter(Boolean),
  ),
];
export class StyleLibrary {
  constructor({ store, projects, assetPath, search }) {
    this.store = store;
    this.projects = projects;
    this.assetPath = assetPath;
    this.search = search;
  }
  get byId() {
    const custom = Object.entries(this.store.styleLibraryState())
      .filter(([, entry]) => entry.definition)
      .map(([id, entry]) => ({ ...entry.definition, id, custom: true }));
    return new Map(
      [...builtInStyles, ...custom].map((style) => [style.id, style]),
    );
  }
  require(id) {
    styleIdSchema.parse(id);
    const style = this.byId.get(id);
    if (!style) throw missing("Style not found.");
    return style;
  }
  progress() {
    const result = new Map();
    const byId = this.byId;
    for (const run of this.store.listRuns().slice().reverse()) {
      for (const job of run.jobs || []) {
        if ((job.kind || "image") !== "image") continue;
        for (const id of styleIds(job)) {
          if (!byId.has(id)) continue;
          const previous = result.get(id);
          const completed =
            job.status === "completed" && job.output
              ? { url: job.output, runId: run.id, jobId: job.id }
              : previous?.completed;
          result.set(id, {
            status: job.status,
            runId: run.id,
            jobId: job.id,
            completed,
          });
        }
      }
    }
    return result;
  }
  decorate(style, state, progress) {
    const saved = state[style.id] || {};
    const latest = progress.get(style.id);
    const references = [...(saved.references || [])];
    if (
      !style.custom &&
      latest?.completed &&
      references.length < 16 &&
      !references.some((ref) => ref.url === latest.completed.url)
    )
      references.push({
        url: latest.completed.url,
        label: `${style.name} reference`,
        kind: "generated",
        runId: latest.completed.runId,
        jobId: latest.completed.jobId,
      });
    return {
      ...structuredClone(style),
      custom: Boolean(style.custom),
      favorite: saved.favorite || false,
      references,
      sources: styleSourceCollections.filter((source) =>
        sourceIdsForStyle(style).includes(source.id),
      ),
      referenceScenes: Object.fromEntries(
        references.flatMap((reference) => {
          if (reference.scene?.trim())
            return [[reference.url, reference.scene]];
          const job = this.store.runs
            .get(reference.runId)
            ?.jobs.find(
              (job) =>
                job.id === reference.jobId && job.output === reference.url,
            );
          if (!job) return [];
          const scene =
            job.records
              ?.map((record) => record.fields?.scene)
              .find((value) => typeof value === "string" && value.trim()) ||
            (styleIds(job).includes(style.id) ? style.scene : job.prompt);
          return scene ? [[reference.url, scene]] : [];
        }),
      ),
      referencePrompts: Object.fromEntries(
        references.flatMap((reference) => {
          if (reference.kind !== "generated")
            return reference.prompt ? [[reference.url, reference.prompt]] : [];
          const job = this.store.runs
            .get(reference.runId)
            ?.jobs.find(
              (job) =>
                job.id === reference.jobId && job.output === reference.url,
            );
          return job?.prompt ? [[reference.url, job.prompt]] : [];
        }),
      ),
      referenceStatus: references.length
        ? "completed"
        : (!style.custom && latest?.status) || "missing",
      ...(latest && {
        referenceGenerationStatus: latest.status,
        referenceRunId: latest.runId,
        referenceJobId: latest.jobId,
      }),
    };
  }
  async list({ search, category, favorites } = {}) {
    const state = this.store.styleLibraryState();
    const progress = this.progress();
    const all = [...this.byId.values()].map((style) =>
      this.decorate(style, state, progress),
    );
    const words =
      search?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) || [];
    const candidates = all.filter(
      (style) =>
        (!category || category === "all" || style.category === category) &&
        (!favorites || style.favorite),
    );
    const lexical = candidates.filter((style) =>
      words.every((word) =>
        `${style.name} ${style.category} ${style.description} ${style.prompt} ${style.scene} ${style.tags.join(" ")} ${style.references.map((reference) => `${reference.label} ${reference.scene || ""} ${reference.prompt || ""} ${reference.source?.creator || ""}`).join(" ")}`
          .toLocaleLowerCase()
          .includes(word),
      ),
    );
    let styles = lexical;
    let searchMode = words.length ? "keyword" : "browse";
    if (words.length && this.search?.status().state === "ready") {
      try {
        const ranked = await this.search.search({
          query: search.trim(),
          scope: this.store.projects.has("flow-styles")
            ? "project:flow-styles"
            : "all",
          limit: 200,
        });
        const scores = new Map();
        const byRunJob = new Map();
        for (const style of all)
          for (const ref of style.references) {
            if (!ref.runId || !ref.jobId) continue;
            const key = `${ref.runId}/${ref.jobId}`;
            byRunJob.set(key, [...(byRunJob.get(key) || []), style.id]);
          }
        for (const item of ranked.items) {
          const ids = styleIds(item);
          const bound = byRunJob.get(`${item.runId}/${item.id}`);
          if (bound) ids.push(...bound);
          for (const id of ids)
            scores.set(id, Math.max(scores.get(id) ?? -1, item.similarity));
        }
        if (scores.size) {
          const semantic = candidates
            .filter((style) => scores.has(style.id))
            .sort((a, b) => scores.get(b.id) - scores.get(a.id));
          const ordered = [...lexical, ...semantic];
          styles = [
            ...new Map(
              ordered.map((style) => [
                style.id,
                {
                  ...style,
                  ...(scores.has(style.id) && {
                    similarity: scores.get(style.id),
                  }),
                },
              ]),
            ).values(),
          ].slice(0, 60);
          searchMode = "semantic";
        }
      } catch {
        /* Reference indexing can be transient; catalog browsing remains usable. */
      }
    }
    return {
      styles,
      total: all.length,
      matched: styles.length,
      categories: [...new Set(all.map((style) => style.category))],
      referenceCount: all.filter((style) => style.references.length).length,
      sourceCollections: styleSourceCollections,
      searchMode,
      query: search || "",
    };
  }

  read(id) {
    return this.decorate(
      this.require(id),
      this.store.styleLibraryState(),
      this.progress(),
    );
  }
  favorite(id, favorite) {
    this.require(id);
    this.store.saveStyleLibraryEntry(id, { favorite });
    return this.read(id);
  }
  async create(input) {
    const {
      id = `custom-${randomUUID()}`,
      references,
      ...definition
    } = createStyleSchema.parse(input);
    const validated = await Promise.all(
      references.map((reference) => this.validateReference(id, reference)),
    );
    if (this.byId.has(id))
      throw Object.assign(
        new Error(
          "Style ID already exists. Choose another ID or update your custom style.",
        ),
        { status: 409 },
      );
    this.store.saveStyleLibraryEntry(id, { definition, references: validated });
    return this.read(id);
  }
  async update(id, input) {
    if (!this.require(id).custom)
      throw Object.assign(
        new Error(
          "Built-in style definitions are read-only. Create your own custom style instead.",
        ),
        { status: 409 },
      );
    const { references, ...changes } = updateStyleSchema.parse(input);
    const validated =
      references === undefined
        ? undefined
        : await Promise.all(
            references.map((reference) =>
              this.validateReference(id, reference),
            ),
          );
    const current = this.store.styleLibraryState()[id];
    this.store.saveStyleLibraryEntry(id, {
      definition: { ...current.definition, ...changes },
      ...(validated !== undefined && { references: validated }),
    });
    return this.read(id);
  }
  async validateReference(id, input) {
    const reference = styleReferenceSchema.parse(input);
    if (reference.kind === "generated") {
      const run = this.store.runs.get(reference.runId);
      const job = run?.jobs.find((job) => job.id === reference.jobId);
      if (
        !job ||
        job.status !== "completed" ||
        (job.kind || "image") !== "image" ||
        job.output !== reference.url
      )
        throw new Error(
          "Generated references must identify their completed image run and job.",
        );
    } else if (!reference.url.startsWith("/files/uploads/"))
      throw new Error(
        "Uploaded references must come from the local image uploader.",
      );
    if (!(await stat(this.assetPath(reference.url))).isFile())
      throw new Error("Reference image does not exist.");
    return reference;
  }
  async saveReferences(id, references) {
    this.require(id);
    const validated = await Promise.all(
      references.map((reference) => this.validateReference(id, reference)),
    );
    const merged = [...(this.store.styleLibraryState()[id]?.references || [])];
    for (const reference of validated) {
      const index = merged.findIndex(
        (existing) => existing.url === reference.url,
      );
      if (index < 0) merged.push(reference);
      else merged[index] = reference;
    }
    if (merged.length > 16)
      throw new Error("A style can have at most 16 references.");
    this.store.saveStyleLibraryEntry(id, { references: merged });
    return this.read(id);
  }
  async importRun(runId, projectId) {
    const run = this.store.runs.get(runId);
    if (!run) throw missing("Run not found.");
    if (projectId && run.projectId !== projectId)
      throw Object.assign(
        new Error("Run ownership does not match the selected project."),
        { status: 409 },
      );
    let imported = 0;
    const styles = [];
    for (const job of run.jobs || []) {
      if (
        job.status !== "completed" ||
        !job.output ||
        (job.kind || "image") !== "image"
      )
        continue;
      for (const id of styleIds(job)) {
        if (!this.byId.has(id)) continue;
        const existed = this.store
          .styleLibraryState()
          [id]?.references?.some((reference) => reference.url === job.output);
        await this.saveReferences(id, [
          {
            url: job.output,
            label: `${this.require(id).name} reference`,
            kind: "generated",
            runId,
            jobId: job.id,
          },
        ]);
        if (!existed) imported++;
        styles.push(id);
      }
    }
    return {
      runId,
      imported,
      styleIds: [...new Set(styles)],
      status: run.status,
    };
  }
  async start(id, input) {
    const options = startStyleSchema.parse(input);
    const style = this.read(id);
    const referenceUrls = options.referenceUrl
      ? [options.referenceUrl]
      : style.references.slice(0, 1).map((reference) => reference.url);
    for (const url of referenceUrls) {
      if (!style.references.some((reference) => reference.url === url))
        throw new Error("Choose a reference from this style's library images.");
      if (!(await stat(this.assetPath(url))).isFile())
        throw new Error("Reference image does not exist.");
    }
    const node = (id, type, x, y, data) => ({
      id,
      type,
      position: { x, y },
      data,
    });
    const edge = (source, target, targetHandle = "text") => ({
      id: `${source}-${target}`,
      source,
      target,
      targetHandle,
    });
    const nodes = [
      node("style", "prompt", 0, 0, {
        label: `${style.name} · style`,
        text: style.prompt,
        style: {
          id: style.id,
          name: style.name,
          category: style.category,
          prompt: style.prompt,
          referenceUrls,
        },
      }),
      node("prompt", "prompt", 0, 420, {
        label: "Your scene · edit me",
        text:
          options.subject?.trim() ||
          style.referenceScenes[referenceUrls[0]] ||
          style.scene,
      }),
      node("generate", "generate", 460, 120, {
        label: `${style.name} · image`,
        providerId: options.providerId || "codex",
        ...(options.model && { model: options.model }),
        count: 1,
        seed: 42,
        ratio: "1:1",
        quality: "high",
      }),
      node("output", "output", 900, 120, { label: "Style studies" }),
    ];
    const edges = [
      edge("style", "generate"),
      edge("prompt", "generate"),
      edge("generate", "output", "image"),
    ];
    if (referenceUrls.length) {
      nodes.push(
        node("seed", "image", 0, 800, {
          label: `${style.name} · reference`,
          images: referenceUrls,
        }),
      );
      edges.push(edge("seed", "generate", "image"));
    }
    const { graph } = validateGraph({
      id: randomUUID(),
      name: options.name || `${style.name} · study`,
      ...(options.projectId !== undefined && { projectId: options.projectId }),
      nodes,
      edges,
    });
    this.projects.assertWorkflow(graph);
    await this.store.saveWorkflow(graph);
    return graph;
  }
}
