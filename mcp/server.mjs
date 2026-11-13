import { providerFailureFields } from "../shared/provider-errors.mjs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  FlowClient,
  FlowError,
  createImageWorkflow,
  createVideoWorkflow,
} from "../client/index.mjs";
import {
  runOptionsSchema,
  runSubmissionSchema,
} from "../shared/run-options.mjs";
import { workflowSchema, validateGraph } from "../shared/graph.mjs";
import { organizeOptionsSchema } from "../shared/graph-layout.mjs";
import {
  agentContextSchema,
  agentSessionSchema,
  askAgentSchema,
} from "../shared/agent.mjs";
import {
  projectIdSchema,
  projectManifestSchema,
  projectInputSchema,
  projectUpdateSchema,
} from "../shared/projects.mjs";
import {
  archiveFilterSchema,
  archiveWorkflowsSchema,
  archiveProjectSchema,
} from "../shared/archive.mjs";
import { connectionSchema } from "../shared/provider-connections.mjs";
import { grokConnectionSchema } from "../shared/grok.mjs";
import { falConnectionSchema } from "../shared/fal.mjs";
import { codexConnectionSchema } from "../shared/codex-connection.mjs";
import {
  localRuntimeSchema,
  localRuntimeConfigSchema,
  comfyProfileSchema,
  comfyCheckpointRecipeSchema,
} from "../shared/local-models.mjs";
import { localModelPresetIdSchema } from "../shared/local-model-presets.mjs";
import {
  assetIdSchema,
  assetAnnotationsSchema,
  datasetModeSchema,
} from "../shared/assets.mjs";
import { geminiVideoConnectionSchema } from "../shared/gemini-video.mjs";
import { ruleTemplateSchema } from "../shared/rule-templates.mjs";
import { promptSettingsSchema } from "../shared/prompt-sets.mjs";
import {
  styleIdSchema,
  styleReferenceSchema,
  startStyleSchema,
  createStyleSchema,
  updateStyleSchema,
} from "../shared/styles/schema.mjs";

import {
  openEditorSchema,
  editorPatchSchema,
  segmentSchema,
  editRequestSchema,
  editorIdSchema,
  nameRegionsSchema,
} from "../shared/image-editor.mjs";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const data = workflowSchema.shape.nodes.element.shape.data.shape;
const runOutput = z.looseObject({ id, status: z.string() });
const success = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: { data: value },
});
const failure = (error) => {
  const value = {
    error: {
      message: error.message,
      ...(error.status && { status: error.status }),
      ...(error.code && { code: error.code }),
      ...(error.issues && { issues: error.issues }),
      ...(error.runId && {
        runId: error.runId,
        timeoutSeconds: error.timeoutSeconds,
      }),
      ...providerFailureFields(error),
    },
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
};

export function createMcpServer({
  url = process.env.FLOW_URL || "http://localhost:4310",
  projectId = process.env.FLOW_PROJECT,
  client,
} = {}) {
  projectManifestSchema.shape.serverUrl.parse(url);
  if (projectId) projectIdSchema.parse(projectId);
  const flow = client || new FlowClient({ url, projectId });
  const server = new McpServer(
    { name: "flow-local", version: "0.1.0" },
    {
      instructions:
        "Flow is the local workflow platform. Discover projects and providers, read or fork a workflow, then plan before running. A new run starts inference; keep the returned run ID and inspect/wait rather than resubmitting. Prompt nodes are base instructions, templates expand records, prompt-generate nodes invoke a text harness, generate nodes create images; video-generate nodes create clips and video-output collects them. Use local-color/color-study without prompt-generate nodes for inference-free processing. Never store API keys in graphs. viewer_url returns a validated URL without opening an app.",
    },
  );
  const tool = (
    name,
    description,
    inputSchema,
    readOnly,
    handler,
    {
      idempotent = readOnly,
      destructive = false,
      openWorld = false,
      outputSchema,
    } = {},
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        ...(outputSchema && { outputSchema: z.object({ data: outputSchema }) }),
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: destructive,
          idempotentHint: idempotent,
          openWorldHint: openWorld,
        },
      },
      async (args) => {
        try {
          return success(await handler(args));
        } catch (error) {
          return failure(error);
        }
      },
    );
  };
  const ownGraph = async (workflowId) => {
    const graph = await flow.workflow(workflowId);
    if (flow.projectId && graph.projectId !== flow.projectId)
      throw new FlowError(
        `Workflow ${workflowId} does not belong to project ${flow.projectId}. Fork it explicitly before using it.`,
        409,
        "PROJECT_SCOPE_MISMATCH",
      );
    return graph;
  };
  tool(
    "agent_context_schema",
    "Read the page-aware assistant context JSON Schema. Supply explicit page, workflow revision, selected node IDs, or image/editor identities; credentials never belong in context.",
    z.object({}).strict(),
    true,
    () => z.toJSONSchema(agentContextSchema),
  );
  tool(
    "open_agent_conversation",
    "Open/reuse the latest persistent conversation for this project (or unassigned workspace). fresh:true starts a new conversation and retains older history. No model inference. Keep the returned ID.",
    agentSessionSchema,
    false,
    (input) => flow.agentSession(input),
    { idempotent: false },
  );
  tool(
    "read_agent_conversation",
    "Read saved page-aware messages, truthful text-harness progress and proposed/applied workflow changes within this project's scope.",
    z.object({ sessionId: z.string().uuid() }).strict(),
    true,
    ({ sessionId }) => flow.agentConversation(sessionId),
  );
  tool(
    "read_agent_trace",
    "Read local OpenTelemetry spans and saved server/browser timing for a conversation turn. No prompts, replies, credentials or inference. Scoped to this project.",
    z
      .object({ sessionId: z.string().uuid(), turnId: z.string().uuid() })
      .strict(),
    true,
    ({ sessionId, turnId }) => flow.agentTrace(sessionId, turnId),
  );
  tool(
    "ask_page_agent",
    "Ask the selected text harness to explain or propose changes for an explicit page context. Starts text inference; does not apply graph edits or generate images. Read the workflow's current revision first. Reuse the same message id and payload to retry safely, then read_agent_conversation for progress/result.",
    askAgentSchema.extend({ sessionId: z.string().uuid() }).strict(),
    false,
    ({ sessionId, ...input }) => flow.askAgent(sessionId, input),
    { idempotent: true, openWorld: true },
  );
  for (const [name, action, description] of [
    [
      "apply_agent_changes",
      "applyAgentTurn",
      "Apply one ready assistant proposal to its original workflow only if its revision is unchanged. Saves real graph edits; does not generate images. Repeated apply reuses the receipt.",
    ],
    [
      "cancel_page_agent",
      "cancelAgentTurn",
      "Cancel a queued/thinking assistant turn's text-harness invocation. Does not cancel image workflow runs or erase saved messages.",
    ],
    [
      "undo_agent_changes",
      "undoAgentTurn",
      "Undo this assistant turn's applied graph changes only when the workflow has no newer edits. Repeated undo reuses the receipt; no inference.",
    ],
  ])
    tool(
      name,
      description,
      z
        .object({ sessionId: z.string().uuid(), turnId: z.string().uuid() })
        .strict(),
      false,
      ({ sessionId, turnId }) => flow[action](sessionId, turnId),
      { idempotent: true },
    );
  tool(
    "list_styles",
    "Browse the workspace style gallery with real local reference images. Search names, tags and descriptions; filter a category or durable favorites. Selecting a style never starts inference.",
    z
      .object({
        search: z.string().max(500).optional(),
        category: z.string().max(120).optional(),
        favorites: z.boolean().optional(),
      })
      .strict(),
    true,
    (options) => flow.styles(options),
  );
  tool(
    "read_style",
    "Read a reusable style's full prompt, tags, references and reference-generation progress.",
    z.object({ styleId: styleIdSchema }).strict(),
    true,
    ({ styleId }) => flow.style(styleId),
  );
  tool(
    "create_style",
    "Add your own reusable gallery style, scene, tags and references to local SQLite. Upload images with upload_images first, or reuse a completed image with its real runId/jobId. Optional reference scene, prompt and source attribution. No inference. Supply a unique id for predictable lookup; a duplicate id returns 409.",
    createStyleSchema,
    false,
    (input) => flow.createStyle(input),
  );
  tool(
    "update_style",
    "Edit a custom gallery entry. Send only changed fields; references replaces the saved reference list (empty removes all). Built-in definitions are read-only; add_style_references can attach images to any style. Existing workflow snapshots stay unchanged.",
    updateStyleSchema.extend({ styleId: styleIdSchema }),
    false,
    ({ styleId, ...changes }) => flow.updateStyle(styleId, changes),
    { idempotent: true },
  );
  tool(
    "start_style_workflow",
    "Save a new project-owned workflow from a style's exact prompt and local reference. The subject remains a separate editable prompt. No inference; plan and run explicitly afterwards.",
    startStyleSchema.extend({ styleId: styleIdSchema }).strict(),
    false,
    ({ styleId, ...options }) => flow.startStyle(styleId, options),
  );
  tool(
    "set_style_favorite",
    "Set or clear a workspace-wide durable style favorite without changing existing workflows.",
    z.object({ styleId: styleIdSchema, favorite: z.boolean() }).strict(),
    false,
    ({ styleId, favorite }) => flow.favoriteStyle(styleId, favorite),
    { idempotent: true },
  );
  tool(
    "add_style_references",
    "Attach verified local uploaded or completed generated images to a reusable style. Generated references must identify their real run and job. Existing workflows retain their own snapshots.",
    z
      .object({
        styleId: styleIdSchema,
        references: z.array(styleReferenceSchema).max(16),
      })
      .strict(),
    false,
    ({ styleId, references }) => flow.styleReferences(styleId, references),
    { idempotent: true },
  );
  tool(
    "import_style_reference_run",
    "Idempotently bind completed images from a catalog reference run using each job's records.fields.styleId. Safe during an active run; unfinished jobs remain pending. Project-scoped connections may import only their own runs.",
    z.object({ runId: id }).strict(),
    false,
    ({ runId }) => flow.importStyleRun(runId),
    { idempotent: true },
  );
  tool(
    "list_rule_templates",
    "List built-in image rules, presets and reusable custom rules in the local workspace library. Copy full rule snapshots with enabled:true into prompt/template/prompt-generate/generate node.data.rules. Enabled rules follow downstream branches and appear in both text and image job prompts.",
    z.object({}).strict(),
    true,
    () => flow.ruleTemplates(),
  );
  tool(
    "save_rule_template",
    "Save a reusable rule {id,title,group?,text} to the workspace-wide local library, shared across projects. Cannot overwrite built-ins. Existing workflow snapshots stay unchanged. Does not enable rules or start inference.",
    ruleTemplateSchema.strict(),
    false,
    (rule) => flow.saveRuleTemplate(rule),
    { idempotent: true },
  );
  const scopedGraph = (graph) => {
    if (
      flow.projectId &&
      graph.projectId !== undefined &&
      graph.projectId !== flow.projectId
    )
      throw new FlowError(
        `Workflow must belong to project ${flow.projectId}.`,
        409,
        "PROJECT_SCOPE_MISMATCH",
      );
    return validateGraph({
      ...graph,
      ...(flow.projectId && { projectId: flow.projectId }),
    }).graph;
  };
  tool(
    "discover",
    "Get live API routes, provider readiness, project context and workflow schema. No private provider configuration is exported.",
    z.object({}).strict(),
    true,
    async () => ({
      api: await flow.guide(),
      providers: await flow.providers(),
      projectId: flow.projectId || null,
      workflowSchema: await flow.schema(),
    }),
  );
  tool(
    "image_editor_status",
    "Inspect local SAM 2.1 model readiness. Segmentation stays on this machine.",
    z.object({}).strict(),
    true,
    () => flow.editorStatus(),
  );
  tool(
    "setup_image_editor",
    "Install local SAM 2.1 with uv/Python and download official weights. Poll image_editor_status. No image or subscription inference.",
    z.object({}).strict(),
    false,
    () => flow.setupEditorModel(),
    { idempotent: true },
  );
  tool(
    "list_image_editors",
    "List persistent image region editors in this project's scope.",
    z.object({}).strict(),
    true,
    () => flow.imageEditors(),
  );
  tool(
    "open_image_editor",
    "Create/reuse an editor for a local image URL. Completed run/job IDs must match that image. Aligned region/recolor versions inherit masks, stable region IDs, labels, comments and selection from their saved parent snapshot; whole-image generations need fresh segmentation. Does not generate.",
    openEditorSchema,
    false,
    (input) => flow.openImageEditor(input),
    { idempotent: true },
  );
  tool(
    "read_image_editor",
    "Read masks, layer labels/order/visibility/locks, comments, source provenance and edit request manifests.",
    z.object({ editorId: editorIdSchema }).strict(),
    true,
    ({ editorId }) => flow.imageEditor(editorId),
  );
  tool(
    "list_image_variations",
    "Read prepared edits, live progress and completed versions across this image's version family, including descendant edits in the same project. Outputs include immediate-parent lineage and full gallery inputs; safe to poll after send_image_edit. Legacy reference-guided variations do not guarantee mask precision.",
    z.object({ editorId: editorIdSchema }).strict(),
    true,
    ({ editorId }) => flow.imageVariations(editorId),
  );
  tool(
    "name_image_regions",
    "Name unnamed SAM regions with a vision-capable text harness (default Codex). Sends original and exact mask crops for text/vision inference, never image generation. Preserves manual names. Poll read_image_editor.naming for durable progress; cached names are reused.",
    nameRegionsSchema.extend({ editorId: editorIdSchema }),
    false,
    ({ editorId, ...input }) => flow.nameImageRegions(editorId, input),
    { idempotent: true },
  );
  tool(
    "cancel_image_naming",
    "Stop an editor's region naming task. Keeps masks and names already saved.",
    z.object({ editorId: editorIdSchema }).strict(),
    false,
    ({ editorId }) => flow.cancelImageNaming(editorId),
    { idempotent: true },
  );
  tool(
    "segment_image",
    "Queue local SAM 2.1 automatic segmentation, or add a missing region with point:{x,y} in normalized 0..1 coordinates. Poll read_image_editor until ready/failed.",
    segmentSchema.extend({ editorId: editorIdSchema }),
    false,
    ({ editorId, ...input }) => flow.segmentImage(editorId, input),
  );
  tool(
    "patch_image_editor",
    "With current revision, update one layer, reorder all layer IDs, add a region comment or resolve/reopen a comment. Conflicts require rereading. Same operations as UI.",
    z.object({ editorId: editorIdSchema, change: editorPatchSchema }).strict(),
    false,
    ({ editorId, change }) => flow.patchImageEditor(editorId, change),
  );
  tool(
    "prepare_image_edit",
    "Prepare an immutable image-version request without inference. mode:whole (default) regenerates the complete image, using selected regions and comments as guidance without hard mask compositing; regions/instructions are optional. mode:recolor changes selected regions locally using hex color and strength 0..1; count must be 1. Explicit mode:region is an advanced hard-mask compositor and may leave visible seams at imperfect mask boundaries. Saves source, masks, labels and comment snapshot. Call send_image_edit to dispatch; create a new request for another attempt.",
    editRequestSchema.safeExtend({ editorId: editorIdSchema }),
    false,
    ({ editorId, ...input }) => flow.prepareImageEdit(editorId, input),
  );
  tool(
    "send_image_edit",
    "Run a prepared image version through the normal durable queue: region/whole use the chosen image provider, recolor processes locally without an AI subscription. The original stays intact. Repeating the same request ID returns the existing run; inspect_run and list_image_variations track progress/results. Prepare a new request to regenerate again.",
    z
      .object({ editorId: editorIdSchema, requestId: z.string().uuid() })
      .strict(),
    false,
    ({ editorId, requestId }) => flow.sendImageEdit(editorId, requestId),
    { idempotent: true },
  );
  tool(
    "list_projects",
    "List registered local projects; roots are metadata, never harness working directories.",
    z
      .object({
        search: z.string().max(500).optional(),
        archived: archiveFilterSchema.optional(),
      })
      .strict(),
    true,
    (input) => flow.projects(input),
  );
  tool(
    "create_project",
    "Register a local project {name,root,id?}; root is metadata, never a harness working directory. A project-bound connection can only register its own ID. Does not write a repository manifest; use CLI project init for that.",
    projectInputSchema,
    false,
    (input) => flow.createProject(input),
    { idempotent: true },
  );
  tool(
    "update_project",
    "Rename a project or set/clear its defaultWorkflowId. A project-bound connection may update only its own project.",
    z
      .object({ projectId: projectIdSchema, changes: projectUpdateSchema })
      .strict(),
    false,
    ({ projectId, changes }) => flow.updateProject(projectId, changes),
    { idempotent: true },
  );
  tool(
    "upload_images",
    "Upload 1–16 image files from explicit local paths accessible to this MCP process. Server verifies image bytes and returns local asset URLs. Attach those URLs to source.data.images or record.images, then save_workflow. Does not run inference.",
    z
      .object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(16) })
      .strict(),
    false,
    async ({ paths }) =>
      flow.upload(
        await Promise.all(
          paths.map(async (path) => ({
            name: basename(path),
            data: await readFile(path),
          })),
        ),
      ),
  );
  tool(
    "list_gallery",
    "List generated images and videos in this connection's project, with exact prompts, input records, seeds and source/run IDs. kind distinguishes image/video. Includes completed outputs only; no semantic ranking.",
    z.object({}).strict(),
    true,
    () => flow.gallery(),
  );
  tool(
    "workflow_results",
    "Get the most recent completed/active output jobs grouped by node for a saved workflow in this project.",
    z.object({ workflowId: id }).strict(),
    true,
    ({ workflowId }) => flow.workflowResults(workflowId),
  );
  tool(
    "run_download_url",
    "Return a project-validated local ZIP download URL. The archive contains completed images, MP4 videos and the exact run manifest. inspect_run also returns that manifest as JSON; no image bytes are embedded in MCP output.",
    z.object({ runId: id }).strict(),
    true,
    ({ runId }) => flow.downloadTarget(runId),
  );
  tool(
    "search_status",
    "Inspect local embedding model and image index readiness without querying or generating.",
    z.object({}).strict(),
    true,
    () => flow.searchStatus(),
  );
  tool(
    "retry_search_index",
    "Retry local embedding/index setup after an error. May download model files; never invokes an inference provider.",
    z.object({}).strict(),
    false,
    () => flow.searchRetry(),
    { idempotent: true, openWorld: true },
  );
  tool(
    "provider_example",
    "Read the public provider configuration example. Actual private keys and stored connections are never exported.",
    z.object({}).strict(),
    true,
    () => flow.providerExample(),
  );
  tool(
    "reload_providers",
    "Reload installed harness/configuration metadata and report readiness. Affects the workspace-wide provider catalog.",
    z.object({}).strict(),
    false,
    () => flow.reloadProviders(),
    { idempotent: true },
  );
  tool(
    "read_harness_usage",
    "Read subscription usage percentages, quota windows and reset times per harness. Codex image/text share one account. Unavailable is not zero; stale results are marked. Read-only, no inference or billing calls.",
    z.object({ refresh: z.boolean().optional() }).strict(),
    true,
    (input) => flow.harnessUsage(input),
  );
  tool(
    "read_local_models",
    "Read local Ollama/ComfyUI runtime installation, reachability, downloaded weights, setup progress and saved media profiles. No inference.",
    z.object({ runtime: localRuntimeSchema.optional() }).strict(),
    true,
    ({ runtime }) => flow.localModels(runtime),
  );
  tool(
    "configure_local_runtime",
    "Set a loopback local runtime endpoint. No keys or cloud fallback. Blocks while its jobs are active.",
    z
      .object({ runtime: localRuntimeSchema, config: localRuntimeConfigSchema })
      .strict(),
    false,
    ({ runtime, config }) => flow.configureLocalRuntime(runtime, config),
    { idempotent: true },
  );
  tool(
    "install_local_model",
    "Set up a bundled local model preset: managed ComfyUI, pinned hash-verified weights and its generation profile. MOSS SFT BF16/INT8 supported. Downloads many GB; no inference. Poll read_local_models for durable progress; cancel with local_runtime_action. Mac inference remains experimental.",
    z.object({ presetId: localModelPresetIdSchema }).strict(),
    false,
    ({ presetId }) => flow.installLocalModel(presetId),
    { idempotent: true, openWorld: true },
  );
  tool(
    "local_runtime_action",
    "Install, start, stop or cancel a managed runtime. Setup may download binaries and Python dependencies. Async: read_local_models task status until complete. Never stops an external service.",
    z
      .object({
        runtime: localRuntimeSchema,
        action: z.enum(["setup", "start", "stop", "cancel"]),
      })
      .strict(),
    false,
    ({ runtime, action }) => flow.localModelAction(runtime, action),
    { idempotent: true, openWorld: true },
  );
  tool(
    "pull_local_model",
    "Download local weights. Ollama requires model; ComfyUI requires HTTPS url, filename.safetensors, folder and sha256. Shows actual scoped bytes in runtime task. Does not run inference.",
    z
      .object({
        runtime: localRuntimeSchema,
        input: z.union([
          z.object({ model: z.string().min(1).max(120) }).strict(),
          z
            .object({
              url: z.url(),
              filename: z.string().min(1).max(240),
              folder: z.enum([
                "checkpoints",
                "diffusion_models",
                "text_encoders",
                "vae",
                "loras",
                "clip_vision",
              ]),
              sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
            })
            .strict(),
        ]),
      })
      .strict(),
    false,
    ({ runtime, input }) => flow.localModelAction(runtime, "pull", input),
    { idempotent: true, openWorld: true },
  );
  tool(
    "save_local_profile",
    "Save an API-format ComfyUI image/video workflow with explicit prompt, seed, image and final-output bindings. Does not install custom-node code or generate.",
    z.object({ profile: comfyProfileSchema }).strict(),
    false,
    ({ profile }) => flow.saveLocalProfile(profile),
    { idempotent: true },
  );
  tool(
    "create_local_checkpoint_profile",
    "Create a core checkpoint text-to-image or image-to-image recipe. Checkpoint must exist in the local ComfyUI runtime before generation.",
    z.object({ recipe: comfyCheckpointRecipeSchema }).strict(),
    false,
    ({ recipe }) => flow.createLocalCheckpointProfile(recipe),
    { idempotent: true },
  );
  tool(
    "validate_local_profile",
    "Check profile nodes, model filenames, bindings and endpoint before local inference. Does not generate.",
    z.object({ profileId: id }).strict(),
    true,
    ({ profileId }) => flow.validateLocalProfile(profileId),
  );
  tool(
    "remove_local_profile",
    "Remove a local saved ComfyUI recipe. Historical run snapshots retain their exact submitted graph.",
    z.object({ profileId: id }).strict(),
    false,
    ({ profileId }) => flow.removeLocalProfile(profileId),
    { destructive: true },
  );
  tool(
    "read_codex_connection",
    "Read Codex auth source (harness, oauth or api-key), sign-in/device-code progress and readiness. Never returns credentials.",
    z.object({}).strict(),
    true,
    () => flow.codexConnection(),
  );
  tool(
    "configure_codex",
    "Select the existing local Codex harness, isolated ChatGPT OAuth sign-in, or private API-key login. API billing applies to API-key mode. Does not replace the user's global CLI login; does not run inference.",
    codexConnectionSchema,
    false,
    (input) => flow.configureCodex(input),
  );
  tool(
    "start_codex_login",
    "Start/reuse Codex device-code sign-in after selecting oauth mode. Returns only the official sign-in URL and one-time code. The user completes sign-in. Poll read_codex_connection.",
    z.object({}).strict(),
    false,
    () => flow.startCodexLogin(),
  );
  tool(
    "cancel_codex_login",
    "Cancel Flow's pending Codex sign-in without changing the user's local harness login.",
    z.object({}).strict(),
    false,
    () => flow.cancelCodexLogin(),
  );
  tool(
    "read_fal_connection",
    "Read fal image/video API setup without exposing the key. Includes Seedance/Seedream models; configured does not prove inference access.",
    z.object({}).strict(),
    true,
    () => flow.falConnection(),
  );
  tool(
    "configure_fal",
    "Configure a private workspace fal API key. Omit apiKey to keep, string to replace, null to clear. Does not generate or verify billing.",
    z.object({ connection: falConnectionSchema }).strict(),
    false,
    ({ connection }) => flow.configureFal(connection),
    { idempotent: true, destructive: true },
  );
  tool(
    "read_grok_connection",
    "Read native xAI image/video setup without exposing keys. Grok consumer subscription is not proof of API entitlement.",
    z.object({}).strict(),
    true,
    () => flow.grokConnection(),
  );
  tool(
    "configure_grok",
    "Configure a private workspace-wide xAI API key. Omit apiKey to keep, string to replace, null to clear. Does not generate or verify billing.",
    z.object({ connection: grokConnectionSchema }).strict(),
    false,
    ({ connection }) => flow.configureGrok(connection),
    { idempotent: true, destructive: true },
  );
  tool(
    "list_assets",
    "List project assets, fingerprints, provenance and current annotations; historical observations are marked partial.",
    z
      .object({
        url: z.string().max(1000).optional(),
        runId: id.optional(),
        jobId: id.optional(),
        workflowId: id.optional(),
      })
      .strict(),
    true,
    (input) => flow.assets(input),
  );
  tool(
    "read_asset",
    "Read one immutable asset occurrence and its revisioned annotations in project scope.",
    z.object({ assetId: assetIdSchema }).strict(),
    true,
    ({ assetId }) => flow.asset(assetId),
  );
  tool(
    "read_asset_lineage",
    "Read the exact prompt/settings/source hashes and ancestry, including cross-run sources and generated prompt assets when known.",
    z.object({ assetId: assetIdSchema }).strict(),
    true,
    ({ assetId }) => flow.assetLineage(assetId),
  );
  tool(
    "annotate_asset",
    "Save a caption, tags, review and training flags with the current annotation revision. Never alters historical generation inputs. Stale revisions fail409.",
    z
      .object({ assetId: assetIdSchema, annotations: assetAnnotationsSchema })
      .strict(),
    false,
    ({ assetId, annotations }) => flow.annotateAsset(assetId, annotations),
    { idempotent: false },
  );
  tool(
    "asset_dataset_url",
    "Return a local vendor-neutral JSONL dataset export URL. all includes provenance and eligibility for every asset; training includes only accepted, permitted, rights-confirmed final assets with verified bytes. No remote upload or fine-tuning starts.",
    z
      .object({
        mode: datasetModeSchema.default("all"),
        runId: id.optional(),
        workflowId: id.optional(),
      })
      .strict(),
    true,
    (input) => flow.datasetTarget(input),
  );
  tool(
    "read_gemini_video_connection",
    "Read Gemini video API setup and authentication readiness without exposing credentials or generating. Coding Gemini CLI sign-in and Flow credits do not authorize this API automatically.",
    z.object({}).strict(),
    true,
    () => flow.geminiVideoConnection(),
  );
  tool(
    "configure_gemini_video",
    "Configure workspace-wide Gemini video API authentication. Keys are write-only: omit to keep, string to replace, null to clear; oauth-adc uses standard Google Cloud ADC, oauth-token uses the server environment. This is separate API billing, not Flow credit access. Does not generate.",
    z.object({ connection: geminiVideoConnectionSchema }).strict(),
    false,
    ({ connection }) => flow.configureGeminiVideo(connection),
    { idempotent: true, destructive: true },
  );
  tool(
    "save_provider_connection",
    "Create (omit connectionId) or update a workspace-wide OpenAI-compatible BYOK connection. apiKey actions are keep, clear, or replace with value; keys are write-only and never returned. Changing an endpoint with an existing key requires explicit replace/clear. This is global configuration shared across projects; does not test or run inference.",
    z
      .object({
        connectionId: id.optional(),
        connection: connectionSchema.strict(),
      })
      .strict(),
    false,
    ({ connectionId, connection }) =>
      flow.saveProviderConnection(connection, connectionId),
    { destructive: true },
  );
  tool(
    "remove_provider_connection",
    "Remove a workspace-wide managed BYOK connection. Existing workflow references stay intact but will require a configured provider to run. This affects every project using the connection.",
    z.object({ connectionId: id }).strict(),
    false,
    ({ connectionId }) => flow.removeProviderConnection(connectionId),
    { destructive: true },
  );
  tool(
    "test_provider_connection",
    "Test a managed compatible endpoint's /models listing. Sends its stored key only to its configured base URL. Does not invoke image or text inference and does not prove model inference compatibility.",
    z.object({ connectionId: id }).strict(),
    false,
    ({ connectionId }) => flow.testProviderConnection(connectionId),
    { idempotent: true, openWorld: true },
  );
  tool(
    "list_workflows",
    "List saved workflows in this MCP connection's project, or the workspace when unbound.",
    z.object({ archived: archiveFilterSchema.optional() }).strict(),
    true,
    (input) => flow.workflows(flow.projectId, input),
  );
  tool(
    "set_workflows_archived",
    "Archive or restore workflows atomically in this connection's project. Archived workflows leave normal lists, history and search; images and recorded runs remain recoverable. Active runs and project defaults must be resolved first.",
    archiveWorkflowsSchema.omit({ projectId: true }),
    false,
    ({ ids, archived, reason }) => flow.archiveWorkflows(ids, archived, reason),
    { idempotent: true },
  );
  tool(
    "set_project_archived",
    "Archive or restore a project and its workflows. Keeps image files, ownership and historical runs. A project-bound connection can only change its own project.",
    archiveProjectSchema.extend({ projectId: projectIdSchema }),
    false,
    ({ projectId, archived, reason }) =>
      flow.archiveProject(projectId, archived, reason),
    { idempotent: true },
  );
  tool(
    "read_workflow",
    "Read the saved graph, including base prompt, templates, sources, connections and project ownership.",
    z.object({ workflowId: id }).strict(),
    true,
    ({ workflowId }) => ownGraph(workflowId),
  );
  tool(
    "create_workflow",
    "Create a new saved graph without starting inference. IDs must be new; the graph uses the canonical workflow schema.",
    z.object({ workflow: workflowSchema.strict() }).strict(),
    false,
    ({ workflow }) => flow.createWorkflow(scopedGraph(workflow)),
  );
  tool(
    "create_image_workflow",
    "Create a source → prompt/template → optional AI prompt writer → image generation → collection workflow. Does not run. image:{outputFormat:png|jpeg|webp|gif|svg,frameCount?:2–16,frameDurationMs?:20–2000 in steps of 10,complexity?:low|medium|high,background?:auto|opaque|transparent,markup?:local-transparent-PNG-URL}. For API markup edits, connect the original first, keep markup separate from reference images/masks. GIF uses the same generate/output node types, not video. Codex/native GIF uses a generated sprite sheet assembled locally; GPT Image 2.6 API supports native GIF (text-only), SVG (text-only) and complexity. Inspect providers.modelDetails for supported outputFormats. PNG/JPEG/WebP image inputs must already be local Flow URLs; use upload_images for local files.",
    z
      .object({
        id: id.optional(),
        name: z.string().min(1).max(120),
        prompt: z.string().max(32000),
        images: data.images,
        records: data.records,
        prompts: data.prompts,
        promptSetDefaults: promptSettingsSchema.optional(),
        template: z.string().max(32000).optional(),
        providerId: data.providerId,
        model: data.model,
        promptProviderId: data.providerId,
        promptModel: data.model,
        promptInstructions: z.string().max(32000).optional(),
        count: data.count,
        seed: data.seed,
        ratio: data.ratio,
        quality: data.quality,
        image: data.image,
        modes: data.modes,
      })
      .strict(),
    false,
    (input) =>
      flow.createWorkflow(
        scopedGraph(
          createImageWorkflow({ ...input, projectId: flow.projectId }),
        ),
      ),
  );
  tool(
    "create_video_workflow",
    "Create a saved prompt/record template → optional AI prompt writer → video generation → terminal video collection workflow. Does not run. Optional image references must already be local Flow assets. Default Gemini video API uses separate Cloud/API billing; Gemini Pro/Flow credits are not connected automatically.",
    z
      .object({
        id: id.optional(),
        name: z.string().min(1).max(120),
        prompt: z.string().max(32000),
        images: data.images,
        records: data.records,
        template: z.string().max(32000).optional(),
        providerId: data.providerId,
        model: data.model,
        promptProviderId: data.providerId,
        promptModel: data.model,
        promptInstructions: z.string().max(32000).optional(),
        count: data.count,
        seed: data.seed,
        ratio: data.ratio,
        video: data.video,
        modes: data.modes,
      })
      .strict(),
    false,
    (input) =>
      flow.createWorkflow(
        scopedGraph(
          createVideoWorkflow({ ...input, projectId: flow.projectId }),
        ),
      ),
  );
  tool(
    "save_workflow",
    "Replace a saved workflow graph in this project. Fork shared workflows first. Saving does not run inference.",
    z.object({ workflow: workflowSchema.strict() }).strict(),
    false,
    async ({ workflow }) => {
      await ownGraph(workflow.id);
      return flow.saveWorkflow(scopedGraph(workflow));
    },
    { idempotent: true, destructive: true },
  );
  tool(
    "organize_workflow",
    "Arrange saved canvas nodes left to right without card overlaps. Does not run inference. Supply the current workflow revision; stale writes fail409. Optional geometry maps node IDs to measured width/height and relative socket positions; estimates are reported otherwise. preview returns the proposal without saving.",
    organizeOptionsSchema.extend({ workflowId: id }).strict(),
    false,
    async ({ workflowId, ...options }) => {
      await ownGraph(workflowId);
      return flow.organizeWorkflow(workflowId, options);
    },
  );
  tool(
    "fork_workflow",
    "Copy a saved workflow or recorded inline run into this connection's project with provenance and a new ID. Optional runId uses the authoritative recorded graph even if no saved workflow exists; source workflow agreement and run ownership are validated. A saved source may belong to another project; the original is unchanged.",
    z
      .object({
        workflowId: id,
        name: z.string().min(1).max(120).optional(),
        runId: id.optional(),
      })
      .strict(),
    false,
    ({ workflowId, name, runId }) => flow.fork(workflowId, { name, runId }),
  );
  tool(
    "plan_workflow",
    "Preview exact text/image/video job counts and expanded contexts before inference. Copies multiply records and variations. nodeId scopes one flow and its ancestors.",
    z.object({ workflowId: id, options: runOptionsSchema.optional() }).strict(),
    true,
    async ({ workflowId, options }) => {
      await ownGraph(workflowId);
      return flow.plan(workflowId, options);
    },
  );
  tool(
    "preview_prompt_item",
    "Inspect one Prompt Set scene's resolved prompts, references, first-copy settings and job counts without inference.",
    z
      .object({
        workflowId: id,
        nodeId: id,
        itemId: z.string().min(1).max(160),
      })
      .strict(),
    true,
    ({ workflowId, nodeId, itemId }) =>
      flow.previewPromptItem(workflowId, nodeId, itemId),
  );
  tool(
    "run_workflow",
    "Start a NEW workflow run, which can consume provider/subscription usage. Plan first. The returned run document uses id (not runId). Preserve it; use inspect_run/wait_run to recover instead of resubmitting. Use the same requestId and inputs to recover a submission after a lost response. Concurrency caps parallel jobs for this run.",
    z
      .object({
        workflowId: id,
        options: runOptionsSchema.optional(),
        ...runSubmissionSchema.shape,
      })
      .strict(),
    false,
    ({ workflowId, options, ...submission }) =>
      flow.run(workflowId, options, submission),
    { openWorld: true, outputSchema: runOutput },
  );
  tool(
    "list_runs",
    "List run summaries for this connection's project.",
    z.object({}).strict(),
    true,
    () => flow.runs(),
  );
  tool(
    "inspect_run",
    "Inspect a durable run, job states, exact inputs, outputs, errors and provenance.",
    z.object({ runId: id }).strict(),
    true,
    ({ runId }) => flow.inspect(runId),
    { outputSchema: runOutput },
  );
  tool(
    "wait_run",
    "Wait up to 55 seconds for an existing run. A timeout returns timedOut=true, runId and the last observed run (null if inspection did not complete); it never starts another run.",
    z
      .object({
        runId: id,
        timeoutSeconds: z.number().min(0.1).max(55).default(30),
      })
      .strict(),
    true,
    async ({ runId, timeoutSeconds }) => {
      try {
        return {
          run: await flow.wait(runId, { timeout: timeoutSeconds }),
          timedOut: false,
        };
      } catch (error) {
        if (error.code !== "RUN_WAIT_TIMEOUT") throw error;
        return { run: error.lastRun ?? null, runId, timedOut: true };
      }
    },
    {
      outputSchema: z.object({
        run: runOutput.nullable(),
        runId: id.optional(),
        timedOut: z.boolean(),
      }),
    },
  );
  tool(
    "control_run",
    "Pause, resume, cancel or retry an existing run. Retry/resume can invoke the selected providers. Cancellation stops queued work; completed outputs remain.",
    z
      .object({
        runId: id,
        action: z.enum(["pause", "resume", "cancel", "retry"]),
      })
      .strict(),
    false,
    async ({ runId, action }) => {
      await flow.inspect(runId);
      return flow.control(runId, action);
    },
    { destructive: true, openWorld: true },
  );
  tool(
    "search_images",
    "Search generated image-associated prompts, scenes and quotes by meaning using local embeddings. Restricted to this project; inspect index readiness if results are partial.",
    z
      .object({
        query: z.string().min(1).max(2000),
        scope: z
          .union([
            z.enum(["all", "unassigned"]),
            z.string().regex(/^(project|workflow):[a-zA-Z0-9_-]{1,100}$/),
          ])
          .optional(),
        workflowId: id.optional(),
        runId: id.optional(),
        providerId: data.providerId,
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    true,
    (input) => flow.searchImages(input),
  );
  tool(
    "viewer_url",
    "Return a validated local viewer URL for a workflow, node, run, image gallery style library (styles:true), or projects page (projects:true). Does not open the OS browser. Use CLI `flow open --styles` to launch the style library.",
    z
      .object({
        workflowId: id.optional(),
        editorId: editorIdSchema.optional(),
        nodeId: id.optional(),
        runId: id.optional(),
        gallery: z.boolean().optional(),
        styles: z.boolean().optional(),
        projects: z.boolean().optional(),
      })
      .strict(),
    true,
    (input) => flow.viewer(input),
  );
  return server;
}

export function startMcpServer(options = {}) {
  return serveStdio(() => createMcpServer(options), {
    onerror: (error) => console.error(`Flow MCP: ${error.message}`),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startMcpServer();
