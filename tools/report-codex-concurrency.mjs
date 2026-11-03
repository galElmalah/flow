#!/usr/bin/env node
import { readFile, writeFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { WeftClient } from "../client/index.mjs";

const root = path.resolve(import.meta.dirname, "..");
const directory = path.resolve(
  process.env.WEFT_BENCHMARK_DIR ||
    path.join(root, "docs/benchmarks/codex-2026-10-29"),
);
const experiment = JSON.parse(
  await readFile(path.join(directory, "experiment.json"), "utf8"),
);
const client = new WeftClient({ projectId: "quoture" });
const identity = await client.request("/api/server");
const nativeRoot =
  path.join(os.homedir(), ".codex", "generated_images") + path.sep;
const frozenRecords = experiment.workflow.nodes.find(
  (node) => node.type === "dataset",
).data.records;
const frozenImages = experiment.workflow.nodes.find(
  (node) => node.type === "image",
).data.images;
const frozenGenerate = experiment.workflow.nodes.find(
  (node) => node.type === "generate",
).data;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const results = [];
for (const phase of experiment.phases.filter((p) => p.summary)) {
  const run = await client.inspect(phase.runId),
    proofs = [];
  for (const job of run.jobs.filter((j) => j.status === "completed")) {
    const folder = path.join(identity.dataDirectory, "runs", run.id, job.id);
    const events = (await readFile(path.join(folder, "events.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const threadId = events.find(
      (event) => event.type === "thread.started",
    )?.thread_id;
    const candidates = events.flatMap((event) => {
      const text =
        event.item?.type === "command_execution"
          ? event.item.command
          : event.item?.type === "mcp_tool_call"
            ? JSON.stringify(event.item.arguments || {})
            : "";
      return [
        ...text.matchAll(
          /\/Users\/[^\s'"\\]+\/\.codex\/generated_images\/[^\s'"\\]+\.(?:png|jpe?g|webp)/g,
        ),
      ].map((match) => match[0]);
    });
    const nativePath = candidates.find(
      (file) =>
        file.startsWith(nativeRoot) &&
        path.basename(path.dirname(file)) === threadId,
    );
    const recordId = job.records?.[0]?.id;
    const recordIndex = frozenRecords.findIndex(
      (record) => record.id === recordId,
    );
    const matchesFrozenInput =
      recordIndex >= 0 &&
      job.prompt === frozenRecords[recordIndex].fields.brief &&
      job.seed === frozenGenerate.seed + recordIndex &&
      job.ratio === frozenGenerate.ratio &&
      job.quality === frozenGenerate.quality &&
      job.providerId === "codex" &&
      job.model === "native" &&
      JSON.stringify(job.images.map((image) => image.asset)) ===
        JSON.stringify(frozenImages);
    let proof = {
      jobId: job.id,
      recordId,
      matchesFrozenInput,
      threadId,
      nativePath,
      verifiedNativeArtifact: false,
    };
    if (nativePath) {
      try {
        const details = await stat(nativePath),
          bytes = await readFile(nativePath),
          original = await readFile(
            path.join(folder, job.metadata.originalFile),
          );
        const nativeFiles = (await readdir(path.dirname(nativePath))).filter(
          (name) => /\.(png|jpe?g|webp)$/i.test(name),
        );
        const fresh = details.birthtimeMs >= Date.parse(job.startedAt);
        proof = {
          ...proof,
          nativeArtifactFileCount: nativeFiles.length,
          createdAt: details.birthtime.toISOString(),
          createdAfterJobStarted: fresh,
          nativeSHA256: sha(bytes),
          originalSHA256: sha(original),
          nativeBytesMatchOriginal: bytes.equals(original),
          verifiedNativeArtifact: fresh && bytes.equals(original),
        };
      } catch (error) {
        proof.error = error.message;
      }
    }
    proofs.push(proof);
  }
  const summary = {
    ...phase.summary,
    observedImageToolCalls: phase.summary.observedImageToolCalls || null,
    observedCompletedImageToolCalls: phase.summary.observedImageToolCalls
      ? phase.summary.observedCompletedImageToolCalls
      : null,
    observedPeakImageToolWaits: phase.summary.observedImageToolCalls
      ? phase.summary.observedPeakImageToolWaits
      : null,
    nativeToolTimingObservable: phase.summary.observedImageToolCalls > 0,
    inputsMatchFrozenWorkload: proofs.every(
      (proof) => proof.matchesFrozenInput,
    ),
    verifiedFreshNativeArtifacts: proofs.filter(
      (proof) => proof.verifiedNativeArtifact,
    ).length,
    proofs,
    outputs: phase.outputs,
  };
  results.push(summary);
}
const system = (
  await readFile(path.join(directory, "system-samples.jsonl"), "utf8").catch(
    () => "",
  )
)
  .split("\n")
  .filter(Boolean)
  .map(JSON.parse);
const report = {
  createdAt: new Date().toISOString(),
  purpose: experiment.purpose,
  workflowId: experiment.workflow.id,
  inputsSHA256: experiment.workflowSHA256,
  levels: experiment.levels,
  imagesPerLevel: experiment.imagesPerPhase,
  conclusions: {
    allCompleted:
      results.length === 3 &&
      results.every(
        (p) =>
          p.completed === 16 &&
          p.verifiedOutputs === 16 &&
          p.verifiedFreshNativeArtifacts === 16 &&
          p.inputsMatchFrozenWorkload,
      ),
    maximumObservedJobConcurrency: Math.max(
      0,
      ...results.map((p) => p.observedPeakRunningJobs),
    ),
    backendRenderingConcurrency:
      "Not observable: this CLI version omits native image-tool events from exec JSON. Job/process overlap is reported separately.",
    throughputRanking:
      "Exploratory only: one batch per level, ascending order, concurrent background app activity, no repetitions.",
  },
  environment: experiment.environment,
  phases: results,
  localSystem: results.map((phase) => {
    const samples = system.filter((s) => s.concurrency === phase.concurrency);
    return {
      concurrency: phase.concurrency,
      samples: samples.length,
      totalCPUPercentRange: [
        Math.min(
          ...samples.map((s) => s.cpuUsedPercent).filter((n) => n !== null),
        ),
        Math.max(
          ...samples.map((s) => s.cpuUsedPercent).filter((n) => n !== null),
        ),
      ],
      maxDirectHarnessProcesses: Math.max(
        0,
        ...samples.map((s) => s.directHarnessProcesses.length),
      ),
      peakDirectHarnessRSSMB: Math.max(
        0,
        ...samples.map(
          (s) =>
            s.directHarnessProcesses.reduce((sum, p) => sum + p.rssKB, 0) /
            1024,
        ),
      ),
    };
  }),
  notes: experiment.notes,
};
await writeFile(
  path.join(directory, "verified-results.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      workflowId: report.workflowId,
      conclusions: report.conclusions,
      phases: results.map(({ proofs, outputs, ...summary }) => summary),
      localSystem: report.localSystem,
    },
    null,
    2,
  ),
);
