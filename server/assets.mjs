import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { mediaArtifact, mediaKind, imageMimeType } from "../shared/media.mjs";
import {
  assetIdSchema,
  assetAnnotationsSchema,
  datasetModeSchema,
} from "../shared/assets.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
async function fingerprint(file, evidence) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    sizeBytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), sizeBytes, observedAt: now(), evidence };
}
const defaultSeed = (job) => ({
  requested: job.seed ?? null,
  sent:
    job.metadata?.seedMode === "parameter" ||
    job.metadata?.seedMode === "deterministic"
      ? (job.seed ?? null)
      : null,
  effective: job.metadata?.effectiveSeed ?? null,
  semantics: job.metadata?.seedMode || "unknown",
});
function graphSources(run, job) {
  const fields = Object.assign(
    {},
    ...(job.records || []).map((record) => record.fields),
  );
  const byId = new Map((run.graph?.nodes || []).map((node) => [node.id, node]));
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (
      node?.type === "filter" &&
      Object.hasOwn(fields, node.data.filterField) &&
      !node.data.filterValues?.includes(fields[node.data.filterField])
    )
      return;
    visited.add(id);
    for (const edge of run.graph?.edges || [])
      if (edge.target === id) visit(edge.source);
  }
  visit(job.nodeId);
  return (run.graph?.nodes || []).filter((node) => visited.has(node.id));
}

// Run snapshots own execution. This service owns artifact facts and separately revisioned reviews.
export class Assets {
  constructor({ store, resolveAsset }) {
    this.store = store;
    this.resolveAsset = resolveAsset;
  }
  scope(projectId) {
    if (projectId != null && !this.store.projects.has(projectId))
      throw fail("Project not found.", 404);
  }
  file(url) {
    const match =
      /^\/files\/runs\/([a-f0-9-]+)\/([a-f0-9-]+)\/(output\.(?:png|jpeg|webp|gif|svg|mp4|txt)|original-attempt-\d+\.(?:png|jpg|webp|gif|svg)|input-\d+\.(?:png|jpe?g|webp))$/.exec(
        url,
      );
    if (match) {
      const run = this.store.runs.get(match[1]);
      const job = run?.jobs.find((job) => job.id === match[2]);
      if (
        !job ||
        (mediaArtifact(job).basename !== match[3] &&
          job.metadata?.originalFile !== match[3] &&
          !job.lineage?.inputs.some((ref) => ref.snapshotFile === match[3]))
      )
        throw fail("Unknown generated asset.", 404);
      return path.join(this.store.root, "runs", match[1], match[2], match[3]);
    }
    return this.resolveAsset(url);
  }
  producer(url) {
    for (const run of this.store.runs.values())
      for (const job of run.jobs) {
        const output =
          job.output ||
          (job.kind === "text" && job.status === "completed"
            ? `/files/runs/${run.id}/${job.id}/output.txt`
            : null);
        if (output === url) return { run, job };
      }
    return null;
  }
  view(asset) {
    return { ...asset, annotations: this.store.assetAnnotations(asset.id) };
  }
  get(id, projectId) {
    assetIdSchema.parse(id);
    this.scope(projectId);
    const asset = this.store.assetRecord(id);
    if (
      !asset ||
      (projectId !== undefined && (asset.projectId ?? null) !== projectId)
    )
      throw fail("Asset not found in this project.", 404);
    return this.view(asset);
  }
  async verify(asset) {
    const actual = await fingerprint(this.file(asset.url), "verification");
    if (
      actual.sha256 !== asset.fingerprint.sha256 ||
      actual.sizeBytes !== asset.fingerprint.sizeBytes
    )
      throw fail(
        "Asset bytes changed since they were captured. Import the changed image as a new asset.",
        409,
      );
    return actual;
  }
  save({
    url,
    projectId,
    kind,
    origin,
    fingerprint: fp,
    parents = [],
    provenance,
    createdAt,
  }) {
    const id = digest(`${projectId || ""}\0${url}\0${fp.sha256}`);
    return this.store.saveAssetRecord({
      id,
      url,
      ...(projectId && { projectId }),
      kind,
      mimeType:
        (kind === "image" && imageMimeType(path.extname(url).slice(1))) ||
        mediaArtifact(kind).mimeType,
      fingerprint: fp,
      origin,
      parents,
      provenance,
      createdAt: createdAt || now(),
    });
  }
  async observe(
    url,
    projectId,
    {
      evidence = "historical-observation",
      origin,
      kind = "image",
      provenance,
      parents = [],
      verify = true,
      seen = new Set(),
    } = {},
  ) {
    const old = this.store
      .assetRecords({ projectId, url })
      .find((asset) => (asset.projectId ?? null) === (projectId ?? null));
    if (old) {
      if (verify) await this.verify(old);
      return old;
    }
    const producer = this.producer(url);
    if (producer) {
      kind = mediaKind(producer.job);
      if ((producer.run.projectId ?? null) === (projectId ?? null)) {
        origin ||= {
          type: "job",
          runId: producer.run.id,
          jobId: producer.job.id,
          workflowId: producer.run.workflowId,
          role: "final",
        };
        provenance ||= this.provenance(
          producer.run,
          producer.job,
          "historical-partial",
        );
        const key = `${projectId || ""}:${url}`;
        if (seen.has(key) || seen.size > 1000)
          throw fail(
            "Historical lineage contains a cycle or exceeds the traversal limit.",
          );
        const ancestors = new Set(seen);
        ancestors.add(key);
        const refs = [
          ...(producer.job.images || []).map((ref, index) => ({
            url:
              ref.asset ||
              producer.run.jobs.find((parent) => parent.id === ref.jobId)
                ?.output,
            role: "reference",
            ordinal: index,
          })),
          ...(producer.job.promptParts || [])
            .filter((part) => part.jobId)
            .map((part, index) => ({
              url: `/files/runs/${producer.run.id}/${part.jobId}/output.txt`,
              role: "generated-prompt",
              ordinal: index,
            })),
        ];
        const edit =
          producer.job.edit ||
          producer.run.graph?.nodes.find(
            (node) => node.id === producer.job.nodeId,
          )?.data.edit;
        if (edit)
          for (const [role, source] of [
            ["edit-original", edit.source],
            ["mask", edit.mask],
            ["annotation-map", edit.overlay],
          ])
            if (source) refs.push({ url: source, role, ordinal: refs.length });
        for (const ref of refs) {
          if (!ref.url) continue;
          try {
            const parent = await this.observe(ref.url, projectId, {
              seen: ancestors,
            });
            parents.push({
              assetId: parent.id,
              role: ref.role,
              ordinal: ref.ordinal,
            });
          } catch (error) {
            (provenance.missingInputs ||= []).push({
              url: ref.url,
              role: ref.role,
              reason:
                error.code === "ENOENT"
                  ? "File unavailable."
                  : "Historical input cannot be verified.",
            });
          }
        }
      } else origin ||= { type: "external-reference" };
    }
    return this.save({
      url,
      projectId,
      kind,
      origin: origin || { type: "historical" },
      fingerprint: await fingerprint(this.file(url), evidence),
      parents,
      provenance: provenance || { completeness: "historical-partial" },
    });
  }
  async captureUpload({ url, name, projectId }) {
    this.scope(projectId);
    return this.view(
      await this.observe(url, projectId, {
        evidence: "captured-at-upload",
        origin: { type: "upload", originalName: name },
        provenance: { completeness: "captured" },
      }),
    );
  }
  async captureRegions(editor, regions = editor.regions) {
    if (!regions?.length) return;
    const projectId = editor.projectId || editor.source.projectId;
    const source = await this.observe(editor.source.url, projectId, {
      evidence: "captured-at-generation",
    });
    for (const region of regions)
      await this.observe(region.mask, projectId, {
        evidence: "captured-at-generation",
        origin: {
          type: "editor",
          editorId: editor.id,
          regionId: region.id,
          role: "region-mask",
        },
        parents: [{ assetId: source.id, role: "edit-original", ordinal: 0 }],
        provenance: {
          completeness: "captured",
          segmentation: {
            model: region.model || editor.segmentation.model,
            regionId: region.id,
            label: region.label,
          },
        },
      });
  }
  async captureEditor(editor, request) {
    const projectId = editor.projectId || editor.source.projectId;
    const source = await this.observe(editor.source.url, projectId, {
      evidence: "captured-at-generation",
    });
    await this.captureRegions(
      editor,
      request.regions.filter((region) => region.mask),
    );
    for (const role of ["mask", "overlay", "cutout"])
      if (request[role])
        await this.observe(request[role], projectId, {
          evidence: "captured-at-generation",
          origin: {
            type: "editor",
            editorId: editor.id,
            requestId: request.id,
            role,
          },
          parents: [{ assetId: source.id, role: "edit-original", ordinal: 0 }],
          provenance: {
            completeness: "captured",
            edit: {
              mode: request.mode,
              regionIds: request.regionIds,
              regions: request.regions.map((region) => ({
                id: region.id,
                label: region.label,
              })),
              comments: request.comments,
              instructions: request.instructions,
              maskSemantics: request.maskSemantics,
              preserveOutsideMask: request.preserveOutsideMask,
            },
          },
        });
  }
  provenance(run, job, completeness = "captured") {
    const nodes = graphSources(run, job);
    const prepared =
      job.edit &&
      this.store.imageEditRequest(job.edit.editorId, job.edit.requestId);
    const editRequest =
      prepared && (prepared.projectId ?? null) === (run.projectId ?? null)
        ? prepared.request
        : null;
    return {
      completeness,
      prompt: job.prompt || "",
      ...(job.instructions && { instructions: job.instructions }),
      ...(job.resultText && { resultText: job.resultText }),
      requested: {
        providerId: job.providerId || "codex",
        model: job.model ?? null,
        seed: job.seed ?? null,
        ratio: job.ratio ?? null,
        quality: job.quality ?? null,
        copiesInMode: job.mode?.count ?? null,
        outputCount: 1,
        ...(job.video && { video: structuredClone(job.video) }),
        ...(job.image && { image: structuredClone(job.image) }),
      },
      effective: {
        model: job.metadata?.actualModel ?? null,
        settings: job.metadata?.effectiveSettings ?? null,
        ...(job.metadata?.outputFormat && {
          artifact: Object.fromEntries(
            [
              "outputFormat",
              "width",
              "height",
              "frameCount",
              "frameDurationsMs",
              "durationMs",
              "loop",
              "animationMethod",
              "spriteGrid",
              "spriteSheet",
            ]
              .filter((key) => job.metadata[key] !== undefined)
              .map((key) => [key, structuredClone(job.metadata[key])]),
          ),
        }),
        seed:
          completeness === "captured"
            ? defaultSeed(job)
            : {
                requested: job.seed ?? null,
                sent: null,
                effective: null,
                semantics: "unknown",
              },
      },
      ...(job.metadata?.providerRequestId && {
        providerRequestId: job.metadata.providerRequestId,
      }),
      rules: structuredClone(job.rules || []),
      styles: nodes
        .filter((node) => node.data.style)
        .map((node) => ({
          nodeId: node.id,
          ...structuredClone(node.data.style),
        })),
      sources: nodes
        .filter((node) =>
          ["prompt", "prompt-set", "template", "variations"].includes(
            node.type,
          ),
        )
        .map((node) => ({
          nodeId: node.id,
          type: node.type,
          semantics: "node-configuration",
          label: node.data.label,
          text: node.data.text,
          lines: node.data.lines,
        })),
      records: structuredClone(job.records || []),
      ...(job.promptSet && { promptSet: structuredClone(job.promptSet) }),
      ...(job.comparison && { comparison: structuredClone(job.comparison) }),
      ...(job.mode && { mode: structuredClone(job.mode) }),
      ...(job.edit && {
        edit: {
          ...structuredClone(job.edit),
          requestSnapshot: editRequest
            ? {
                instructions: editRequest.instructions,
                comments: structuredClone(editRequest.comments),
                regions: editRequest.regions.map((region) => ({
                  id: region.id,
                  label: region.label,
                })),
                maskSemantics: editRequest.maskSemantics,
                preserveOutsideMask: editRequest.preserveOutsideMask,
                strictInpainting: editRequest.strictInpainting,
              }
            : null,
        },
      }),
    };
  }
  async captureInputs(run, job) {
    if (job.lineage) {
      for (const ref of job.lineage.inputs) {
        const asset = this.store.assetRecord(ref.assetId);
        if (!asset)
          throw fail(
            "A captured input asset is missing. This job cannot safely resume.",
            409,
          );
        await this.verify(asset);
      }
      if (job.lineage.prompt !== job.prompt)
        throw fail("Captured generation prompt changed. Start a new run.", 409);
      return;
    }
    const inputs = [];
    const add = async (url, role, ordinal) => {
      const asset = await this.observe(url, run.projectId, {
        evidence: "captured-at-generation",
      });
      inputs.push({
        assetId: asset.id,
        url,
        role,
        ordinal,
        fingerprint: {
          ...structuredClone(asset.fingerprint),
          observedAt: now(),
          evidence: "captured-at-generation",
        },
      });
    };
    for (const [ordinal, ref] of (job.images || []).entries()) {
      const parent =
        ref.jobId && run.jobs.find((parent) => parent.id === ref.jobId);
      const url = ref.asset || parent?.output;
      if (!url) throw fail("A generation image input is missing.");
      await add(
        url,
        ref.role === "markup" ? "annotation-map" : "reference",
        ordinal,
      );
    }
    for (const [ordinal, part] of (job.promptParts || []).entries())
      if (part.jobId) {
        const parent = run.jobs.find((parent) => parent.id === part.jobId);
        if (!parent || parent.kind !== "text" || parent.status !== "completed")
          throw fail("A generated prompt input is missing.");
        await add(
          `/files/runs/${run.id}/${parent.id}/output.txt`,
          "generated-prompt",
          ordinal,
        );
      }
    const edit =
      job.edit ||
      run.graph?.nodes.find((node) => node.id === job.nodeId)?.data.edit;
    if (edit)
      for (const [role, url] of [
        ["edit-original", edit.source],
        ["mask", edit.mask],
        ["annotation-map", edit.overlay],
      ])
        if (url) await add(url, role, inputs.length);
    job.lineage = {
      version: 1,
      capturedAt: now(),
      prompt: job.prompt,
      inputs,
      ...this.provenance(run, job),
    };
  }
  async freezeImages(run, job, directory, imagePaths) {
    const snapshots = [];
    for (const [index, file] of imagePaths.entries()) {
      const refs = job.lineage.inputs.filter(
        (ref) => this.file(ref.url) === file,
      );
      if (!refs.length)
        throw fail("An actual provider image is missing from captured inputs.");
      const extension = path.extname(file).toLowerCase();
      const name = `input-${index + 1}${[".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? extension : ".png"}`;
      const target = path.join(directory, name);
      try {
        await copyFile(file, target, constants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const actual = await fingerprint(target, "snapshot-verification");
      if (refs.some((ref) => ref.fingerprint.sha256 !== actual.sha256))
        throw fail(
          "Captured input snapshot bytes changed. Start a new run.",
          409,
        );
      const snapshot = this.save({
        url: `/files/runs/${run.id}/${job.id}/${name}`,
        projectId: run.projectId,
        kind: "image",
        origin: {
          type: "job-input",
          runId: run.id,
          jobId: job.id,
          role: "reference",
        },
        fingerprint: { ...actual, evidence: "captured-at-generation" },
        parents: refs.map((ref, ordinal) => ({
          assetId: ref.assetId,
          role: "copied-from",
          ordinal,
        })),
        provenance: { completeness: "captured" },
      });
      for (const ref of refs) {
        ref.snapshotFile = name;
        ref.snapshotAssetId = snapshot.id;
      }

      snapshots.push(target);
    }
    return snapshots;
  }
  async verifySnapshots(job, directory) {
    for (const ref of job.lineage?.inputs || [])
      if (ref.snapshotFile) {
        const actual = await fingerprint(
          path.join(directory, ref.snapshotFile),
          "snapshot-verification",
        );
        if (actual.sha256 !== ref.fingerprint.sha256)
          throw fail("A provider changed a captured input snapshot.", 409);
      }
  }
  async complete(run, job, directory) {
    const kind = mediaKind(job);
    const url = `/files/runs/${run.id}/${job.id}/${mediaArtifact(job).basename}`;
    const parents = (job.lineage?.inputs || []).map(
      ({ assetId, snapshotAssetId, role, ordinal }) => ({
        assetId: snapshotAssetId || assetId,
        role,
        ordinal,
      }),
    );
    const original = job.metadata?.originalFile;
    if (
      kind === "image" &&
      /^original-attempt-\d+\.(png|jpg|webp|gif|svg)$/.test(original || "")
    ) {
      const file = path.join(directory, original);
      if (await stat(file).catch(() => null)) {
        const rawUrl = `/files/runs/${run.id}/${job.id}/${original}`;
        const originalProvenance = this.provenance(run, job);
        if (job.metadata?.spriteSheet)
          originalProvenance.effective.artifact = {
            outputFormat: path.extname(original).slice(1),
            ...job.metadata.spriteSheet,
          };
        const raw = this.save({
          url: rawUrl,
          projectId: run.projectId,
          kind,
          origin: {
            type: "job",
            runId: run.id,
            jobId: job.id,
            role: "provider-original",
          },
          fingerprint: await fingerprint(file, "captured-at-generation"),
          parents: [...parents],
          provenance: originalProvenance,
        });
        parents.push({
          assetId: raw.id,
          role: "provider-original",
          ordinal: parents.length,
        });
      }
    }
    const asset = this.save({
      url,
      projectId: run.projectId,
      kind,
      origin: {
        type: "job",
        runId: run.id,
        jobId: job.id,
        nodeId: job.nodeId,
        workflowId: run.workflowId,
        role: "final",
      },
      fingerprint: await fingerprint(
        path.join(directory, mediaArtifact(job).basename),
        "captured-at-generation",
      ),
      parents,
      provenance: this.provenance(run, job),
    });
    job.assetId = asset.id;
    job.lineage = {
      ...job.lineage,
      output: { assetId: asset.id, url, fingerprint: asset.fingerprint },
      effective: asset.provenance.effective,
    };
    return asset;
  }
  async list({ projectId, url, runId, jobId, workflowId } = {}) {
    this.scope(projectId);
    const runs = [...this.store.runs.values()].filter(
      (run) =>
        (projectId === undefined || (run.projectId ?? null) === projectId) &&
        (!runId || run.id === runId) &&
        (!workflowId || run.workflowId === workflowId),
    );
    for (const run of runs)
      for (const job of run.jobs)
        if (job.status === "completed" && (!jobId || job.id === jobId)) {
          const source =
            job.output ||
            (job.kind === "text"
              ? `/files/runs/${run.id}/${job.id}/output.txt`
              : null);
          if (
            source &&
            (!url || source === url) &&
            !this.store
              .assetRecords({ projectId: run.projectId, url: source })
              .some((asset) => asset.projectId === run.projectId)
          ) {
            try {
              await this.observe(source, run.projectId, { verify: false });
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
          }
        }
    if (url && !this.store.assetRecords({ projectId, url }).length) {
      const producer = this.producer(url);
      if (
        producer &&
        projectId !== undefined &&
        (producer.run.projectId ?? null) !== projectId
      )
        throw fail("Asset not found in this project.", 404);
      try {
        await this.observe(url, projectId, { verify: false });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return this.store
      .assetRecords({ projectId, url })
      .filter(
        (asset) =>
          (!runId || asset.origin.runId === runId) &&
          (!jobId || asset.origin.jobId === jobId) &&
          (!workflowId ||
            this.store.runs.get(asset.origin.runId)?.workflowId === workflowId),
      )
      .map((asset) => this.view(asset));
  }
  lineage(id, projectId) {
    const asset = this.get(id, projectId),
      ancestors = [],
      missing = [],
      seen = new Set([id]);
    const visit = (item, depth) => {
      if (depth > 30 || seen.size > 1000) {
        missing.push({ reason: "Lineage traversal limit reached." });
        return;
      }
      for (const parent of item.parents || [])
        if (!seen.has(parent.assetId)) {
          seen.add(parent.assetId);
          const record = this.store.assetRecord(parent.assetId);
          if (
            !record ||
            (projectId !== undefined &&
              (record.projectId ?? null) !== projectId)
          ) {
            missing.push({
              assetId: parent.assetId,
              role: parent.role,
              reason: "Parent unavailable in this project.",
            });
            continue;
          }
          ancestors.push(this.view(record));
          visit(record, depth + 1);
        }
    };
    visit(asset, 0);
    for (const item of [asset, ...ancestors])
      for (const source of item.provenance?.missingInputs || [])
        missing.push({ ...source, assetId: item.id });
    const labels = new Map();
    for (const item of [asset, ...ancestors]) {
      const run = this.store.runs.get(item.origin?.runId);
      const job = run?.jobs.find((entry) => entry.id === item.origin?.jobId);
      for (const ref of job?.images || []) {
        const url =
          ref.asset || run.jobs.find((entry) => entry.id === ref.jobId)?.output;
        const label = run.graph?.nodes.find((node) =>
          node.data.images?.includes(url),
        )?.data.label;
        if (!label) continue;
        labels.set(url, label);
        for (const input of job.lineage?.inputs || [])
          if (input.url === url && input.snapshotAssetId) {
            const snapshot = this.store.assetRecord(input.snapshotAssetId);
            if (snapshot) labels.set(snapshot.url, label);
          }
      }
    }
    const describe = (record) => {
      const item = labels.has(record.url)
        ? { ...record, displayName: labels.get(record.url) }
        : record;
      if (item.origin?.type !== "job") return item;
      const run = this.store.runs.get(item.origin?.runId);
      const job = run?.jobs.find((entry) => entry.id === item.origin?.jobId);
      if (!job || (run.projectId ?? null) !== (item.projectId ?? null))
        return item;
      return {
        ...item,
        generation: {
          runId: run.id,
          runName: run.name,
          workflowId: run.workflowId,
          workflowName: run.graph?.name || run.name,
          nodeId: job.nodeId,
          nodeLabel: job.label,
          providerId: job.providerId,
          providerName: job.metadata?.providerName,
          model: job.metadata?.actualModel || job.metadata?.model || job.model,
          instructions: item.provenance?.instructions ?? job.instructions,
          resultText: item.provenance?.resultText ?? job.resultText,
        },
      };
    };
    return {
      asset: describe(asset),
      ancestors: ancestors.map(describe),
      missing,
    };
  }
  annotate(id, input, projectId) {
    const asset = this.get(id, projectId),
      patch = assetAnnotationsSchema.parse(input),
      previous = asset.annotations;
    if (previous.revision !== patch.revision)
      throw fail(
        "Asset annotations changed elsewhere. Reload before saving.",
        409,
      );
    const annotations = {
      ...previous,
      ...patch,
      revision: previous.revision + 1,
      updatedAt: now(),
    };
    if (!this.store.saveAssetAnnotations(id, patch.revision, annotations))
      throw fail(
        "Asset annotations changed elsewhere. Reload before saving.",
        409,
      );
    return this.get(id, projectId);
  }
  async dataset({ projectId, runId, workflowId, mode = "all" } = {}) {
    datasetModeSchema.parse(mode);
    const assets = await this.list({ projectId, runId, workflowId }),
      rows = [],
      skipped = [];
    for (const asset of assets) {
      const reasons = [];
      if (asset.annotations.decision !== "accepted")
        reasons.push("not-accepted");
      if (!asset.annotations.training.allowed)
        reasons.push("training-not-allowed");
      if (asset.annotations.training.rights !== "confirmed")
        reasons.push("rights-not-confirmed");
      if (asset.provenance.completeness !== "captured")
        reasons.push("historical-partial");
      if (asset.origin.type !== "job" || asset.origin.role !== "final")
        reasons.push("not-final-generation");
      try {
        await this.verify(asset);
      } catch {
        reasons.push("bytes-unavailable-or-changed");
      }
      const { ancestors, missing } = this.lineage(asset.id, projectId);
      const row = {
        schemaVersion: 1,
        lineage: { ancestors, missing },
        asset,
        eligibility: { training: reasons.length === 0, reasons },
      };
      if (mode === "training" && reasons.length)
        skipped.push({ assetId: asset.id, reasons });
      else rows.push(row);
    }
    return { rows, skipped, total: assets.length, mode };
  }
}
