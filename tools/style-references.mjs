#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { WeftClient, createImageWorkflow } from "../client/index.mjs";
import { builtInStyles } from "../shared/styles/catalog.mjs";

// Run twice safely: an existing reference batch is inspected, never resubmitted.
const root = path.resolve(import.meta.dirname, "..");
const client = new WeftClient({ projectId: "weft-styles" });
const workflowFlag = process.argv.indexOf("--workflow");
const workflowId =
  workflowFlag < 0 ? "weft-style-library-180" : process.argv[workflowFlag + 1];
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(workflowId || ""))
  throw new Error("Provide a valid --workflow ID.");
const receiptDirectory = path.join(
  root,
  "docs/qa/style-library",
  ...(workflowFlag < 0 ? [] : ["batches", workflowId]),
);
const execute = process.argv.includes("--execute");
const verify = process.argv.includes("--verify");
await mkdir(receiptDirectory, { recursive: true });
let project = await client.project().catch((error) => {
  if (error.status !== 404) throw error;
  return null;
});
if (!project) {
  if (!execute)
    throw new Error("Use --execute to register the style-library project.");
  project = await client.createProject({
    id: "weft-styles",
    name: "Weft · style library",
    root,
  });
}
let workflow = await client.workflow(workflowId).catch((error) => {
  if (error.status !== 404) throw error;
  return null;
});
if (!workflow) {
  const current = await client.styles();
  const candidates = process.argv.includes("--missing")
    ? builtInStyles.filter(
        (style) =>
          !current.styles.find((entry) => entry.id === style.id)?.references
            .length,
      )
    : builtInStyles;
  if (!candidates.length) {
    console.log(
      JSON.stringify({
        message: "Every style already has a reference. No run created.",
      }),
    );
    process.exit(0);
  }
  workflow = createImageWorkflow({
    id: workflowId,
    name: `Weft · ${candidates.length} original style references`,
    projectId: project.id,
    prompt:
      "Create one original visual style reference. Follow the specific medium, composition and lighting in the record's brief. One image, no swatch grid, captions, signatures or watermark.",
    records: candidates.map((style) => ({
      id: style.id,
      fields: {
        styleId: style.id,
        styleName: style.name,
        category: style.category,
        scene: style.scene,
        referencePrompt: style.referencePrompt,
      },
    })),
    template: "STYLE STUDY: {{styleName}}\n{{referencePrompt}}",
    providerId: "codex",
    model: "native",
    count: 1,
    seed: 20261029,
    ratio: "1:1",
    quality: "high",
  });
  if (execute) {
    workflow = await client.createWorkflow(workflow);
    if (!project.defaultWorkflowId)
      await client.updateProject(project.id, {
        defaultWorkflowId: workflow.id,
      });
  }
}
const plan = await client.plan(workflow);
const records =
  workflow.nodes.find((node) => node.type === "dataset")?.data.records || [];
const expectedIds = records.map((record) => record.fields.styleId);
if (
  !expectedIds.length ||
  new Set(expectedIds).size !== expectedIds.length ||
  expectedIds.some((id) => !builtInStyles.some((style) => style.id === id))
)
  throw new Error("Invalid style reference batch.");
if (plan.imageJobs !== expectedIds.length || plan.textJobs !== 0)
  throw new Error(`Unexpected reference plan: ${JSON.stringify(plan)}`);
const runs = (await client.runs()).filter(
  (run) => run.workflowId === workflowId,
);
if (runs.length > 1)
  throw new Error(
    "Multiple reference batches exist; inspect before proceeding.",
  );
let run = runs[0] && (await client.inspect(runs[0].id));
if (!run && execute)
  run = await client.run(workflow.id, {}, { concurrency: 16 });
let verified = [];
if (verify) {
  if (
    !run ||
    run.status !== "completed" ||
    run.jobs.length !== expectedIds.length
  )
    throw new Error("Reference batch must complete before final verification.");
  const known = new Set(expectedIds);
  const byId = new Map(
    records.map((record) => [record.fields.styleId, record.fields]),
  );
  const server = await client.request("/api/server");
  const hashes = new Set();
  for (const job of run.jobs) {
    const styleId = job.records?.[0]?.fields?.styleId;
    if (
      !known.delete(styleId) ||
      job.status !== "completed" ||
      job.providerId !== "codex" ||
      job.model !== "native" ||
      job.records[0].fields.referencePrompt !==
        byId.get(styleId)?.referencePrompt ||
      !job.prompt.includes(byId.get(styleId)?.referencePrompt) ||
      !job.output
    )
      throw new Error(`Invalid reference provenance: ${job.id}`);
    const response = await client.response(job.output);
    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    const pixels = await sharp(bytes).removeAlpha().raw().toBuffer();
    if (metadata.width < 512 || metadata.height < 512)
      throw new Error(`Reference is too small: ${styleId}`);
    if (!/^original-attempt-\d+\.png$/.test(job.metadata?.originalFile || ""))
      throw new Error(`Missing native original: ${styleId}`);
    const original = path.join(
      server.dataDirectory,
      "runs",
      run.id,
      job.id,
      job.metadata.originalFile,
    );
    const originalPixels = await sharp(original).removeAlpha().raw().toBuffer();
    if (!pixels.equals(originalPixels))
      throw new Error(`Original pixels changed: ${styleId}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const pixelSHA256 = createHash("sha256").update(pixels).digest("hex");
    if (hashes.has(pixelSHA256))
      throw new Error(`Duplicate reference image: ${styleId}`);
    hashes.add(pixelSHA256);
    verified.push({
      styleId,
      jobId: job.id,
      url: job.output,
      sha256,
      pixelSHA256,
      bytes: bytes.length,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      originalPixelsIdentical: true,
    });
  }
  if (known.size) throw new Error(`Missing references: ${[...known]}`);
  await client.importStyleRun(run.id);
}
const receipt = {
  createdAt: new Date().toISOString(),
  workflowId,
  projectId: project.id,
  runId: run?.id,
  status: run?.status,
  styles: expectedIds.length,
  plan,
  counts: run?.jobs.reduce((counts, job) => {
    counts[job.status] = (counts[job.status] || 0) + 1;
    return counts;
  }, {}),
  provenance:
    "Original AI-generated images through Weft's local Codex native-image harness using the signed-in ChatGPT account.",
  verified,
};
await writeFile(
  path.join(receiptDirectory, "references.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify({ ...receipt, verified: verified.length }, null, 2));
