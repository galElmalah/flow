import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { planWorkflow } from "./graph.mjs";
import { summarize } from "./store.mjs";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { mediaKind, mediaArtifact } from "../shared/media.mjs";
const terminal = new Set(["completed", "failed", "blocked", "cancelled"]);
function resetJob(job) {
  job.status = "queued";
  job.attempts = 0;
  delete job.error;
  delete job.message;
  delete job.startedAt;
  delete job.finishedAt;
}
export class Queue extends EventEmitter {
  constructor(
    store,
    {
      concurrency = 4,
      adapter,
      resolveAsset,
      assets,
      executionLane = () => undefined,
    } = {},
  ) {
    super();
    this.store = store;
    this.concurrency = concurrency;
    this.adapter = adapter;
    this.resolveAsset = resolveAsset;
    this.assets = assets;
    this.executionLane = executionLane;
    this.active = new Map();
    this.stopping = false;
  }
  async create(graph, options = {}, plan = planWorkflow(graph, options)) {
    const providerIds = [
      ...new Set(plan.jobs.map((job) => job.providerId || "codex")),
    ];
    const run = {
      id: randomUUID(),
      workflowId: graph.id,
      ...(graph.projectId
        ? {
            projectId: graph.projectId,
            project: structuredClone(this.store.projects.get(graph.projectId)),
          }
        : {}),
      name: graph.name,
      createdAt: new Date().toISOString(),
      status: "running",
      provider: providerIds.length === 1 ? providerIds[0] : "mixed",
      providerIds,
      graph: plan.graph,
      jobs: plan.jobs,
    };
    await this.store.saveRun(run);
    this.emit("event", { type: "run", run: summarize(run) });
    this.pump();
    return run;
  }
  async update(run, job) {
    try {
      await this.store.saveRun(run);
    } catch (e) {
      run.status = "paused";
      run.error = "Could not save run: " + e.message;
      this.emit("event", { type: "error", message: run.error });
      return false;
    }
    if (job) this.emit("event", { type: "job", runId: run.id, job });
    this.emit("event", { type: "run", run: summarize(run) });
    return true;
  }
  next() {
    for (const run of this.store.runs.values()) {
      if (!["running", "paused"].includes(run.status)) continue;
      if (
        run.status === "paused" &&
        run.jobs.some((j) => !terminal.has(j.status))
      )
        continue;
      const byId = new Map(run.jobs.map((j) => [j.id, j]));
      for (const job of run.jobs) {
        if (job.status !== "queued") continue;
        const lane = this.executionLane(job);
        if (
          lane &&
          [...this.active.values()].some((active) => active.lane === lane)
        )
          continue;
        if (
          job.dependencies.some((id) =>
            ["failed", "blocked", "cancelled"].includes(byId.get(id)?.status),
          )
        ) {
          job.status = "blocked";
          job.error = "An upstream job failed. Retry this run to continue.";
          this.update(run, job);
          continue;
        }
        if (
          job.dependencies.every(
            (id) =>
              byId.get(id)?.status === "completed" && !this.active.has(id),
          )
        )
          return { run, job };
      }
      if (
        run.jobs.every((j) => terminal.has(j.status) && !this.active.has(j.id))
      ) {
        run.status = run.jobs.some((j) =>
          ["failed", "blocked"].includes(j.status),
        )
          ? "failed"
          : "completed";
        run.finishedAt = new Date().toISOString();
        this.update(run);
      }
    }
    return null;
  }
  pump() {
    if (this.stopping) return;
    while (this.active.size < this.concurrency) {
      const next = this.next();
      if (!next) break;
      const { run, job } = next,
        controller = new AbortController();
      job.status = "running";
      job.attempts++;
      job.startedAt = new Date().toISOString();
      delete job.error;
      this.active.set(job.id, {
        controller,
        runId: run.id,
        lane: this.executionLane(job),
      });
      this.execute(run, job, controller).catch((error) =>
        console.error("Queue error:", error.message),
      );
    }
  }
  async execute(run, job, controller) {
    try {
      if (!(await this.update(run, job)))
        throw new Error("Run paused because its state could not be saved.");
      const byId = new Map(run.jobs.map((j) => [j.id, j]));
      job.prompt = (job.promptParts || [{ literal: job.prompt }])
        .map((part) => {
          if (part.literal !== undefined) return part.literal;
          const parent = byId.get(part.jobId);
          if (
            parent?.kind !== "text" ||
            parent.status !== "completed" ||
            !parent.resultText
          )
            throw new Error("Missing completed prompt result.");
          return parent.resultText;
        })
        .filter(Boolean)
        .join("\n\n");
      let images = [
        ...new Set(
          job.images.map((ref) => {
            if (ref.asset) return this.resolveAsset(ref.asset);
            const parent = byId.get(ref.jobId);
            if (
              !parent ||
              mediaKind(parent) !== "image" ||
              parent.status !== "completed"
            )
              throw new Error(
                "Image inputs require a completed image, not a video.",
              );
            return path.join(
              this.store.root,
              "runs",
              run.id,
              ref.jobId,
              "output.png",
            );
          }),
        ),
      ];
      await this.assets?.captureInputs(run, job);
      if (this.assets && !(await this.update(run, job)))
        throw new Error("Could not save captured generation inputs.");
      const directory = path.join(this.store.root, "runs", run.id, job.id);
      await mkdir(directory, { recursive: true });
      if (this.assets) {
        images = await this.assets.freezeImages(run, job, directory, images);
        if (!(await this.update(run, job)))
          throw new Error("Could not save captured input snapshots.");
      }
      const result = await this.adapter({
        job,
        directory,
        imagePaths: images,
        signal: controller.signal,
        checkpoint: async ({ providerOperation, message }) => {
          if (!["image", "video"].includes(mediaKind(job)))
            throw new Error("Only media jobs have remote provider operations.");
          if (providerOperation === null) delete job.providerOperation;
          else if (providerOperation !== undefined) {
            if (
              providerOperation.providerId !== job.providerId ||
              !["submitting", "accepted"].includes(providerOperation.state)
            )
              throw new Error("Invalid provider operation receipt.");
            job.providerOperation = structuredClone(providerOperation);
          }
          if (message !== undefined) job.message = message;
          if (!(await this.update(run, job)))
            throw new Error(
              "Could not persist the provider operation. Resume after storage recovers.",
            );
        },
        onProgress: (message) => {
          job.message = message;
          this.emit("event", {
            type: "progress",
            runId: run.id,
            jobId: job.id,
            message,
          });
        },
      });
      if (!controller.signal.aborted) {
        await this.assets?.verifySnapshots(job, directory);
        if (result?.kind && result.kind !== mediaKind(job))
          throw new Error("Provider returned the wrong output kind.");
        if (
          job.kind === "video" &&
          (result?.kind !== "video" ||
            !(await stat(path.join(directory, "output.mp4"))).size)
        )
          throw new Error("Provider returned no video.");
        if (result?.metadata) job.metadata = result.metadata;
        if (job.kind === "text") {
          if (result?.kind !== "text" || !result.text?.trim())
            throw new Error("Provider returned no prompt text.");
          job.resultText = result.text;
          await writeFile(path.join(directory, "output.txt"), result.text);
        } else
          job.output = `/files/runs/${run.id}/${job.id}/${mediaArtifact(mediaKind(job)).basename}`;
        await this.assets?.complete(run, job, directory);
        job.status = "completed";
        job.finishedAt = new Date().toISOString();
      } else job.status = this.stopping ? "interrupted" : "cancelled";
    } catch (error) {
      if (controller.signal.aborted) {
        job.status = this.stopping ? "interrupted" : "cancelled";
        if (job.providerOperation)
          job.message =
            "Stopped locally; remote generation may continue. Resume this run to check the same operation.";
      } else if (
        /429|rate.?limit|too many requests/i.test(error.message) &&
        job.attempts < 3
      ) {
        job.status = "retrying";
        job.error = "Rate limited. Waiting before retrying.";
        const wait = setTimeout(
          () => {
            if (
              !this.stopping &&
              job.status === "retrying" &&
              run.status !== "cancelled"
            ) {
              job.status = "queued";
              this.update(run, job);
              this.pump();
            }
          },
          Math.min(120000, 15000 * 2 ** job.attempts),
        );
        wait.unref?.();
      } else {
        job.status = "failed";
        job.error = error.message.slice(0, 1600);
        job.finishedAt = new Date().toISOString();
      }
    } finally {
      const active = this.active.get(job.id);
      if (
        active?.restartRequested &&
        run.status !== "cancelled" &&
        !this.stopping
      )
        resetJob(job);
      try {
        await this.update(run, job);
      } catch {}
      this.active.delete(job.id);
      this.next();
      this.pump();
    }
  }
  action(id, action) {
    const run = this.store.runs.get(id);
    if (!run) throw new Error("Run not found.");
    if (action === "cancel") {
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      for (const j of run.jobs)
        if (!terminal.has(j.status)) {
          j.status = "cancelled";
          this.active.get(j.id)?.controller.abort();
        }
      for (const j of run.jobs) {
        const active = this.active.get(j.id);
        if (active) active.restartRequested = false;
      }
    } else if (action === "pause") {
      if (run.status === "running") run.status = "paused";
    } else if (action === "resume" || action === "retry") {
      for (const j of run.jobs)
        if (
          [
            "failed",
            "blocked",
            "cancelled",
            "interrupted",
            "retrying",
          ].includes(j.status) &&
          !this.active.has(j.id)
        )
          resetJob(j);
        else if (j.status === "cancelled" && this.active.has(j.id))
          this.active.get(j.id).restartRequested = true;
      run.status = "running";
      delete run.finishedAt;
      delete run.error;
    } else throw new Error("Unknown run action.");
    this.update(run);
    this.pump();
    return run;
  }
  async stop() {
    this.stopping = true;
    const updates = [];
    for (const run of this.store.runs.values()) {
      if (
        !["running", "paused"].includes(run.status) ||
        !run.jobs.some((job) => !terminal.has(job.status))
      )
        continue;
      run.status = "interrupted";
      run.error =
        "The server stopped during this run. Resume to continue unfinished jobs.";
      for (const job of run.jobs)
        if (!terminal.has(job.status)) job.status = "interrupted";
      updates.push(this.update(run));
    }
    for (const { controller } of this.active.values()) controller.abort();
    await Promise.all(updates);
    await this.store.flush();
  }
}
