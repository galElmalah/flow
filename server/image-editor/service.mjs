import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  mkdir,
  readFile,
  access,
  writeFile,
  copyFile,
  rename,
} from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import { Sam2 } from "../../image-tools/segmentation/sam2.mjs";
import { createImageWorkflow } from "../../client/workflows.mjs";
import { validateGraph } from "../../shared/graph.mjs";
import {
  editBrief,
  editorIdSchema,
  needsRegionName,
} from "../../shared/image-editor.mjs";
import { startWorkflowRun } from "../run-service.mjs";
import { galleryItems } from "../search/documents.mjs";
import { nameRegionBatch } from "./region-names.mjs";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const ownerOf = (editor) => editor.projectId ?? editor.source.projectId;
const progressSchema = z.object({
  stage: z.enum(["runtime", "loading", "encoding", "sampling", "exporting"]),
  message: z.string().max(200),
  completed: z.number().int().min(0).optional(),
  total: z.number().int().min(0).optional(),
});
const resultSchema = z.object({
  model: z.string(),
  device: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  regions: z
    .array(
      z.object({
        id: z.string().regex(/^region-[a-f0-9-]{36}$/),
        path: z
          .string()
          .max(1_000_000)
          .regex(/^[MLZ0-9 .-]+$/),
        bbox: z.array(z.number()).length(4),
        area: z.number().positive(),
        score: z.number(),
        file: z.string().regex(/^region-[a-f0-9-]{36}\.png$/),
        anchor: z
          .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
          .optional(),
      }),
    )
    .max(80),
});
export class ImageEditors {
  variations(id, projectId) {
    const editor = this.get(id, projectId);
    const familyId = editor.familyId || editor.id;
    return this.store.db
      .prepare(
        "SELECT value FROM metadata WHERE key LIKE 'image_editor:%' AND COALESCE(json_extract(value, '$.familyId'), json_extract(value, '$.id'))=?",
      )
      .all(familyId)
      .map((row) => JSON.parse(row.value))
      .filter(
        (member) =>
          ownerOf(member) === ownerOf(editor) &&
          (member.familyId || member.id) === familyId,
      )
      .flatMap((member) =>
        member.requests.map((request) => ({ member, request })),
      )
      .sort((a, b) => a.request.createdAt.localeCompare(b.request.createdAt))
      .map(({ member, request }) => {
        const run = this.runFor(member, request);
        if (run && run.projectId !== ownerOf(editor))
          throw fail(
            "Variation project ownership does not match the editor.",
            409,
          );
        const outputs = run ? galleryItems([run]) : [];
        const generator = request.workflow?.nodes.find(
          (n) => n.type === "generate",
        );
        return {
          editorId: member.id,
          mode: request.mode,
          requestId: request.id,
          projectId: ownerOf(editor),
          workflowId: request.workflowId,
          runId: run?.id || request.runId,
          createdAt: request.createdAt,
          instructions: request.instructions,
          comments: request.comments,
          regions: request.regions.map(({ id, label }) => ({ id, label })),
          providerId: generator?.data.providerId,
          count: generator?.data.count || 1,
          status: run?.status || (request.runId ? "unavailable" : "prepared"),
          jobs:
            run?.jobs
              .filter((j) => (j.kind || "image") === "image")
              .map((job) => ({
                id: job.id,
                status: job.status,
                message: job.message,
                error: job.error,
                startedAt: job.startedAt,
                ...(outputs.find((output) => output.id === job.id) || {}),
              })) || [],
        };
      });
  }
  runFor(editor, request) {
    const receipt = request.runId && this.store.runs.get(request.runId);
    if (receipt) return receipt;
    return [...this.store.runs.values()].find(
      (run) =>
        run.workflowId === request.workflowId &&
        run.projectId === ownerOf(editor) &&
        (!request.workflow ||
          (isDeepStrictEqual(run.graph?.nodes, request.workflow.nodes) &&
            isDeepStrictEqual(run.graph?.edges, request.workflow.edges))) &&
        run.graph?.nodes.some(
          (node) =>
            node.data?.edit?.editorId === editor.id &&
            node.data.edit.requestId === request.id,
        ),
    );
  }
  constructor({
    store,
    projects,
    assetPath,
    dataRoot,
    model = new Sam2(dataRoot),
    queue,
    providers,
    namer = nameRegionBatch,
    assets,
  }) {
    Object.assign(this, {
      store,
      projects,
      assetPath,
      dataRoot,
      model,
      queue,
      providers,
      namer,
      assets,
    });
    this.pending = Promise.resolve();
    this.active = new Map();
    this.sending = new Map();
    this.naming = new Map();
    for (const editor of this.list()) {
      if (["queued", "running"].includes(editor.naming?.status)) {
        editor.naming = {
          ...editor.naming,
          status: "failed",
          error:
            "Region naming was interrupted. Retry to finish naming the remaining regions.",
        };
        this.save(editor, editor.revision);
        editor.revision++;
      }
      if (["running", "queued"].includes(editor.segmentation.status))
        this.save(
          {
            ...editor,
            segmentation: {
              ...editor.segmentation,
              status: "failed",
              error: "Segmentation was interrupted. Retry to continue.",
            },
          },
          editor.revision,
        );
    }
  }
  list(projectId) {
    if (projectId) this.projects.require(projectId);
    return this.store.db
      .prepare("SELECT value FROM metadata WHERE key LIKE 'image_editor:%'")
      .all()
      .map((row) => JSON.parse(row.value))
      .filter((editor) => !projectId || ownerOf(editor) === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id, projectId) {
    editorIdSchema.parse(id);
    const row = this.store.db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get(`image_editor:${id}`);
    if (!row) throw fail("Image editor not found.", 404);
    const editor = JSON.parse(row.value);
    this.projects.assertWorkflow({ projectId: ownerOf(editor) }, projectId);
    const familyId = editor.familyId || editor.id;
    const rootRow =
      familyId === editor.id
        ? null
        : this.store.db
            .prepare("SELECT value FROM metadata WHERE key=?")
            .get(`image_editor:${familyId}`);
    const original = rootRow ? JSON.parse(rootRow.value) : editor;
    if (ownerOf(original) !== ownerOf(editor))
      throw fail("Image history belongs to a different project.", 409);
    return {
      ...editor,
      familyId,
      original: { ...original.source, editorId: original.id },
    };
  }
  save(editor, expected) {
    const document = {
      ...editor,
      revision: expected + 1,
      updatedAt: new Date().toISOString(),
    };
    const written = this.store.db
      .prepare(
        "UPDATE metadata SET value=? WHERE key=? AND json_extract(value, '$.revision')=?",
      )
      .run(JSON.stringify(document), `image_editor:${editor.id}`, expected);
    if (!written.changes)
      throw fail(
        "This image was changed elsewhere. Reload and try again.",
        409,
      );
    return document;
  }
  async open(input) {
    if (/\.(gif|svg)$/i.test(input.source))
      throw new Error("SAM edits still raster images. Use a PNG, JPEG or WebP instead of an animation or vector.");
    const file = this.assetPath(input.source);
    const bytes = await readFile(file);
    const sourceHash = hash(bytes);
    const match = [...this.store.runs.values()]
      .flatMap((run) => run.jobs.map((job) => ({ run, job })))
      .find(
        ({ run, job }) =>
          job.output === input.source &&
          (!input.runId || run.id === input.runId) &&
          (!input.jobId || job.id === input.jobId),
      );
    if ((input.runId || input.jobId) && !match)
      throw fail("The source image does not match that run/job.");
    if (match?.run.projectId)
      this.projects.assertWorkflow(match.run, input.projectId);
    else if (input.projectId) this.projects.require(input.projectId);
    const projectId = match?.run.projectId || input.projectId;
    const provenance =
      match?.job.edit ||
      match?.run.graph?.nodes.find((node) => node.id === match.job.nodeId)?.data
        .edit;
    const parent = provenance?.editorId
      ? this.get(provenance.editorId, projectId)
      : null;
    if (parent && ownerOf(parent) !== projectId)
      throw fail("The image version belongs to a different project.", 409);
    const prepared = parent?.requests.find(
      (request) => request.id === provenance.requestId,
    );
    if (parent && (!prepared || provenance.source !== parent.source.url))
      throw fail("The image version has no matching source edit.", 409);
    const familyId = parent?.familyId || parent?.id;
    const id = hash(`${input.source}\0${sourceHash}\0${projectId || ""}`).slice(
      0,
      32,
    );
    const old = this.store.db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get(`image_editor:${id}`);
    if (old) {
      const document = JSON.parse(old.value);
      if (parent && !document.parentEditorId)
        this.save(
          { ...document, familyId, parentEditorId: parent.id },
          document.revision,
        );
      return this.get(id, projectId);
    }
    const metadata = await sharp(bytes, {
      limitInputPixels: 16_000_000,
    }).metadata();
    const swap = metadata.orientation >= 5 && metadata.orientation <= 8;
    const now = new Date().toISOString();
    const editor = {
      id,
      familyId: familyId || id,
      ...(parent && { parentEditorId: parent.id }),
      ...(projectId && { projectId }),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      width: swap ? metadata.height : metadata.width,
      height: swap ? metadata.width : metadata.height,
      source: {
        url: input.source,
        hash: sourceHash,
        ...((match ? match.run.projectId : projectId) && {
          projectId: match ? match.run.projectId : projectId,
        }),
        ...(match && {
          runId: match.run.id,
          jobId: match.job.id,
          workflowId: match.run.workflowId,
        }),
      },
      segmentation: { status: "idle", model: "sam2.1" },
      regions: [],
      comments: [],
      requests: [],
    };
    if (
      prepared?.inheritance &&
      ["region", "recolor"].includes(provenance.mode)
    ) {
      const snapshot = prepared.inheritance;
      if (editor.width !== parent.width || editor.height !== parent.height)
        throw fail(
          "Edited image dimensions changed. Generate a whole-image version or detect new regions.",
        );
      await mkdir(this.directory(id), { recursive: true });
      editor.regions = await Promise.all(
        snapshot.regions.map(async (region) => {
          await this.copyMask(
            this.directory(parent.id),
            region.file,
            this.directory(id),
            region.file,
          );
          return { ...region, mask: `/files/editors/${id}/${region.file}` };
        }),
      );
      const consumed = new Set(
        provenance.mode === "recolor"
          ? []
          : prepared.comments.map((comment) => comment.id),
      );
      editor.comments = snapshot.comments.map((comment) =>
        consumed.has(comment.id)
          ? { ...comment, resolved: true, appliedBy: prepared.id }
          : { ...comment },
      );
      editor.segmentation = {
        ...snapshot.segmentation,
        status: "ready",
        inheritedFrom: parent.id,
        needsReview: provenance.mode === "region",
      };
      editor.inheritedSelection = snapshot.selectedRegionIds;
    }
    this.store.db
      .prepare("INSERT OR IGNORE INTO metadata (key,value) VALUES (?,?)")
      .run(`image_editor:${id}`, JSON.stringify(editor));
    await this.assets?.captureRegions(editor);
    return this.get(id, projectId);
  }
  async copyMask(from, name, to, target) {
    if (path.basename(name) !== name || path.basename(target) !== target)
      throw fail("Invalid stored region mask.");
    const temporary = path.join(to, `${randomUUID()}.tmp`);
    await copyFile(path.join(from, name), temporary);
    await rename(temporary, path.join(to, target));
  }
  directory(id) {
    editorIdSchema.parse(id);
    return path.join(this.dataRoot, "editors", id);
  }
  patch(id, input, projectId) {
    const editor = this.get(id, projectId);
    if (editor.revision !== input.revision)
      throw fail(
        "This image was changed elsewhere. Reload and try again.",
        409,
      );
    if (input.layer) {
      const region = editor.regions.find((r) => r.id === input.layer.id);
      if (!region) throw fail("Region not found.", 404);
      if (
        region.locked &&
        (input.layer.label !== undefined || input.layer.visible !== undefined)
      )
        throw fail("Unlock this layer first.", 409);
      Object.assign(region, input.layer);
      if (input.layer.label !== undefined) region.labelSource = "manual";
    }
    if (input.order) {
      if (
        new Set(input.order).size !== editor.regions.length ||
        input.order.length !== editor.regions.length ||
        input.order.some((id) => !editor.regions.some((r) => r.id === id))
      )
        throw fail("Layer order must contain every region exactly once.");
      editor.regions = input.order.map((id) =>
        editor.regions.find((r) => r.id === id),
      );
    }
    if (input.comment) {
      this.regions(editor, input.comment.regionIds);
      editor.comments.push({
        id: randomUUID(),
        ...input.comment,
        createdAt: new Date().toISOString(),
        resolved: false,
      });
    }
    if (input.resolve) {
      const comment = editor.comments.find((c) => c.id === input.resolve.id);
      if (!comment) throw fail("Comment not found.", 404);
      comment.resolved = input.resolve.resolved;
    }
    return this.save(editor, input.revision);
  }
  regions(editor, ids) {
    const regions = [...new Set(ids)].map((id) =>
      editor.regions.find((r) => r.id === id),
    );
    if (regions.some((r) => !r)) throw fail("A selected region was not found.");
    return regions;
  }
  nameRegions(id, { providerId = "codex-text", model } = {}, projectId) {
    const editor = this.get(id, projectId);
    this.projects.assertActive({ projectId: ownerOf(editor) });
    if (this.naming.has(id)) {
      this.naming.get(id).followup = true;
      return editor;
    }
    if (["running", "queued"].includes(editor.segmentation.status))
      throw fail("Wait for segmentation before naming regions.", 409);
    const regions = editor.regions.filter(needsRegionName);
    if (!regions.length) return editor;
    const controller = new AbortController();
    const queued = this.save(
      {
        ...editor,
        naming: {
          status: "queued",
          providerId,
          model,
          completed: 0,
          total: regions.length,
          startedAt: new Date().toISOString(),
        },
      },
      editor.revision,
    );
    const task = { controller, promise: null };
    this.naming.set(id, task);
    task.promise = Promise.resolve().then(async () => {
      const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
      let completed = 0;
      try {
        const input = this.assetPath(editor.source.url);
        if (hash(await readFile(input)) !== editor.source.hash)
          throw new Error(
            "The source file changed. Reopen the image before naming regions.",
          );
        for (let offset = 0; offset < regions.length; offset += 12) {
          if (controller.signal.aborted)
            throw new Error("Region naming cancelled.");
          const latest = this.get(id);
          this.projects.assertActive({ projectId: ownerOf(latest) });
          this.save(
            {
              ...latest,
              naming: {
                ...latest.naming,
                status: "running",
                message: `Naming regions ${offset + 1}–${Math.min(offset + 12, regions.length)} with ${providerId}`,
              },
            },
            latest.revision,
          );
          const batch = regions.slice(offset, offset + 12);
          const result = await this.namer({
            editor,
            regions: batch,
            directory: path.join(this.directory(id), "naming", randomUUID()),
            providers: this.providers,
            assetPath: this.assetPath,
            providerId,
            model,
            signal: controller.signal,
          });
          if (controller.signal.aborted)
            throw new Error("Region naming cancelled.");
          const current = this.get(id);
          for (const name of result.names) {
            const region = current.regions.find((r) => r.id === name.id);
            const snapshot = batch.find((r) => r.id === name.id);
            if (
              region &&
              snapshot &&
              needsRegionName(region) &&
              region.label === snapshot.label
            ) {
              region.label = name.label;
              region.labelSource = "vision";
              region.labelProviderId = providerId;
              region.labelModel = result.model;
            }
          }
          completed += batch.length;
          this.save(
            {
              ...current,
              naming: {
                ...current.naming,
                model: result.model,
                completed,
                message: `${completed}/${regions.length} regions named`,
              },
            },
            current.revision,
          );
        }
        const latest = this.get(id);
        this.save(
          {
            ...latest,
            naming: {
              ...latest.naming,
              status: "ready",
              finishedAt: new Date().toISOString(),
            },
          },
          latest.revision,
        );
      } catch (error) {
        const latest = this.get(id);
        this.save(
          {
            ...latest,
            naming: {
              ...latest.naming,
              status: controller.signal.aborted ? "cancelled" : "failed",
              error: controller.signal.aborted
                ? "Naming stopped. Your masks and existing names are preserved."
                : error.message,
              finishedAt: new Date().toISOString(),
            },
          },
          latest.revision,
        );
      } finally {
        clearTimeout(timer);
        this.naming.delete(id);
        const current = this.get(id);
        if (
          !this.closing &&
          task.followup &&
          current.naming.status === "ready" &&
          !this.active.has(id) &&
          current.regions.some(needsRegionName)
        )
          this.startAutomaticNames(id, { providerId, model });
      }
    });
    return queued;
  }
  cancelNaming(id, projectId) {
    this.get(id, projectId);
    this.naming.get(id)?.controller.abort();
    return this.get(id, projectId);
  }
  startAutomaticNames(id, input) {
    try {
      this.nameRegions(id, input);
    } catch (error) {
      const latest = this.get(id);
      this.save(
        {
          ...latest,
          naming: { ...latest.naming, status: "failed", error: error.message },
        },
        latest.revision,
      );
    }
  }
  async segment(id, { point, names }, projectId) {
    let editor = this.get(id, projectId);
    if (this.active.has(id)) return editor;
    if (editor.regions.length >= 160)
      throw fail("This image already has 160 regions.");
    const modelStatus = await this.model.status();
    if (!modelStatus.ready)
      throw fail("Install the local SAM model first.", 409);
    const autoModel =
      editor.segmentation.autoModel || editor.segmentation.model;
    if (
      !point &&
      editor.regions.length &&
      (!modelStatus.model || autoModel === modelStatus.model)
    )
      return editor;
    // Read again after the async readiness check so two callers cannot enqueue twice.
    if (this.active.has(id)) return this.get(id, projectId);
    editor = this.get(id, projectId);
    const controller = new AbortController();
    this.active.set(id, controller);
    const queued = this.save(
      {
        ...editor,
        segmentation: {
          ...editor.segmentation,
          status: "queued",
          model: modelStatus.model || "sam2.1",
          autoModel,
          point,
          error: undefined,
          progress: {
            stage: "queued",
            message: "Waiting for the local segmentation worker",
          },
          startedAt: undefined,
          finishedAt: undefined,
        },
      },
      editor.revision,
    );
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
        try {
          if (controller.signal.aborted)
            throw new Error("Segmentation cancelled.");
          const current = this.get(id);
          this.save(
            {
              ...current,
              segmentation: {
                ...current.segmentation,
                status: "running",
                startedAt: new Date().toISOString(),
              },
            },
            current.revision,
          );
          const input = this.assetPath(current.source.url);
          if (hash(await readFile(input)) !== current.source.hash)
            throw new Error(
              "The source file changed. Reopen the image before segmenting.",
            );
          const output = resultSchema.parse(
            await this.model.run({
              input,
              directory: this.directory(id),
              point,
              signal: controller.signal,
              onProgress: (event) => {
                const parsed = progressSchema.safeParse(event);
                if (!parsed.success) return;
                const latest = this.get(id);
                const previous = latest.segmentation.progress;
                const now = Date.now();
                if (
                  previous?.stage === parsed.data.stage &&
                  now - Date.parse(previous.updatedAt || 0) < 200 &&
                  parsed.data.completed !== parsed.data.total
                )
                  return;
                this.save(
                  {
                    ...latest,
                    segmentation: {
                      ...latest.segmentation,
                      progress: {
                        ...parsed.data,
                        updatedAt: new Date(now).toISOString(),
                      },
                    },
                  },
                  latest.revision,
                );
              },
            }),
          );
          if (
            output.width !== current.width ||
            output.height !== current.height
          )
            throw new Error("Segmentation dimensions do not match the source.");
          const latest = this.get(id);
          const regions = output.regions
            .slice(0, 160 - latest.regions.length)
            .map((r, i) => ({
              ...r,
              model: output.model,
              label: `Region ${latest.regions.length + i + 1}`,
              labelSource: "sam",
              visible: true,
              locked: false,
              mask: `/files/editors/${id}/${r.file}`,
            }));
          if (!point) regions.reverse();
          this.save(
            {
              ...latest,
              regions: [...latest.regions, ...regions],
              segmentation: {
                status: "ready",
                model: output.model,
                autoModel: point ? latest.segmentation.autoModel : output.model,
                device: output.device,
                startedAt: this.get(id).segmentation.startedAt,
                finishedAt: new Date().toISOString(),
                progress: {
                  stage: "ready",
                  message: `${regions.length} regions ready`,
                },
              },
            },
            latest.revision,
          );
          await this.assets?.captureRegions(this.get(id), regions);
        } catch (error) {
          const latest = this.get(id);
          this.save(
            {
              ...latest,
              segmentation: {
                ...latest.segmentation,
                status: "failed",
                error: error.message,
                finishedAt: new Date().toISOString(),
              },
            },
            latest.revision,
          );
        } finally {
          clearTimeout(timer);
          this.active.delete(id);
          if (
            names !== false &&
            this.providers?.run &&
            this.get(id).segmentation.status === "ready"
          )
            this.startAutomaticNames(
              id,
              names || {
                providerId: this.get(id).naming?.providerId || "codex-text",
                model: this.get(id).naming?.model,
              },
            );
        }
      });
    return queued;
  }
  async request(id, input, projectId) {
    const editor = this.get(id, projectId);
    if (input.revision !== editor.revision)
      throw fail(
        "This image was changed elsewhere. Reload and try again.",
        409,
      );
    this.projects.assertActive({ projectId: ownerOf(editor) });
    if (
      hash(await readFile(this.assetPath(editor.source.url))) !==
      editor.source.hash
    )
      throw fail(
        "The source file changed. Reopen the image before preparing an edit.",
      );
    const regions = this.regions(editor, input.regionIds);
    if (input.mode !== "whole" && regions.some((r) => r.locked || !r.visible))
      throw fail("Unlock and show selected layers before creating an edit.");
    const prompt = editBrief(editor, input);
    const requestId = randomUUID();
    const directory = this.directory(id);
    await mkdir(directory, { recursive: true });
    const mode = input.mode || "whole";
    let inheritance;
    if (mode !== "whole") {
      const snapshots = await Promise.all(
        editor.regions.map(async (region) => {
          const frozenFile = `${requestId}-${region.id}.png`;
          await this.copyMask(directory, region.file, directory, frozenFile);
          return {
            ...region,
            file: frozenFile,
            mask: `/files/editors/${id}/${frozenFile}`,
          };
        }),
      );
      inheritance = {
        regions: snapshots,
        comments: structuredClone(editor.comments),
        segmentation: structuredClone(editor.segmentation),
        selectedRegionIds: [...new Set(input.regionIds)],
      };
    }
    const union = Buffer.alloc(editor.width * editor.height);
    for (const region of regions) {
      const { data, info } = await sharp(path.join(directory, region.file))
        .greyscale()
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (
        info.width !== editor.width ||
        info.height !== editor.height ||
        info.channels !== 1
      )
        throw fail("A stored mask does not match this image.");
      for (let i = 0; i < union.length; i++) if (data[i]) union[i] = 255;
    }
    const file = (suffix) => `${requestId}-${suffix}.png`;
    const asset = (suffix) => `/files/editors/${id}/${file(suffix)}`;
    await sharp(union, {
      raw: { width: editor.width, height: editor.height, channels: 1 },
    })
      .png()
      .toFile(path.join(directory, file("mask")));
    const source = this.assetPath(editor.source.url);
    const { data, info } = await sharp(source)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < union.length; i++)
      data[i * 4 + 3] = Math.round((data[i * 4 + 3] * union[i]) / 255);
    await sharp(data, { raw: info })
      .png()
      .toFile(path.join(directory, file("cutout")));
    const overlay = `<svg width="${editor.width}" height="${editor.height}" xmlns="http://www.w3.org/2000/svg">${regions.map((r, i) => `<path d="${r.path}" fill="${["#98a9ff", "#6ee7d2", "#f7bf83"][i % 3]}" fill-opacity="0.35" stroke="white" stroke-width="2" fill-rule="evenodd"/><text x="${r.bbox[0] + 10}" y="${r.bbox[1] + 28}" fill="white" stroke="black" stroke-width="0.7" font-size="24">${i + 1}</text>`).join("")}</svg>`;
    await sharp(source)
      .rotate()
      .composite([{ input: Buffer.from(overlay) }])
      .png()
      .toFile(path.join(directory, file("overlay")));
    const ratio = editor.width / editor.height;
    const format = ["1:1", "2:1", "3:2", "2:3", "16:9", "9:16"].sort((a, b) => {
      const f = (r) => r.split(":").reduce((a, b) => a / b);
      return Math.abs(f(a) - ratio) - Math.abs(f(b) - ratio);
    })[0];
    const graph = validateGraph(
      createImageWorkflow({
        name: `${mode === "whole" ? "Regenerate image" : mode === "recolor" ? "Recolor" : "Region edit"} · ${regions[0]?.label || "Image"}`,
        projectId: ownerOf(editor),
        prompt:
          mode === "whole"
            ? prompt +
              (regions.length
                ? "\n\nReference 1 is the original image. Reference 2 is a numbered annotation map for guidance only. Never include its colors, outlines, numbers or labels in the artwork."
                : "")
            : prompt +
              "\n\nReference 1: original. Reference 2: numbered annotation map. Reference 3: binary mask (white may change; black should be preserved). Mask guidance is advisory unless the chosen provider supports strict inpainting.",
        images:
          mode === "whole"
            ? [editor.source.url, ...(regions.length ? [asset("overlay")] : [])]
            : [editor.source.url, asset("overlay"), asset("mask")],
        providerId: mode === "recolor" ? "local-recolor" : input.providerId,
        model: mode === "recolor" ? "recolor" : input.model,
        count: input.count,
        ratio: format,
      }),
    ).graph;
    graph.nodes.find((n) => n.type === "generate").data.edit = {
      editorId: id,
      requestId,
      mode,
      familyId: editor.familyId || id,
      sourceHash: editor.source.hash,
      ...(mode === "recolor" && {
        color: input.color,
        strength: input.strength ?? 1,
      }),
      source: editor.source.url,
      regionIds: input.regionIds,
      mask: asset("mask"),
      overlay: asset("overlay"),
    };
    const request = {
      id: requestId,
      mode,
      ...(mode === "recolor" && {
        color: input.color,
        strength: input.strength ?? 1,
      }),
      ...(inheritance && { inheritance }),
      createdAt: new Date().toISOString(),
      workflowId: graph.id,
      regionIds: input.regionIds,
      instructions: input.instructions,
      prompt,
      source: editor.source,
      regions: inheritance
        ? inheritance.regions.filter((region) =>
            input.regionIds.includes(region.id),
          )
        : regions,
      comments: editor.comments.filter(
        (c) =>
          mode !== "recolor" &&
          !c.resolved &&
          (mode === "whole" ||
            c.regionIds.some((id) => input.regionIds.includes(id))),
      ),
      mask: asset("mask"),
      overlay: asset("overlay"),
      cutout: asset("cutout"),
      maskSemantics: "white-edit-black-preserve",
      strictInpainting: false,
      preserveOutsideMask: mode !== "whole",
      workflow: structuredClone(graph),
    };
    // A revision conflict must not create an unintended generation workflow.
    const current = this.get(id, projectId);
    if (current.revision !== input.revision)
      throw fail(
        "This image was changed elsewhere. Reload and try again.",
        409,
      );
    this.projects.assertActive(graph);
    const saved = this.save(
      { ...editor, requests: [...editor.requests, request] },
      input.revision,
    );
    await this.store.saveWorkflow(graph);
    await this.assets?.captureEditor(saved, request);
    return { editor: saved, request, workflow: graph };
  }
  async send(id, requestId, projectId) {
    // Validate ownership before sharing a pending operation with another caller.
    this.get(id, projectId);
    const key = `${id}:${requestId}`;
    if (this.sending.has(key)) return this.sending.get(key);
    const operation = (async () => {
      const editor = this.get(id, projectId);
      const request = editor.requests.find((r) => r.id === requestId);
      if (!request) throw fail("Edit request not found.", 404);
      // The run snapshot is the durable receipt, including after a server crash.
      let run = this.runFor(editor, request);
      if (!run) {
        if (
          hash(await readFile(this.assetPath(request.source.url))) !==
          request.source.hash
        )
          throw fail(
            "The source file changed after this edit was prepared. Reopen the image and prepare a new edit.",
            409,
          );
        const graph =
          request.workflow || this.store.workflows.get(request.workflowId);
        if (!graph?.nodes.some((n) => n.data?.edit?.requestId === requestId))
          throw fail(
            "The prepared workflow is unavailable. Prepare a new edit.",
            409,
          );
        run = await startWorkflowRun(this, {
          graph,
          projectId: ownerOf(editor),
        });
      }
      const latest = this.get(id, projectId);
      const snapshot = latest.requests.find((r) => r.id === requestId);
      if (!snapshot.runId) {
        snapshot.runId = run.id;
        snapshot.sentAt = new Date().toISOString();
        this.save(latest, latest.revision);
      }
      this.queue?.pump();
      return {
        editor: this.get(id, projectId),
        request: this.get(id, projectId).requests.find(
          (r) => r.id === requestId,
        ),
        run,
      };
    })();
    this.sending.set(key, operation);
    try {
      return await operation;
    } finally {
      this.sending.delete(key);
    }
  }
  async file(id, name) {
    const editor = this.get(id);
    const allowed =
      editor.regions.some((r) => r.file === name) ||
      editor.requests.some(
        (r) =>
          [r.mask, r.overlay, r.cutout].some((url) =>
            url.endsWith("/" + name),
          ) || r.inheritance?.regions.some((region) => region.file === name),
      );
    if (!allowed) throw fail("Editor asset not found.", 404);
    const file = path.join(this.directory(id), name);
    await access(file);
    return file;
  }
  async close() {
    this.closing = true;
    for (const controller of this.active.values()) controller.abort();
    await this.pending;
    for (const task of this.naming.values()) task.controller.abort();
    await Promise.allSettled(
      [...this.naming.values()].map((task) => task.promise),
    );
    await Promise.allSettled([...this.sending.values()]);
  }
}
