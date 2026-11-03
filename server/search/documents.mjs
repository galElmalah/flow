import { createHash } from "node:crypto";
import { isMediaJob } from "../../shared/media.mjs";

export const projectionVersion = 3;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// This is the gallery's sole eligibility/provenance projection.
export function galleryItems(runs) {
  return runs.flatMap((run) =>
    run.jobs
      .filter((j) => isMediaJob(j) && j.output && j.status === "completed")
      .map((j) => ({
        ...j,
        ...(j.edit || run.graph?.nodes.find((n) => n.id === j.nodeId)?.data.edit
          ? {
              edit:
                j.edit ||
                run.graph.nodes.find((n) => n.id === j.nodeId).data.edit,
            }
          : {}),
        runId: run.id,
        runName: run.name,
        workflowId: run.workflowId,
        projectId: run.projectId,
        project: run.project,
        createdAt: run.createdAt,
      })),
  );
}

export function matchesSearch(
  item,
  { scope = "all", workflowId, runId, providerId } = {},
) {
  return (
    (scope === "all" ||
      (scope === "unassigned"
        ? !item.projectId
        : scope.startsWith("project:")
          ? item.projectId === scope.slice(8)
          : item.workflowId === scope.slice(9))) &&
    (!workflowId || item.workflowId === workflowId) &&
    (!runId || item.runId === runId) &&
    (!providerId || (item.providerId || "codex") === providerId)
  );
}

function passages(text) {
  const words = String(text || "")
    .trim()
    .split(/\s+/);
  const chunks = [];
  // Overlap keeps a scene split across a passage boundary searchable.
  for (let i = 0; i < words.length; i += 72) {
    const value = words.slice(i, i + 96).join(" ");
    if (value.trim()) chunks.push(value);
  }
  return chunks;
}

export function imageDocument(item) {
  const fields = (item.records || []).map((record) => record.fields || {});
  const primaryKeys = [
    "scene",
    "quote",
    "text",
    "input",
    "meaning",
    "description",
  ];
  const structured = fields.flatMap((record) => [
    ...primaryKeys.flatMap((key) => passages(record[key])),
    ...passages(
      [
        record.author,
        record.title,
        record.role,
        record.category,
        record.journey,
        record.background,
      ]
        .filter(Boolean)
        .join(". "),
    ),
  ]);
  const secondary = fields.flatMap((record) =>
    passages(
      Object.values(record)
        .filter((v) => typeof v === "string")
        .join(". "),
    ),
  );
  const chunks = [
    ...new Set([...structured, ...secondary, ...passages(item.prompt)]),
  ];
  const weights = chunks.map((text) =>
    !structured.length || structured.includes(text) ? 1 : 0.7,
  );
  if (!chunks.length) chunks.push(item.label || "Generated image");
  return {
    key: `${item.runId}/${item.id}`,
    sourceHash: hash([projectionVersion, chunks, weights]),
    chunks,
    weights,
    exact: [item.seed, ...fields.flatMap((f) => Object.values(f))]
      .join(" ")
      .toLowerCase(),
    projectId: item.projectId || null,
    workflowId: item.workflowId || null,
    runId: item.runId,
    providerId: item.providerId || "codex",
    createdAt: item.createdAt,
  };
}
