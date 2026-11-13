import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { workflowSchema } from "../../shared/graph.mjs";
import { flowFileSchema } from "../../shared/flow-file.mjs";
import { projectSchema } from "../../shared/projects.mjs";
import { agentContextSchema, askAgentSchema } from "../../shared/agent.mjs";
import { summarize } from "../store.mjs";
import { commandHelp } from "../../shared/commands.mjs";
import {
  runOptionsSchema,
  runSubmissionSchema,
} from "../../shared/run-options.mjs";

export function registerDiscoveryRoutes(
  app,
  { root, store, queue, providers, projects },
) {
  app.get("/api", (_, res) =>
    res.json({
      application: "flow",
      version: 2,
      storage: store.storageInfo(),
      workflowSchema: "/api/schema/workflow",
      workflowFileSchema: "/api/schema/flow",
      workflowFileExtension: ".flow.json",
      projectSchema: "/api/schema/project",
      projectManifest: "flow.project.json",
      setup: "/api/guide/setup",
      commandHelp: "/api/help?command=run",
      runOptionsSchema: "/api/schema/run",
      runSubmission: {
        result:
          "Full run document; its durable identifier is id on HTTP, SDK and CLI (MCP structuredContent.data.id).",
        retries:
          "Optional requestId (1–128 identifier characters) scopes an idempotent submission to the project context. Retry the same selector/options/concurrency with the same key to recover the existing run, including after restart. Changed intent returns409 REQUEST_ID_REUSED with runId. Omit key only for deliberately new runs.",
        concurrency:
          "Persisted per-run ceiling, 1–128; a new run cannot reduce another run's limit. Aggregate capacity is the maximum of default 4 and active run ceilings, subject to provider execution lanes.",
        count:
          "options.count is copies per enabled scene/record and generation mode, not the total. Plan reports total, textJobs, imageJobs and videoJobs.",
        planning:
          "Planning is read-only and checks the graph. Submission separately checks provider prerequisites before creating jobs; no automatic provider fallback.",
      },
      integrations: "harness-integrations/",
      codexAuthentication: {
        settings: "/settings/providers",
        status: "GET /api/providers/codex",
        configure:
          "PUT /api/providers/codex {mode:harness|oauth|api-key,apiKey?}",
        login:
          "POST /api/providers/codex/login; POST /api/providers/codex/login/cancel",
        note: "Managed OAuth/API-key credentials use isolated local Codex homes; harness mode uses the existing CLI login. No inference starts. API-key billing is separate.",
      },
      localModels: {
        status: "GET /api/local-models",
        installPreset:
          "POST /api/local-models/comfyui/presets/:id/install; preset IDs, pinned weights and sizes in GET /api/local-models.presets",
        configure: "PUT /api/local-models/:runtime {baseUrl}; loopback only",
        actions: "POST /api/local-models/:runtime/setup|start|stop|pull|cancel",
        profiles:
          "GET|POST /api/local-models/comfyui/profiles; POST /comfyui/profiles/:id/validate",
        setup: "/settings/local-models",
        note: "Ollama local text/vision; ComfyUI local image/video API recipes. Setup/downloads are asynchronous; inspect task state. One queued local inference at a time; no automatic cloud fallback.",
      },
      guide: { path: path.join(root, "AGENTS.md"), endpoint: "/api/guide" },
      agentGuide: {
        path: path.join(root, "docs/agents.md"),
        endpoint: "/api/guide/agents",
      },
      cli: "node cli/flow.mjs --help",
      mcp: {
        transport: "stdio",
        command: "node",
        args: [path.join(root, "cli/flow.mjs"), "mcp"],
        projectFlag: "--project",
        guide: "/api/guide/mcp",
      },
      viewer: {
        paths:
          "/projects · /project/ID/workflow/ID · /gallery · /styles · /editor/ID; nested /run/ID and /node/ID",
        command:
          "node cli/flow.mjs open [WORKFLOW_ID] --project ID --node NODE_ID",
        parameters: ["project", "workflow", "node", "run", "gallery", "view"],
        projects: "node cli/flow.mjs open --projects [--project ID]",
        urlOnly: "--print-url --json",
      },
      graphEditing: {
        read: "GET /api/workflows/:id",
        save: "PUT /api/workflows/:id",
        organize:
          "POST /api/workflows/:id/organize {revision,geometry?,preview?}; client.organizeWorkflow, CLI workflow organize ID [--plan] [--geometry FILE], MCP organize_workflow",
        schema: "/api/schema/workflow",
        operations: [
          "rename",
          "ownership",
          "add/remove/duplicate/reposition nodes",
          "connect/disconnect",
          "node settings",
          "prompt text",
          "rules",
          "records",
          "reference images",
          "viewport",
          "organize canvas (measured bounds or diagnosed estimates)",
        ],
        note: "Read and fork before editing shared workflows; save the full graph with its current revision. PUT increments revision and returns409 for a stale version; preserve your draft and reconcile. Structural graph operations need no separate per-button endpoint.",
      },
      promptSets: {
        nodeType: "prompt-set",
        scenes:
          "node.data.prompts: [{id,label,scene,concept?,enabled?,count?,seed?,ratio?,images?}]",
        template:
          "node.data.text supports {{scene}}, {{concept}}, {{title}}, {{input}}; connected direction is included once",
        defaults:
          "Optional node.data.count/seed/ratio. Run count/seed overrides > scene overrides > set defaults > mode > generator.",
        selection:
          "POST /api/plan or /api/runs options.promptSet:{nodeId,itemIds}; scopes only the set's generation branches, retains the saved graph",
        preview:
          "POST /api/prompt-sets/preview {workflowId|workflow,nodeId,itemId,projectId?}; CLI prompt-set preview WORKFLOW_ID --node SET_ID --items SCENE_ID; MCP preview_prompt_item",
        create:
          "CLI workflow create --prompts FILE --template FILE; client.createImageWorkflow({prompts,promptSetDefaults}); MCP create_image_workflow",
      },
      pageAgent: {
        trace:
          "GET /api/agent/sessions/:id/turns/:turnId/trace; CLI flow agent trace SESSION TURN --json",
        browserTiming:
          "POST /api/agent/sessions/:id/turns/:turnId/timing {elapsedMs,prepareMs,acceptedMs}; numeric first-paint observation only",
        create: "POST /api/agent/sessions {projectId?}",
        read: "GET /api/agent/sessions/:id",
        ask: "POST /api/agent/sessions/:id/turns {id,message,providerId?,model?,context}",
        actions:
          "POST /api/agent/sessions/:id/turns/:turnId/apply|cancel|undo {}",
        schema: "/api/schema/agent",
        note: "Durable project conversations. Ask uses the selected text harness; ready proposals require apply. Apply/undo are revision-checked and never start image generation. Scoped clients pass ?projectId. Reuse turn UUID to retry a message without invoking twice.",
      },
      styleLibrary: {
        endpoint: "/api/styles",
        create:
          "POST /api/styles {id?,name,category?,description?,prompt?,scene?,tags?,references?}; upload images first with POST /api/uploads",
        update:
          "PUT /api/styles/:id accepts changed custom definition fields; references replaces the list. Built-in definitions are read-only.",
        categories: "Filter ?category=NAME",
        search: "?search=TEXT",
        start:
          "POST /api/styles/:id/workflows {projectId?,subject?,name?,referenceUrl?,providerId?,model?}",
        note: "Starting from a style saves a workflow without inference. Exact style prompts and reference URLs are snapshotted in node.data.style.",
      },
      imageEditor: {
        status: "/api/image-editors/status",
        setup: "POST /api/image-editors/setup",
        open: "POST /api/image-editors {source,runId?,jobId?,projectId?}",
        read: "GET /api/image-editors/:id",
        name: "POST /api/image-editors/:id/names {providerId?:codex-text,model?} (vision naming; preserves manual names)",
        cancelNaming: "POST /api/image-editors/:id/names/cancel {}",
        variations:
          "GET /api/image-editors/:id/variations (prepared edits, progress, outputs and original-image lineage)",
        segment:
          "POST /api/image-editors/:id/segments {point?:{x:0..1,y:0..1}}",
        change:
          "PATCH /api/image-editors/:id {revision,layer?|order?|comment?|resolve?}",
        prepare:
          "POST /api/image-editors/:id/requests {revision,regionIds,instructions?,providerId?,count?}",
        send: "POST /api/image-editors/:id/requests/:requestId/send {} (idempotent; starts agent generation)",
        viewer: "flow open --editor ID",
        note: "Masks/comments persist independently from original runs. Preparation creates a workflow, not inference. Binary mask white=edit, black=preserve; default Codex reference guidance is not strict inpainting.",
      },
      assets: {
        list: "GET /api/assets?projectId=ID&runId=RUN&workflowId=WORKFLOW",
        read: "GET /api/assets/:id; GET /api/assets/:id/lineage",
        annotate:
          "PATCH /api/assets/:id/annotations {projectId?,revision,caption?,tags?,decision?,training?}",
        dataset:
          "GET /api/assets/dataset?projectId=ID&mode=all|training&runId=RUN&workflowId=WORKFLOW (JSONL with verified hashes and eligibility)",
        note: "Every new generated image/video/text and captured reference is an asset occurrence. Generation evidence is immutable; captions/review are revisioned separately. Historical observations are explicitly partial. No remote training starts on export.",
      },
      generationModes: {
        schema:
          "node.data.modes: [{id,label,providerId,model?,count?,ratio?,quality?,image?,video?,seed?}]",
        expansion:
          "Same input context × compatible modes × copies; output jobs retain mode and comparison group/input/copy identities. --count applies to every mode; --provider/model overrides are rejected for explicit modes.",
        cli: "flow workflow create --modes modes.json --count 4; flow assets; flow asset lineage ID; flow asset annotate ID --from labels.json; flow dataset export --mode all --output data.jsonl",
        fal: "GET/PUT /api/providers/fal. Native fal-image/fal-video use private FAL_KEY credentials. Seedance 2.0/2.5 video, Seedream 5.0 Flash and FLUX.1 schnell images; same comparison modes, queue and lineage. CLI providers fal|configure-fal; MCP read_fal_connection/configure_fal.",
        grok: "GET/PUT /api/providers/grok. Native grok-image/grok-video use private xAI API credentials; consumer subscription does not prove API entitlement.",
      },
      imageOutputs: {
        guide: "/api/guide/image-outputs",
        nodeTypes: ["generate", "output"],
        settings:
          "data.image:{outputFormat:png|jpeg|webp|gif|svg,frameCount?:2–16,frameDurationMs?:20–2000 (steps of 10),complexity?:low|medium|high,background?:auto|opaque|transparent,markup?:local-transparent-PNG-URL}",
        discovery:
          "GET /api/providers → modelDetails.outputFormats, animationMethod, complexityLevels, backgrounds. Availability depends on the selected provider and account.",
        codex:
          "providerId:codex, model:native. GIF uses a native-generated sprite sheet and local assembly, not a native GIF tool. Reference images supported. No API billing fallback; specific image-model and complexity controls are not exposed by Codex CLI.",
        api: "gpt-image-2.6-sunburst or gpt-image-2.6-flare on an explicitly configured Image API connection. Native GIF and SVG require text-only generations, not image edits. API billing/access is separate from the Codex subscription.",
        lineage:
          "GIF remains kind:image. metadata captures outputFormat, frameCount, frameDurationsMs, durationMs, loop and animationMethod; originals are retained. Downloads and ZIPs keep the extension. SAM and downstream raster-reference use reject GIF/SVG instead of silently flattening them.",
      },
      video: {
        guide: "/api/guide/video",
        nodeTypes: ["video-generate", "video-output"],
        create:
          "CLI: flow workflow create --media video --name NAME --prompt TEXT --resolution 720p; MCP create_video_workflow; client createVideoWorkflow()",
        connection:
          "GET /api/providers/gemini-video; PUT /api/providers/gemini-video {authMode:api-key|oauth-adc|oauth-token,apiKey?:string|null,quotaProject?}",
        outputs:
          "Completed video jobs retain kind:video, local output.mp4, exact prompts/records and a durable interaction receipt. Normal plan/run/inspect/gallery/download endpoints apply.",
        recovery:
          "Resume accepted interactions instead of submitting again. An uncertain submission requires reconciliation; cancelling local polling may leave remote generation running.",
        billing:
          "Public Gemini API credentials and Cloud project access are required. Gemini coding CLI OAuth and Flow subscription credits do not imply API entitlement. Eligible Developer Program Cloud credits require separate activation.",
      },
      endpoints: [
        [
          "GET",
          "/api/providers/gemini-video",
          "Read video API authentication setup without secrets or inference",
        ],
        [
          "PUT",
          "/api/providers/gemini-video",
          "Configure write-only video API credentials; standard Google Cloud ADC is supported separately from coding CLI sign-in",
        ],
        [
          "GET",
          "/api/image-editors",
          "List per-image editors; optional projectId scope",
        ],
        [
          "POST",
          "/api/image-editors",
          "Create or reuse a local image region editor; masks and annotations live in SQLite",
        ],
        [
          "GET",
          "/api/image-editors/:id",
          "Read exact region masks, layer state, comments and edit manifests",
        ],
        [
          "PATCH",
          "/api/image-editors/:id",
          "Revision-checked layer/comment changes",
        ],
        [
          "POST",
          "/api/image-editors/:id/segments",
          "Queue local SAM automatic or point segmentation; poll editor status",
        ],
        [
          "POST",
          "/api/image-editors/:id/requests",
          "Export selected masks/cutout and prepare new edit workflow; original preserved",
        ],
        [
          "POST",
          "/api/image-editors/:id/requests/:requestId/send",
          "Send a prepared snapshot to its image agent; repeated request IDs reuse the run",
        ],
        [
          "POST",
          "/api/styles",
          "Create a custom gallery entry with style and scene prompts, tags and local references; no inference",
        ],
        [
          "PUT",
          "/api/styles/:id",
          "Edit a custom style; optional references replaces saved references; existing workflows keep their snapshots",
        ],
        [
          "GET",
          "/api/styles",
          "Reusable style catalog, local references and progress; ?search=TEXT&category=NAME&favorites=true",
        ],
        [
          "GET",
          "/api/styles/:id",
          "Full style prompt, tags and reference provenance",
        ],
        [
          "PUT",
          "/api/styles/:id/favorite",
          "Set durable workspace favorite {favorite:boolean}",
        ],
        [
          "POST",
          "/api/styles/:id/workflows",
          "Create saved style workflow {projectId?,subject?,name?,referenceUrl?,providerId?,model?}; no inference",
        ],
        [
          "POST",
          "/api/styles/:id/references",
          "Bind validated local images {references:[{url,label,kind,runId?,jobId?}]}",
        ],
        [
          "POST",
          "/api/styles/import-run",
          "Bind completed reference images by job records.fields.styleId {runId,projectId?}; idempotent",
        ],
        [
          "GET",
          "/api/gallery",
          "Completed images with exact inputs/provenance; optional ?projectId=ID",
        ],
        [
          "GET",
          "/api/workflows/:id/results",
          "Latest output jobs grouped by node",
        ],
        [
          "GET",
          "/api/runs/:id/manifest",
          "Exact recorded graph, prompts, rules, inputs and output manifest JSON",
        ],
        [
          "GET",
          "/api/providers/example",
          "Public configuration example without private keys",
        ],
        [
          "POST",
          "/api/providers/reload",
          "Reload provider catalog/configuration without inference",
        ],
        [
          "POST",
          "/api/providers/connections",
          "Create workspace-wide compatible connection {name,baseUrl,models,apiKey:{action:keep|clear|replace,value?}}; keys write-only",
        ],
        [
          "PUT",
          "/api/providers/connections/:id",
          "Update managed compatible connection; keys write-only",
        ],
        [
          "DELETE",
          "/api/providers/connections/:id",
          "Remove workspace-wide managed connection",
        ],
        [
          "POST",
          "/api/providers/connections/:id/test",
          "Test configured endpoint model listing; no inference",
        ],
        [
          "GET",
          "/api/rule-templates",
          "Built-in rules, presets and the local custom rule library; copy full rule text into node.data.rules",
        ],
        [
          "POST",
          "/api/rule-templates",
          "Save a reusable local rule {id,title,group?,text}; applied workflow rules remain independent snapshots",
        ],
        [
          "POST",
          "/api/gallery/search",
          "Local semantic image search: {query,scope?,workflowId?,runId?,providerId?,limit?}; preserves source inputs and provenance",
        ],
        [
          "GET",
          "/api/search/status",
          "Local embedding model and vector-index readiness",
        ],
        [
          "POST",
          "/api/search/retry",
          "Retry local model/index setup without generating images",
        ],
        [
          "GET",
          "/api/projects",
          "Project cards with image/workflow counts and covers; ?search=TEXT matches name, folder and workflow; ?archived=active|archived|all",
        ],
        [
          "POST",
          "/api/projects/:id/archive",
          "Set {archived:boolean,reason?}; includes child workflows and history; restore keeps defaults and image files",
        ],
        [
          "POST",
          "/api/workflows/archive",
          "Atomically set {ids:[ID],archived:boolean,projectId?,reason?}; active runs and project defaults are protected",
        ],
        [
          "POST",
          "/api/projects",
          "Register {name,root,id?}; idempotent for the same ID and canonical root; omitted ID reuses a registered root",
        ],
        [
          "GET",
          "/api/projects/:id",
          "Inspect project root and default workflow",
        ],
        [
          "PUT",
          "/api/projects/:id",
          "Update {name,defaultWorkflowId,kind?}; kind project|library; null clears default",
        ],
        [
          "GET",
          "/api/workflows",
          "List saved workflows; ?projectId=ID&summary=1&archived=active|archived|all. Defaults to active.",
        ],
        [
          "POST",
          "/api/workflows",
          "Create only: full graph with optional generated id and projectId",
        ],
        ["GET", "/api/workflows/:id", "Inspect a workflow"],
        ["PUT", "/api/workflows/:id", "Create or replace a validated workflow"],
        [
          "POST",
          "/api/workflows/:id/fork",
          "Independent fork; optional {name,workflow,projectId}. Inherits project unless explicitly changed or cleared with null",
        ],
        [
          "POST",
          "/api/plan",
          "No inference: {workflowId or workflow,options,projectId?}; explicit project guards ownership",
        ],
        [
          "POST",
          "/api/runs",
          "Start: {workflowId or workflow,options,concurrency,projectId?}; saved run snapshots its project",
        ],
        [
          "GET",
          "/api/runs",
          "Run summaries and status counts; optional ?projectId=ID",
        ],
        [
          "GET",
          "/api/runs/:id",
          "Full saved graph, jobs, prompts, records and outputs",
        ],
        ["POST", "/api/runs/:id/:action", "pause, resume, retry or cancel"],
        ["GET", "/api/runs/:id/download", "Completed images and manifest ZIP"],
        [
          "GET",
          "/api/providers",
          "Available image/text harnesses and readiness",
        ],
        [
          "GET",
          "/api/providers/usage",
          "Read cached subscription quota percentages by harness; unavailable is distinct from zero. Optional ?refresh=1 (10-second minimum). No inference.",
        ],
        [
          "POST",
          "/api/uploads",
          "Multipart images field, returns local asset URLs",
        ],
        ["GET", "/api/events", "SSE run/job/progress updates"],
      ].map(([method, path, description]) => ({ method, path, description })),
      runOptions: {
        nodeId: "Run this node and upstream dependencies",
        count: "Copies per variation (1–500)",
        seed: "Integer 0–2147483647; provider-specific",
        providerId: "Image harness override",
        model: "Image model override",
        promptProviderId: "Text harness override",
        promptModel: "Text model override",
      },
      statuses: [
        "running",
        "paused",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
      ],
      notes: [
        "Register a local project and set workflow.projectId to associate workflows with its repository.",
        "Project roots identify ownership. Harnesses execute in isolated run directories, not in those repositories.",
        "Project manifests contain local routing information only; API keys stay in private platform connections.",
        "Plan before running to check the total job count.",
        "Fork before changing a shared workflow; runs and outputs are not copied.",
        "Record run.id. Submit the same requestId/selector/overrides to recover an accepted run; omitting requestId creates another run.",
        "Retry/resume preserves completed jobs. Interrupted work requires explicit resume.",
        "Local color lab needs no inference service; other harnesses can consume subscription/API usage.",
      ],
    }),
  );
  app.get("/api/help", (req, res, next) => {
    try {
      if (
        req.query.command !== undefined &&
        typeof req.query.command !== "string"
      )
        throw new Error(
          "command must be a CLI command name, such as style start.",
        );
      res.json(
        commandHelp(
          (req.query.command || "").trim().split(/\s+/).filter(Boolean),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/schema/run", (_, res) =>
    res.json({
      options: z.toJSONSchema(runOptionsSchema),
      submission: z.toJSONSchema(runSubmissionSchema),
    }),
  );
  app.get("/api/guide/setup", async (_, res, next) => {
    try {
      res
        .type("text/markdown")
        .send(await readFile(path.join(root, "SETUP.md"), "utf8"));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/schema/flow", (_, res) =>
    res.json(z.toJSONSchema(flowFileSchema)),
  );
  app.get("/api/schema/workflow", (_, res) =>
    res.json(z.toJSONSchema(workflowSchema)),
  );
  app.get("/api/schema/project", (_, res) =>
    res.json(z.toJSONSchema(projectSchema)),
  );
  app.get("/api/schema/agent", (_, res) =>
    res.json({
      context: z.toJSONSchema(agentContextSchema),
      message: z.toJSONSchema(askAgentSchema),
    }),
  );
  app.get("/api/guide", async (_, res, next) => {
    try {
      res
        .type("text/markdown")
        .send(await readFile(path.join(root, "AGENTS.md"), "utf8"));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/guide/agents", async (_, res, next) => {
    try {
      res
        .type("text/markdown")
        .send(await readFile(path.join(root, "docs/agents.md"), "utf8"));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/guide/mcp", async (_, res, next) => {
    try {
      res
        .type("text/markdown")
        .send(await readFile(path.join(root, "docs/mcp.md"), "utf8"));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/guide/image-outputs", async (_, res, next) => {
    try {
      res
        .type("text/markdown")
        .send(await readFile(path.join(root, "docs/image-outputs.md"), "utf8"));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/guide/video", async (_, res, next) => {
    try {
      res
        .type("text/markdown")
        .send(
          await readFile(path.join(root, "docs/video-workflows.md"), "utf8"),
        );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/bootstrap", async (_, res) =>
    res.json({
      projects: projects.list(),
      workflows: store.listWorkflows(),
      runs: store.listRuns({ archived: "active" }).map(summarize),
      concurrency: queue.concurrency,
      providers: await providers.catalog(),
    }),
  );
}
