import { readFile } from "node:fs/promises";
import { fromFlowFile } from "../shared/flow-file.mjs";
import { basename, resolve } from "node:path";
import { parseRecords } from "../shared/records.mjs";
import { createImageWorkflow, createVideoWorkflow } from "../client/index.mjs";
import { generationModesSchema } from "../shared/generation-modes.mjs";
import { generationKind } from "../shared/media.mjs";
import {
  promptItemsSchema,
  promptSetSelectionSchema,
} from "../shared/prompt-sets.mjs";

export async function loadWorkflow(client, id) {
  const projectId = client.projectId;
  const graph = await client.workflow(id);
  if (projectId && graph.projectId !== projectId)
    throw new Error(
      `Workflow ${id} belongs to ${graph.projectId || "the unassigned workspace"}, not project ${projectId}. Fork explicitly to use it in this project.`,
    );
  return graph;
}
export function owned(graph, projectId) {
  if (projectId && graph.projectId && graph.projectId !== projectId)
    throw new Error(
      `Workflow belongs to project ${graph.projectId}, not ${projectId}. Fork explicitly to move work between projects.`,
    );
  return {
    ...graph,
    ...(projectId ? { projectId: projectId } : {}),
  };
}
export function runOptions(values) {
  const options = {};
  for (const [flag, key] of [
    ["node", "nodeId"],
    ["prompt-provider", "promptProviderId"],
    ["prompt-model", "promptModel"],
    ["provider", "providerId"],
    ["model", "model"],
  ])
    if (values[flag] !== undefined) options[key] = values[flag];
  for (const key of ["seed", "count"])
    if (values[key] !== undefined) options[key] = Number(values[key]);
  if (values["prompt-set"] !== undefined || values.items !== undefined)
    options.promptSet = promptSetSelectionSchema.parse({
      nodeId: values["prompt-set"],
      itemIds: values.items?.split(",").map((s) => s.trim()),
    });
  return options;
}
export async function prepareWorkflow(
  client,
  values,
  { workflowId, create = false } = {},
) {
  if (values.media !== undefined && !["image", "video"].includes(values.media))
    throw new Error("Choose --media image or --media video.");
  const projectId = client.projectId;
  const modes = values.modes
    ? generationModesSchema.parse(
        JSON.parse(await readFile(resolve(values.modes), "utf8")),
      )
    : undefined;
  const records = values.records
    ? parseRecords(await readFile(resolve(values.records), "utf8"))
    : undefined;
  const prompts = values.prompts
    ? promptItemsSchema.parse(
        JSON.parse(await readFile(resolve(values.prompts), "utf8")),
      )
    : undefined;
  if (prompts && records)
    throw new Error("Use --prompts or --records, not both.");
  const templateText = values.template
    ? await readFile(resolve(values.template), "utf8")
    : undefined;
  let assets;
  if (values["seed-image"]?.length)
    assets = await client.upload(
      await Promise.all(
        values["seed-image"].map(async (file) => ({
          name: basename(file),
          data: await readFile(resolve(file)),
        })),
      ),
    );
  if (!values.from && !workflowId)
    return (
      values.media === "video" ? createVideoWorkflow : createImageWorkflow
    )({
      id: values.id || (create ? undefined : "cli-seed"),
      name: values.name || "CLI exploration",
      projectId: projectId,
      prompt: values.prompt,
      images: assets?.map((a) => a.url),
      records,
      prompts,
      template: templateText,
      providerId: values.provider,
      model: values.model,
      promptProviderId: values["prompt-provider"],
      promptModel: values["prompt-model"],
      promptInstructions: values["prompt-instructions"],
      count: values.count === undefined ? undefined : Number(values.count),
      seed: values.seed === undefined ? undefined : Number(values.seed),
      ratio: values.ratio,
      quality: values.quality,
      modes,
      ...(values.media === "video"
        ? {
            video: {
              resolution: values.resolution || "720p",
              ...(values.duration && {
                durationSeconds: Number(values.duration),
              }),
              ...(values["video-mode"] && { mode: values["video-mode"] }),
            },
          }
        : values.resolution
          ? { image: { resolution: values.resolution } }
          : {}),
    });
  let workflow = values.from
    ? owned(fromFlowFile(JSON.parse(await readFile(resolve(values.from), "utf8"))), projectId)
    : await loadWorkflow(client, workflowId);
  if (modes) {
    const targets = workflow.nodes.filter(
      (node) =>
        ["generate", "video-generate"].includes(node.type) &&
        (!values.node || node.id === values.node),
    );
    if (targets.length !== 1)
      throw new Error(
        "Choose exactly one generation node with --node when applying --modes to this workflow.",
      );
    targets[0].data.modes = modes;
  }
  if (values.name) workflow.name = values.name;
  if (values.id) workflow.id = values.id;
  if (prompts) {
    const sets = workflow.nodes.filter((n) => n.type === "prompt-set");
    const set = values["prompt-set"]
      ? sets.find((n) => n.id === values["prompt-set"])
      : sets.length === 1
        ? sets[0]
        : null;
    if (!set)
      throw new Error(
        "Choose an existing Prompt Set with --prompt-set, or create a workflow with --prompts.",
      );
    set.data.prompts = prompts;
  }
  if (records) {
    let list = workflow.nodes.find((n) => n.type === "dataset");
    if (list) list.data.records = records;
    else {
      const target =
        workflow.nodes.find((n) => n.type === "prompt-generate") ||
        workflow.nodes.find((n) =>
          ["image", "video"].includes(generationKind(n.type)),
        );
      if (!target)
        throw new Error("Add a generation node to consume these records.");
      const addition = createImageWorkflow({ records });
      const dataset = addition.nodes.find((n) => n.type === "dataset");
      const template = addition.nodes.find((n) => n.type === "template");
      dataset.id = "cli-records";
      template.id = "cli-record-template";
      if (workflow.nodes.some((n) => [dataset.id, template.id].includes(n.id)))
        throw new Error(
          "CLI record node IDs already exist; edit the workflow instead.",
        );
      workflow.nodes.push(dataset, template);
      workflow.edges.push(
        {
          id: "cli-records-template",
          source: dataset.id,
          target: template.id,
          targetHandle: "text",
        },
        {
          id: "cli-records-generation",
          source: template.id,
          target: target.id,
          targetHandle: "text",
        },
      );
    }
  }
  if (templateText !== undefined) {
    const template = workflow.nodes.find(
      (n) => n.type === "template" || n.type === "prompt-set",
    );
    if (!template)
      throw new Error(
        "Use --records or a workflow with a prompt template before --template.",
      );
    template.data.text = templateText;
  }
  if (values.prompt !== undefined) {
    const node = workflow.nodes.find((n) => n.type === "prompt");
    if (!node) throw new Error("This workflow has no prompt node to override.");
    node.data.text = values.prompt;
  }
  if (assets) {
    let node = workflow.nodes.find((n) => n.type === "image");
    if (!node) {
      node = {
        id: "cli-seed-image",
        type: "image",
        position: { x: 0, y: 0 },
        data: { label: "Seed images" },
      };
      workflow.nodes.push(node);
    }
    node.data.images = assets.map((a) => a.url);
    if (!workflow.edges.some((e) => e.source === node.id))
      for (const target of workflow.nodes.filter((n) =>
        workflow.nodes.some((writer) => writer.type === "prompt-generate")
          ? n.type === "prompt-generate"
          : ["image", "video"].includes(generationKind(n.type)),
      ))
        workflow.edges.push({
          id: `seed-${target.id}`,
          source: node.id,
          target: target.id,
          targetHandle: "image",
        });
  }
  for (const node of workflow.nodes) {
    if (
      node.type === "prompt-generate" &&
      values["prompt-instructions"] !== undefined
    )
      node.data.text = values["prompt-instructions"];
    if (["image", "video"].includes(generationKind(node.type))) {
      if (values.ratio !== undefined) node.data.ratio = values.ratio;
      if (node.type === "generate" && values.quality !== undefined)
        node.data.quality = values.quality;
      if (node.type === "generate" && values.resolution !== undefined)
        node.data.image = { ...node.data.image, resolution: values.resolution };
      if (
        node.type === "video-generate" &&
        [values.resolution, values.duration, values["video-mode"]].some(
          (v) => v !== undefined,
        )
      )
        node.data.video = {
          ...node.data.video,
          ...(values.resolution && { resolution: values.resolution }),
          ...(values.duration && { durationSeconds: Number(values.duration) }),
          ...(values["video-mode"] && { mode: values["video-mode"] }),
        };
    }
  }
  if (create)
    for (const node of workflow.nodes) {
      if (["image", "video"].includes(generationKind(node.type)))
        Object.assign(
          node.data,
          Object.fromEntries(
            Object.entries({
              providerId: values.provider,
              model: values.model,
              ratio: values.ratio,
              ...(node.type === "generate" && { quality: values.quality }),
              count:
                values.count === undefined ? undefined : Number(values.count),
              seed: values.seed === undefined ? undefined : Number(values.seed),
            }).filter(([, value]) => value !== undefined),
          ),
        );
      if (node.type === "prompt-generate")
        Object.assign(
          node.data,
          Object.fromEntries(
            Object.entries({
              providerId: values["prompt-provider"],
              model: values["prompt-model"],
              text: values["prompt-instructions"],
            }).filter(([, value]) => value !== undefined),
          ),
        );
    }
  return workflow;
}
