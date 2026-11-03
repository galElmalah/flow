#!/usr/bin/env node
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  appendFile,
  stat,
  open,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { FlowClient, createImageWorkflow } from "../client/index.mjs";
import { summarizePhase } from "./lib/concurrency-metrics.mjs";

const root = path.resolve(import.meta.dirname, "..");
const directory = path.resolve(
  process.env.FLOW_BENCHMARK_DIR ||
    path.join(root, "docs/benchmarks/codex-2026-10-29"),
);
const client = new FlowClient({ projectId: "quoture" });
const sourceId = "14563c65-065a-4d12-a4cf-fd010126abed";
const manifestFile = path.join(directory, "experiment.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const execute = process.argv.includes("--execute");
const save = async (value) => {
  const file = await open(manifestFile + ".tmp", "w");
  try {
    await file.writeFile(JSON.stringify(value, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(manifestFile + ".tmp", manifestFile);
};
const jsonFile = async (file, value) =>
  writeFile(path.join(directory, file), JSON.stringify(value, null, 2));
const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);
const hardQuota =
  /usage limit|quota.{0,30}(exceed|exhaust)|credit.{0,30}(exhaust|insufficient)|insufficient.{0,20}credit|hit your.{0,20}limit/i;

async function main() {
  await mkdir(directory, { recursive: true });
  let experiment = await readFile(manifestFile, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (!experiment) {
    const source = await client.request(`/api/runs/${sourceId}`);
    const images = source.jobs.filter(
      (job) => job.kind === "image" && job.status === "completed",
    );
    if (images.length !== 10)
      throw new Error(
        "Expected the ten completed native Quoture source briefs.",
      );
    const records = Array.from({ length: 16 }, (_, index) => {
      const job = images[index % images.length];
      return {
        id: `trial-${String(index + 1).padStart(2, "0")}`,
        fields: {
          ...job.records[0].fields,
          benchmarkRecord: String(index + 1),
          brief:
            job.prompt +
            (index >= images.length
              ? "\n\nComposition study: change the framing and placement of the same scene; preserve its objects and style."
              : ""),
        },
      };
    });
    const imageURLs = images[0].images.map((ref) => ref.asset);
    if (imageURLs.some((url) => !url))
      throw new Error("Source seed references must be local asset URLs.");
    const workflow = createImageWorkflow({
      id: `quoture-codex-concurrency-${Date.now()}`,
      name: "Quoture · Codex concurrency check",
      projectId: "quoture",
      images: imageURLs,
      records,
      template: "{{brief}}",
      providerId: "codex",
      model: "native",
      count: 1,
      seed: 52000,
      ratio: "2:1",
      quality: "high",
    });
    experiment = {
      version: 1,
      createdAt: new Date().toISOString(),
      timezone: "Asia/Jerusalem",
      purpose:
        "One-batch capacity smoke check; no statistically reliable throughput ranking.",
      nativeOnly: true,
      sourceRunId: sourceId,
      workflow,
      workflowSHA256: hash(JSON.stringify(workflow)),
      imagesPerPhase: 16,
      maximumPlannedImages: 48,
      levels: [4, 8, 16],
      phases: [],
      pollIntervalMs: 1000,
      notes: [
        "Same sixteen frozen briefs and seeds at every level.",
        "No prompt jobs, local processors, API keys, or provider fallback.",
        "Job lifetime overlap is distinct from internal backend inference concurrency.",
        "Tool wait timestamps are observed from log arrival with approximately one-second polling resolution.",
        "One run per level, ascending order; no speed ranking or sustainable limit claim.",
      ],
    };
    await save(experiment);
    await jsonFile("inputs.json", {
      workflow,
      sourceRunId: sourceId,
      workflowSHA256: experiment.workflowSHA256,
    });
  }
  const health = await client.request("/api/health");
  const identity = await client.request("/api/server");
  if (!health.ready) throw new Error("Native Codex is not ready.");
  if (identity.activeJobs) {
    const ownIds = new Set(experiment.phases.map((phase) => phase.runId));
    const active = (await client.request("/api/runs")).filter(
      (run) => run.status === "running",
    );
    if (active.some((run) => !ownIds.has(run.id)))
      throw new Error("Other jobs are active; leave the live queue untouched.");
  }
  if (!experiment.environment) {
    experiment.environment = {
      server: identity,
      codexVersion: health.version,
      originalConcurrency: health.concurrency,
      platform: process.platform,
      node: process.version,
      cores: os.cpus().length,
      memoryBytes: os.totalmem(),
      loadAverage: os.loadavg(),
      quality: "high",
      ratio: "2:1",
    };
    await save(experiment);
  }
  let workflow = await client
    .workflow(experiment.workflow.id)
    .catch((error) => {
      if (error.status === 404) return null;
      throw error;
    });
  const plan = await client.plan(experiment.workflow, { nodeId: "generate" });
  if (plan.total !== 16 || plan.imageJobs !== 16 || plan.textJobs !== 0)
    throw new Error(
      "Expected exactly 16 native image jobs and zero text jobs.",
    );
  await jsonFile("plan.json", plan);
  if (!execute) {
    console.log(
      JSON.stringify({
        dryRun: true,
        workflowId: experiment.workflow.id,
        levels: experiment.levels,
        totalImages: 48,
        directory,
      }),
    );
    return;
  }
  if (!workflow) workflow = await client.createWorkflow(experiment.workflow);
  for (const concurrency of experiment.levels) {
    let phase = experiment.phases.find((p) => p.concurrency === concurrency);
    if (phase?.summary) continue;
    if (!phase) {
      phase = { concurrency };
      experiment.phases.push(phase);
      await save(experiment);
    }
    let run;
    if (phase.runId) run = await client.inspect(phase.runId);
    else {
      // A crash after submission has an unknown outcome: don't submit a duplicate.
      if (phase.submissionStartedAt)
        throw new Error(
          `Submission outcome unknown for c${concurrency}. Inspect saved runs before recording its ID and resuming.`,
        );
      const active = (await client.request("/api/runs")).filter(
        (r) => r.status === "running",
      );
      if (active.length)
        throw new Error(
          "Another run is active; do not change its shared concurrency limit.",
        );
      phase.submissionStartedAt = new Date().toISOString();
      phase.submittedAt = Date.now();
      await save(experiment);
      run = await client.run(
        {
          ...experiment.workflow,
          name: `Quoture · native Codex · ${concurrency} parallel`,
        },
        { nodeId: "generate" },
        { concurrency },
      );
      phase.runId = run.id;
      await save(experiment);
      console.log(
        JSON.stringify({
          type: "started",
          concurrency,
          runId: run.id,
          jobs: run.jobs.length,
        }),
      );
    }
    const calls = new Map(
        (phase.toolCalls || []).map((call) => [
          `${call.jobId}:${call.itemId}`,
          call,
        ]),
      ),
      tails = new Map();
    let observedPeak = phase.observedPeak || 0,
      nextPrint = 0,
      nextSystem = 0,
      previousCPU = os.cpus();
    const checkpoint = async () => {
      phase.toolCalls = [...calls.values()];
      phase.observedPeak = observedPeak;
      await save(experiment);
    };
    while (true) {
      run = await client.inspect(phase.runId);
      const now = Date.now();
      const counts = {};
      for (const job of run.jobs)
        counts[job.status] = (counts[job.status] || 0) + 1;
      observedPeak = Math.max(observedPeak, counts.running || 0);
      await appendFile(
        path.join(directory, "observations.jsonl"),
        JSON.stringify({
          at: new Date(now).toISOString(),
          concurrency,
          runId: run.id,
          status: run.status,
          counts,
        }) + "\n",
      );
      for (const job of run.jobs) {
        const file = path.join(
          identity.dataDirectory,
          "runs",
          run.id,
          job.id,
          "events.jsonl",
        );
        const size = await stat(file)
          .then((s) => s.size)
          .catch(() => 0);
        let tail = tails.get(job.id) || { offset: 0, buffer: "" };
        if (size > tail.offset) {
          const handle = await open(file, "r");
          try {
            const buffer = Buffer.alloc(size - tail.offset);
            await handle.read(buffer, 0, buffer.length, tail.offset);
            tail.buffer += buffer.toString("utf8");
            tail.offset = size;
          } finally {
            await handle.close();
          }
          const lines = tail.buffer.split("\n");
          tail.buffer = lines.pop();
          for (const line of lines) {
            let event;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            const item = event.item;
            if (item?.type !== "mcp_tool_call") continue;
            if (!/image.?gen/i.test(`${item.server} ${item.tool}`)) continue;
            const key = `${job.id}:${item.id}`;
            const call = calls.get(key) || {
              jobId: job.id,
              itemId: item.id,
              server: item.server,
              tool: item.tool,
            };
            if (event.type === "item.started") call.start ??= now;
            if (event.type === "item.completed") {
              call.end = now;
              call.error = Boolean(item.error || item.status === "failed");
            }
            calls.set(key, call);
            await appendFile(
              path.join(directory, "image-tool-events.jsonl"),
              JSON.stringify({
                at: new Date(now).toISOString(),
                concurrency,
                runId: run.id,
                jobId: job.id,
                type: event.type,
                itemId: item.id,
                server: item.server,
                tool: item.tool,
                error: call.error || false,
              }) + "\n",
            );
          }
          tails.set(job.id, tail);
        }
      }
      if (now >= nextSystem) {
        const currentCPU = os.cpus();
        const delta = currentCPU
          .map((cpu, i) => ({
            total:
              Object.values(cpu.times).reduce((a, b) => a + b, 0) -
              Object.values(previousCPU[i].times).reduce((a, b) => a + b, 0),
            idle: cpu.times.idle - previousCPU[i].times.idle,
          }))
          .reduce(
            (a, b) => ({ total: a.total + b.total, idle: a.idle + b.idle }),
            { total: 0, idle: 0 },
          );
        const cpuUsedPercent = delta.total
          ? 100 * (1 - delta.idle / delta.total)
          : null;
        previousCPU = currentCPU;
        const processes = (
          await promisify(execFile)("ps", [
            "-A",
            "-o",
            "pid=,ppid=,%cpu=,rss=,comm=",
          ])
        ).stdout
          .split("\n")
          .map((line) =>
            line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/),
          )
          .filter(Boolean)
          .map(([, pid, ppid, cpu, rss, command]) => ({
            pid: Number(pid),
            ppid: Number(ppid),
            cpuPercent: Number(cpu),
            rssKB: Number(rss),
            command,
          }));
        await appendFile(
          path.join(directory, "system-samples.jsonl"),
          JSON.stringify({
            at: new Date(now).toISOString(),
            concurrency,
            cpuUsedPercent,
            loadAverage: os.loadavg(),
            freeMemoryBytes: os.freemem(),
            server: processes.find((p) => p.pid === identity.pid),
            directHarnessProcesses: processes.filter(
              (p) => p.ppid === identity.pid,
            ),
            topCPU: processes
              .sort((a, b) => b.cpuPercent - a.cpuPercent)
              .slice(0, 6),
          }) + "\n",
        );
        nextSystem = now + 15000;
      }
      if (now >= nextPrint) {
        console.log(
          JSON.stringify({
            type: "progress",
            concurrency,
            runId: run.id,
            counts,
            elapsedSeconds: Math.round((now - phase.submittedAt) / 1000),
            observedPeak,
          }),
        );
        nextPrint = now + 20000;
        await checkpoint();
      }
      if (run.jobs.some((j) => hardQuota.test(j.error || ""))) {
        experiment.stoppedForQuota = true;
        if (!terminal.has(run.status)) {
          await client.control(run.id, "pause");
          await client.control(run.id, "cancel");
          run = await client.inspect(run.id);
        }
      }
      if (terminal.has(run.status)) break;
      if (now - phase.submittedAt > 30 * 60 * 1000) {
        await client.control(run.id, "cancel");
        throw new Error(
          "Phase exceeded 30 minutes; queued/active work was cancelled.",
        );
      }
      await wait(1000);
    }
    const settledAt = Date.now();
    const outputs = [];
    for (const job of run.jobs.filter((j) => j.status === "completed")) {
      const file = path.join(
        identity.dataDirectory,
        "runs",
        run.id,
        job.id,
        "output.png",
      );
      try {
        const metadata = await sharp(file).metadata();
        const pixels = await sharp(file).removeAlpha().raw().toBuffer();
        const original = path.join(
          identity.dataDirectory,
          "runs",
          run.id,
          job.id,
          job.metadata.originalFile,
        );
        const originalPixels = await sharp(original)
          .removeAlpha()
          .raw()
          .toBuffer();
        outputs.push({
          jobId: job.id,
          output: job.output,
          valid:
            metadata.format === "png" &&
            metadata.width > 0 &&
            metadata.height > 0 &&
            pixels.equals(originalPixels),
          width: metadata.width,
          height: metadata.height,
          bytes: (await stat(file)).size,
          fileSHA256: hash(await readFile(file)),
          pixelSHA256: hash(pixels),
          originalPixelsIdentical: pixels.equals(originalPixels),
        });
      } catch (error) {
        outputs.push({ jobId: job.id, valid: false, error: error.message });
      }
    }
    phase.settledAt = settledAt;
    phase.summary = {
      concurrency,
      ...summarizePhase(run, {
        submittedAt: phase.submittedAt,
        settledAt,
        observedPeak,
        toolCalls: [...calls.values()],
        outputs,
      }),
    };
    phase.toolCalls = [...calls.values()];
    phase.outputs = outputs;
    await jsonFile(`run-c${concurrency}.json`, run);
    await checkpoint();
    console.log(JSON.stringify({ type: "finished", ...phase.summary }));
    if (experiment.stoppedForQuota) break;
  }
  experiment.finishedAt = new Date().toISOString();
  await save(experiment);
  await jsonFile("results.json", {
    purpose: experiment.purpose,
    workflowId: workflow.id,
    phases: experiment.phases.map((p) => p.summary).filter(Boolean),
    notes: experiment.notes,
  });
  console.log(
    JSON.stringify({
      type: "experiment-finished",
      directory,
      results: experiment.phases.map((p) => p.summary),
    }),
  );
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
