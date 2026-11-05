#!/usr/bin/env node
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toFlowFile, fromFlowFile } from "../shared/flow-file.mjs";
import {
  agentContextSchema,
  agentSessionSchema,
  askAgentSchema,
} from "../shared/agent.mjs";
import { basename, resolve, join } from "node:path";
import { realpath } from "node:fs/promises";
import { FlowClient } from "../client/index.mjs";
import {
  loadWorkflow,
  owned,
  prepareWorkflow,
  runOptions,
} from "./workflow-input.mjs";
import {
  findProjectContext,
  readProjectManifest,
  manifestName,
} from "../client/project-context.mjs";
import { parseArgs } from "node:util";
import { startServer, stopServer } from "./server.mjs";
import { openViewer } from "./viewer.mjs";
const { values, positionals: args } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: "string" },
    workflow: { type: "string" },
    run: { type: "string" },
    project: { type: "string" },
    scope: { type: "string" },
    root: { type: "string" },
    id: { type: "string" },
    ratio: { type: "string" },
    quality: { type: "string" },
    media: { type: "string" },
    resolution: { type: "string" },
    "output-format": { type: "string" },
    frames: { type: "string" },
    "frame-delay": { type: "string" },
    complexity: { type: "string" },
    background: { type: "string" },
    modes: { type: "string" },
    geometry: { type: "string" },
    duration: { type: "string" },
    "video-mode": { type: "string" },
    name: { type: "string" },
    timeout: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    reasoning: { type: "string" },
    "prompt-provider": { type: "string" },
    "prompt-model": { type: "string" },
    "prompt-instructions": { type: "string" },
    seed: { type: "string" },
    prompt: { type: "string" },
    subject: { type: "string" },
    search: { type: "string" },
    category: { type: "string" },
    favorites: { type: "boolean" },
    unfavorite: { type: "boolean" },
    count: { type: "string" },
    concurrency: { type: "string" },
    "seed-image": { type: "string", multiple: true },
    from: { type: "string" },
    records: { type: "string" },
    prompts: { type: "string" },
    "prompt-set": { type: "string" },
    items: { type: "string" },
    node: { type: "string" },
    template: { type: "string" },
    plan: { type: "boolean" },
    wait: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean" },
    url: { type: "string" },
    output: { type: "string" },
    port: { type: "string" },
    force: { type: "boolean" },
    gallery: { type: "boolean" },
    styles: { type: "boolean" },
    projects: { type: "boolean" },
    archived: { type: "boolean" },
    editor: { type: "string" },
    image: { type: "string" },
    regions: { type: "string" },
    mode: { type: "string" },
    color: { type: "string" },
    strength: { type: "string" },
    "print-url": { type: "boolean" },
    "clear-default": { type: "boolean" },
  },
});
let base =
  values.url ||
  process.env.FLOW_URL ||
  `http://localhost:${values.port || process.env.PORT || 4310}`;
let client;
const request = (...args) => client.request(...args);
const print = (x) =>
  console.log(
    values.json
      ? JSON.stringify(x)
      : typeof x === "string"
        ? x
        : JSON.stringify(x, null, 2),
  );
const post = (route, data) => client.post(route, data);
async function waitForRun(id) {
  const run = await client.wait(id, {
    timeout: Number(values.timeout ?? 3600),
    onProgress: values.json
      ? undefined
      : (run) =>
          process.stderr.write(
            `\r${run.status} · ${run.jobs.filter((j) => j.status === "completed").length}/${run.jobs.length} completed   `,
          ),
  });
  if (!values.json) process.stderr.write("\n");
  print(run);
  if (run.status !== "completed") process.exitCode = 1;
}
async function registerProject({
  context,
  root,
  projectId,
  name,
  workflowId,
  bootstrapWorkflowId,
  writeManifest,
}) {
  const projectRoot = await realpath(
    resolve(root || context?.root || process.cwd()),
  );
  const manifestPath = join(projectRoot, manifestName);
  if (writeManifest) {
    try {
      const existing = await readProjectManifest(manifestPath);
      if (existing.manifest.projectId !== projectId)
        throw new Error(
          `${manifestPath} already belongs to ${existing.manifest.projectId}.`,
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let project = await client.createProject({
    id: projectId,
    name: name || basename(projectRoot),
    root: projectRoot,
  });
  const selectedWorkflowId =
    workflowId ||
    (!project.defaultWorkflowId ? bootstrapWorkflowId : undefined);
  if (selectedWorkflowId) {
    const workflow = await client.workflow(selectedWorkflowId, {
      unscoped: true,
    });
    if (workflow.projectId && workflow.projectId !== project.id)
      throw new Error(
        `Workflow belongs to project ${workflow.projectId}. Fork it explicitly first.`,
      );
    if (!workflow.projectId)
      await client.saveWorkflow({ ...workflow, projectId: project.id });
    project = await client.updateProject(project.id, {
      defaultWorkflowId: selectedWorkflowId,
    });
  }
  const manifest = {
    version: 1,
    projectId: project.id,
    serverUrl: base,
    ...(project.defaultWorkflowId
      ? { defaultWorkflowId: project.defaultWorkflowId }
      : {}),
  };
  if (writeManifest) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const ignorePath = join(projectRoot, ".gitignore");
    const ignore = await readFile(ignorePath, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "";
    });
    if (!ignore.split(/\r?\n/).includes(manifestName))
      await appendFile(ignorePath, `\n# Local Flow project pointer\n${manifestName}\n`);
  }
  return { project, manifestPath, manifest };
}
try {
  const [command, id] = args;
  if (command === "migrate") {
    const { migrateInstallation } = await import("./migration.mjs");
    print(await migrateInstallation({
      root: resolve(import.meta.dirname, ".."),
      url: values.url || process.env.FLOW_URL || `http://localhost:${values.port || process.env.PORT || 4310}`,
      plan: Boolean(values.plan),
    }));
    process.exit(0);
  }
  if (command === "skills") {
    const { manageSkills } = await import("./skills.mjs");
    const result = await manageSkills({
      action: values.help ? "status" : id,
      target: values.target,
    });
    print(result);
    process.exit(0);
  }
  const context = ["serve", "stop", "restart"].includes(command)
    ? null
    : await findProjectContext(values.root || process.cwd());
  base =
    values.url ||
    process.env.FLOW_URL ||
    (values.port
      ? `http://localhost:${values.port}`
      : context?.manifest.serverUrl) ||
    `http://localhost:${process.env.PORT || 4310}`;
  const projectId = values.project || context?.manifest.projectId;
  let defaultWorkflowId;
  client = new FlowClient({ url: base, projectId });
  if (
    values.timeout !== undefined &&
    (!Number.isFinite(Number(values.timeout)) || Number(values.timeout) <= 0)
  )
    throw new Error("Timeout must be a positive number of seconds.");
  if (values.help || !command || command === "help") {
    console.log(
      `Flow · local image and video workflow CLI\n\n  flow skills install|status               Install/check bundled user-wide agent skills\n  flow migrate [--plan]                    Upgrade local data and project pointers to Flow\n  flow serve                               Start the local server in the background\n  flow stop                                Stop this workspace’s idle server\n  flow restart                             Restart this workspace’s server\n  flow mcp [--project ID]                   Serve MCP tools over stdio\n  flow status                              Check Codex login and image generation\n  flow open [WORKFLOW_ID]                   Open the local viewer; project default if omitted\n  flow providers [reload]                   List or reload configured providers\n  flow local status [ollama|comfyui]        Inspect local runtime, models and setup progress\n  flow local setup|start ollama --wait      Install/start a managed local engine (also comfyui)\n  flow local pull ollama --model NAME --wait Download local text weights\n  flow local pull comfyui --from weights.json --wait Download hashed local model weights\n  flow local install moss-image-sft --wait Download/setup the bundled MOSS image model\n  flow local profile save --from api-profile.json  Register image/video workflow bindings\n  flow local checkpoint --from recipe.json  Create a core local checkpoint image recipe\n  flow local profile validate PROFILE_ID    Check local nodes, models and bindings\n  flow providers usage --json               Read subscription quotas without inference\n  flow providers codex                      Read Codex harness/OAuth/API-key status\n  flow providers configure-codex --from private.json  Select auth source; key via private file\n  flow providers login-codex                Start ChatGPT device sign-in\n  flow providers cancel-codex-login         Cancel pending sign-in\n  flow providers fal                        Read fal image/video API setup\n  flow providers configure-fal --from private.json  Configure a private fal API key\n  flow providers grok                       Read native xAI image/video connection status\n  flow providers configure-grok --from private.json  Configure a private xAI API key\n  flow providers gemini-video               Read Gemini video API setup, without secrets\n  flow providers configure-video --from private.json  Configure API key or Google ADC auth\n  flow guide --json                         Discover the local API and options\n  flow schema --json                        Workflow JSON Schema\n  flow styles [ID] --search realism         Discover reusable styles and local references\n  flow style create --from style.json [--seed-image ./ref.png]  Add your own gallery style\n  flow style update ID --from changes.json   Edit a custom gallery entry\n  flow style start ID --subject "A scene"  Create a style workflow without inference\n  flow style favorite ID [--unfavorite]     Set a durable style favorite\n  flow style import-run RUN_ID              Bind completed catalog reference images\n  flow rules --json                         List built-in rules, presets and custom rules\n  flow rules save --from rule.json          Save a reusable local rule template\n  flow providers create --from connection.json  Create private BYOK connection\n  flow providers save ID --from connection.json  Update connection (write-only key actions)\n  flow providers test|remove ID             Test endpoint models or remove connection\n  flow upload ./seed.png                   Upload references; returns local asset URLs\n  flow assets --project ID                 List generated/reference assets with fingerprints\n  flow asset lineage ASSET_ID               Inspect exact values and ancestry\n  flow asset annotate ID --from labels.json Save revisioned captions, tags and review labels\n  flow dataset export --mode all --output assets.jsonl Export provenance and annotations\n  flow gallery                             List project generated images and videos with all inputs\n  flow results WORKFLOW_ID                  Latest output jobs by node\n  flow manifest RUN_ID --output run.json    Export exact recorded inputs and outputs\n  flow search-status|search-retry           Inspect/recover local semantic index\n  flow agent schema                        Describe page-aware context JSON\n  flow agent session [--from session.json]  Open/reuse this project’s assistant conversation\n  flow agent read SESSION_ID                Read assistant messages and progress\n  flow agent ask [SESSION_ID] --workflow ID --prompt "Change sports"  Request an edit proposal\n  flow agent ask SESSION_ID --from ask.json  Submit a stable message ID and page context\n  flow agent apply|cancel|undo SESSION_ID TURN_ID  Apply/undo draft changes or cancel text inference\n  flow editor open --image /files/...       Create/read per-image region editor\n  flow editor segment ID                   Detect masks with local SAM 2.1; auto-name with vision\n  flow editor name ID [--provider codex-text]  Name remaining regions; preserves manual names\n  flow editor cancel-naming ID             Stop vision naming; keep existing masks/names\n  flow editor patch ID --from change.json   Edit layers or add/resolve region comments\n  flow editor prepare ID --from edit.json   Prepare region/recolor/whole version; no inference\n  flow editor send EDITOR_ID REQUEST_ID     Queue prepared image version; idempotent\n  flow editor list|status|setup|inspect|variations ID   Discover editors or install local model\n  flow open --editor ID                     Open the image region editor\n  flow projects [--search NAME]             Search registered local projects\n  flow project update [ID] --name NAME --workflow ID | --clear-default\n  flow project init --project ID --root PATH [--workflow ID]\n  flow project register --from PATH/flow.project.json\n  flow project archive|restore ID           Archive or restore a local project\n  flow workflow archive|restore ID          Archive or restore a workflow\n  flow project inspect [ID]                 Inspect a registered project\n  flow workflows [--project ID]             List project workflows\n  flow workflow create --name "Studies" --prompt "A scene" --seed-image ./seed.png\n  flow workflow create --media video --name "Motion studies" --prompt "A cyclist accelerates" --resolution 720p\n  flow workflow organize ID [--plan]  Arrange cards; --geometry FILE supplies measured bounds\n  flow workflow <id> --json                 Inspect nodes, edges and fork lineage\n  flow fork <id> --name "My exploration"    Save an independent workflow fork (optional --run RUN_ID snapshot)\n  flow import --from campaign.flow.json              Validate and save a workflow\n  flow prompt-set preview WORKFLOW_ID --node SET_ID --items SCENE_ID  Inspect a scene without inference\n  flow plan --workflow paper-studies        Preview jobs without inference\n  flow wait <run-id> --json                 Wait for completion; single JSON result\n  flow run --workflow paper-studies         Run a saved workflow\n  flow run --seed-image ./seed.png --prompt "Your brief" --count 100 --concurrency 4 --wait\n  flow run --from ./workflow.json --seed 42  Run an exported workflow\n  flow search "meaning" --project ID       Search generated images by meaning\n  flow search "meaning" --workflow ID --provider codex --count 20 --json\n  flow runs                                List run history\n  flow inspect <run-id>                     Show jobs and outputs\n  flow pause|resume|retry|cancel <run-id>    Control a run\n  flow download <run-id> --output images.zip  Download all completed images and videos\n  flow export <workflow-id> --output campaign.flow.json\n\nOptions: --prompts FILE (scene array on workflow creation) --prompt-set SET_ID --items ID,ID (scoped plan/run)\n         --node NODE_ID (run a node or output flow) --records CSV_OR_JSON --template TEMPLATE_FILE --plan (preview without inference)\n         --modes modes.json (named providers/models/copies on one generator)\n         --output-format png|jpeg|webp|gif|svg --frames 2–16 --frame-delay MS --complexity low|medium|high --background auto|opaque|transparent\n         --media image|video --resolution RESOLUTION --duration SECONDS --video-mode text|image|reference\n         --seed N  --count N (copies per variation)  --concurrency 1–128\n         --seed-image PATH (repeatable)  --prompt TEXT  --provider ID --model ID  --prompt-provider ID --prompt-model ID --prompt-instructions TEXT  --wait  --json\n         --timeout SECONDS (wait limit; default 3600)\n         editor prepare: --mode region|recolor|whole --regions ID,ID --prompt TEXT --color "#RRGGBB" --strength 0–1\n         agent ask: --reasoning inherit|off|on|minimal|low|medium|high|xhigh|max (provider/model support varies)\n         projects/workflows: --archived (recoverable archived items)\n         styles: [STYLE_ID] --search TEXT --category NAME --favorites\n         style start ID: --subject TEXT --project ID --name NAME\n         open: --project ID --node ID --run ID --gallery | --styles | --projects --print-url (no browser launch)\n         search: --workflow ID --run ID --provider ID --count 1–200 (default 100) --scope all|unassigned|project:ID|workflow:ID (unbound only)\n         --project ID --root PATH (discover project manifest); --id ID --name NAME --ratio RATIO --quality QUALITY\n         --url http://localhost:4310  --port N  --force (interrupt active jobs on stop)\n\nStart the local server: npm run build && node cli/flow.mjs serve\nSeed behavior depends on the provider. Codex uses variation labels; Local color lab supports deterministic seeds.\n`,
    );
    process.exit(0);
  }
  let viewerServer;
  if (["open", "mcp"].includes(command)) {
    const root = resolve(import.meta.dirname, "..");
    viewerServer = await startServer({
      url: base,
      root,
      dataRoot: resolve(process.env.FLOW_DATA_DIR || resolve(root, ".flow")),
    });
  }
  let registeredProject;
  if (
    projectId &&
    !(command === "agent" && id === "schema") &&
    ![
      "serve",
      "stop",
      "restart",
      "project",
      "projects",
      "guide",
      "schema",
      "status",
      "providers",
    ].includes(command)
  ) {
    registeredProject = await client.project();
    if (context && !values.project && context.root !== registeredProject.root)
      throw new Error(
        `Project ${projectId} is registered at ${registeredProject.root}, but this manifest is at ${context.root}. Register the manifest at its correct root or pass --project ${projectId} explicitly to work across directories.`,
      );
  }
  if (
    ["plan", "run"].includes(command) &&
    projectId &&
    !values.workflow &&
    !values.from
  ) {
    defaultWorkflowId = registeredProject.defaultWorkflowId;
    if (!defaultWorkflowId && values.prompt === undefined && !values.records)
      throw new Error(
        `Project ${projectId} has no default workflow. Pass --workflow ID or create a workflow explicitly.`,
      );
  }
  if (command === "mcp") {
    const { startMcpServer } = await import("../mcp/server.mjs");
    await startMcpServer({ url: base, projectId });
  } else if (["serve", "stop", "restart"].includes(command)) {
    const root = resolve(import.meta.dirname, "..");
    const config = {
      url: base,
      root,
      dataRoot: resolve(process.env.FLOW_DATA_DIR || resolve(root, ".flow")),
      force: values.force,
    };
    if (command !== "serve") {
      const stopped = await stopServer(config);
      if (command === "stop") print(stopped);
    }
    if (command !== "stop") print(await startServer(config));
  } else if (command === "agent") {
    const input = values.from
      ? JSON.parse(await readFile(resolve(values.from), "utf8"))
      : {};
    const sessionId = args[2] || input.sessionId;
    if (id === "schema") print(z.toJSONSchema(agentContextSchema));
    else if (!id || id === "session")
      print(await client.agentSession(agentSessionSchema.parse(input)));
    else if (id === "ask") {
      const { sessionId: _session, turnId: _turn, ...payload } = input;
      let page = { page: "projects", ...payload.context };
      if (values.workflow) {
        const graph = await client.workflow(values.workflow);
        page = {
          ...page,
          page: "canvas",
          workflowId: graph.id,
          revision: graph.revision || 0,
        };
      }
      if (values.run) page = { ...page, page: "recorded", runId: values.run };
      if (values.editor)
        page = { ...page, page: "editor", editorId: values.editor };
      if (values.node) page.selectedNodeIds = [values.node];
      if (values.regions) page.regionIds = values.regions.split(",");
      const message = askAgentSchema.parse({
        ...payload,
        id: values.id || payload.id || randomUUID(),
        message: values.prompt ?? payload.message,
        ...(values.provider && { providerId: values.provider }),
        ...(values.model && { model: values.model }),
        ...(values.reasoning && { reasoningEffort: values.reasoning }),
        context: page,
      });
      const target = sessionId || (await client.agentSession()).id;
      z.string().uuid().parse(target);
      print(await client.askAgent(target, message));
    } else {
      if (!sessionId)
        throw new Error(
          "Provide a conversation ID: agent read|apply|cancel|undo SESSION_ID [TURN_ID].",
        );
      z.string().uuid().parse(sessionId);
      if (id === "read") print(await client.agentConversation(sessionId));
      else if (id === "trace") {
        const turnId = args[3] || input.turnId || values.id;
        z.string().uuid().parse(turnId);
        print(await client.agentTrace(sessionId, turnId));
      } else if (["apply", "cancel", "undo"].includes(id)) {
        const turnId = args[3] || input.turnId || values.id;
        if (!turnId)
          throw new Error(
            "Provide the assistant turn ID after the conversation ID.",
          );
        z.string().uuid().parse(turnId);
        const action = {
          apply: "applyAgentTurn",
          cancel: "cancelAgentTurn",
          undo: "undoAgentTurn",
        }[id];
        print(await client[action](sessionId, turnId));
      } else
        throw new Error(
          "Use agent schema|session|read|trace|ask|apply|cancel|undo.",
        );
    }
  } else if (command === "editor") {
    const target = args[2] || values.editor;
    const input = values.from
      ? JSON.parse(await readFile(resolve(values.from), "utf8"))
      : {};
    if (!id || id === "list") print(await client.imageEditors());
    else if (id === "status") print(await client.editorStatus());
    else if (id === "setup") print(await client.setupEditorModel());
    else if (id === "open") {
      let source = values.image || input.source;
      if (values["seed-image"]?.length)
        source = (
          await client.upload(
            await Promise.all(
              values["seed-image"].map(async (file) => ({
                name: basename(file),
                data: await readFile(resolve(file)),
              })),
            ),
          )
        )[0].url;
      if (!source)
        throw new Error(
          "Provide --image LOCAL_URL, --seed-image PATH or --from input.json.",
        );
      print(await client.openImageEditor({ ...input, source }));
    } else {
      if (!target) throw new Error("Provide an editor ID.");
      if (id === "inspect") print(await client.imageEditor(target));
      else if (id === "variations") print(await client.imageVariations(target));
      else if (id === "name")
        print(
          await client.nameImageRegions(target, {
            ...input,
            ...(values.provider && { providerId: values.provider }),
            ...(values.model && { model: values.model }),
          }),
        );
      else if (id === "cancel-naming")
        print(await client.cancelImageNaming(target));
      else if (id === "segment")
        print(await client.segmentImage(target, input));
      else if (id === "patch")
        print(await client.patchImageEditor(target, input));
      else if (id === "send") {
        const requestId = args[3] || input.requestId;
        if (!requestId)
          throw new Error(
            "Provide the prepared request ID: editor send EDITOR_ID REQUEST_ID.",
          );
        print(await client.sendImageEdit(target, requestId));
      } else if (id === "prepare") {
        const editor = await client.imageEditor(target);
        print(
          await client.prepareImageEdit(target, {
            revision: editor.revision,
            regionIds: [],
            instructions: "",
            ...input,
            ...(values.regions && { regionIds: values.regions.split(",") }),
            ...(values.prompt !== undefined && { instructions: values.prompt }),
            ...(values.provider && { providerId: values.provider }),
            ...(values.model && { model: values.model }),
            ...(values.count && { count: Number(values.count) }),
            ...(values.mode && { mode: values.mode }),
            ...(values.color && { color: values.color }),
            ...(values.strength !== undefined && {
              strength: Number(values.strength),
            }),
          }),
        );
      } else
        throw new Error(
          "Use editor list|status|setup|open|inspect|variations|segment|name|cancel-naming|patch|prepare|send.",
        );
    }
  } else if (command === "open") {
    if (id && values.workflow && id !== values.workflow)
      throw new Error("Workflow argument and --workflow must match.");
    const target = await client.viewer({
      workflowId: id || values.workflow,
      nodeId: values.node,
      runId: values.run,
      gallery: values.gallery,
      styles: values.styles,
      projects: values.projects,
      editorId: values.editor,
    });
    const receipt = values["print-url"]
      ? { ...target, opened: false }
      : await openViewer(target);
    print({
      ...receipt,
      server: {
        pid: viewerServer.pid,
        alreadyRunning: viewerServer.alreadyRunning,
      },
    });
  } else if (command === "styles") {
    print(
      id
        ? await client.style(id)
        : await client.styles({
            search: values.search,
            category: values.category,
            favorites: values.favorites,
          }),
    );
  } else if (command === "style") {
    if (id === "create" || id === "update") {
      if (!values.from || (id === "update" && !args[2]))
        throw new Error(
          `Use style ${id}${id === "update" ? " ID" : ""} --from style.json [--seed-image ./reference.png].`,
        );
      const input = JSON.parse(await readFile(resolve(values.from), "utf8"));
      if (values["seed-image"]?.length) {
        if ((input.references?.length || 0) + values["seed-image"].length > 16)
          throw new Error("A style can have at most 16 references.");
        const assets = await client.upload(
          await Promise.all(
            values["seed-image"].map(async (file) => ({
              name: basename(file),
              data: await readFile(resolve(file)),
            })),
          ),
        );
        input.references = [
          ...(input.references || []),
          ...assets.map((asset) => ({
            url: asset.url,
            label: asset.name || "Uploaded reference",
            kind: "uploaded",
          })),
        ];
      }
      print(
        id === "create"
          ? await client.createStyle(input)
          : await client.updateStyle(args[2], input),
      );
    } else if (id === "start") {
      if (!args[2])
        throw new Error(
          "Provide a style ID: flow style start ID --subject 'Your scene'.",
        );
      print(
        await client.startStyle(args[2], {
          subject: values.subject || values.prompt,
          name: values.name,
        }),
      );
    } else if (id === "favorite") {
      if (!args[2]) throw new Error("Provide a style ID.");
      print(await client.favoriteStyle(args[2], !values.unfavorite));
    } else if (id === "import-run") {
      if (!args[2]) throw new Error("Provide a reference run ID.");
      print(await client.importStyleRun(args[2]));
    } else if (id === "references") {
      if (!args[2] || !values.from)
        throw new Error(
          "Use style references ID --from references.json containing a references array.",
        );
      const input = JSON.parse(await readFile(resolve(values.from), "utf8"));
      print(await client.styleReferences(args[2], input.references || input));
    } else
      throw new Error(
        "Use style create|update|start|favorite|references|import-run.",
      );
  } else if (command === "upload") {
    const paths = [...args.slice(1), ...(values["seed-image"] || [])];
    if (!paths.length)
      throw new Error(
        "Provide image paths: flow upload ./seed.png [./other.png].",
      );
    if (paths.length > 16) throw new Error("Upload at most 16 images at once.");
    const files = await Promise.all(
      paths.map(async (file) => ({
        name: basename(file),
        data: await readFile(resolve(file)),
      })),
    );
    print(await client.upload(files));
  } else if (command === "assets") {
    print(
      await client.assets({
        runId: values.run,
        url: values.image,
        workflowId: values.workflow,
      }),
    );
  } else if (command === "asset") {
    const assetId = ["lineage", "annotate"].includes(id) ? args[2] : id;
    if (!assetId)
      throw new Error(
        "Provide asset ID: asset ID | asset lineage ID | asset annotate ID --from annotations.json",
      );
    if (id === "lineage") print(await client.assetLineage(assetId));
    else if (id === "annotate") {
      if (!values.from)
        throw new Error(
          "Provide --from annotations.json with the current annotation revision.",
        );
      print(
        await client.annotateAsset(
          assetId,
          JSON.parse(await readFile(resolve(values.from), "utf8")),
        ),
      );
    } else print(await client.asset(assetId));
  } else if (command === "dataset") {
    if (id && id !== "export")
      throw new Error(
        "Use dataset export --project ID --mode all|training --output assets.jsonl",
      );
    const data = await client.exportDataset({
      mode: values.mode || "all",
      runId: values.run,
      workflowId: values.workflow,
    });
    if (values.output) {
      await writeFile(resolve(values.output), data.jsonl);
      const { jsonl, ...summary } = data;
      print({ ...summary, output: resolve(values.output) });
    } else if (values.json)
      print({
        ...data,
        rows: data.jsonl.trim()
          ? data.jsonl
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line))
          : [],
        jsonl: undefined,
      });
    else process.stdout.write(data.jsonl);
  } else if (command === "gallery") print(await client.gallery());
  else if (command === "results") {
    if (!id) throw new Error("Provide a workflow ID.");
    print(await client.workflowResults(id));
  } else if (command === "manifest") {
    if (!id) throw new Error("Provide a run ID.");
    const manifest = await client.manifest(id);
    if (values.output) {
      await writeFile(
        resolve(values.output),
        JSON.stringify(manifest, null, 2) + "\n",
      );
      print({ runId: id, path: resolve(values.output) });
    } else print(manifest);
  } else if (command === "search-status") print(await client.searchStatus());
  else if (command === "search-retry") print(await client.searchRetry());
  else if (command === "projects")
    print(
      await client.projects({
        search: values.search,
        archived: values.archived ? "archived" : undefined,
      }),
    );
  else if (command === "project") {
    if (["archive", "restore"].includes(id)) {
      const target = args[2] || projectId;
      if (!target) throw new Error("Provide a project ID.");
      print(await client.archiveProject(target, id === "archive"));
    } else if (id === "init") {
      if (!projectId)
        throw new Error("Provide --project ID to initialize a project.");
      print(
        await registerProject({
          context,
          root: values.root,
          projectId,
          name: values.name,
          workflowId: values.workflow,
          bootstrapWorkflowId: context?.manifest.defaultWorkflowId,
          writeManifest: true,
        }),
      );
    } else if (id === "register") {
      const selected = values.from
        ? await readProjectManifest(values.from)
        : context;
      if (!selected)
        throw new Error(
          "Provide --from flow.project.json or run from a registered project directory.",
        );
      if (values.project && values.project !== selected.manifest.projectId)
        throw new Error("Explicit project does not match the manifest.");
      if (!values.url && !process.env.FLOW_URL && !values.port) {
        base = selected.manifest.serverUrl;
        client = new FlowClient({
          url: base,
          projectId: selected.manifest.projectId,
        });
      }
      print(
        await registerProject({
          context: selected,
          projectId: selected.manifest.projectId,
          name: values.name,
          bootstrapWorkflowId: selected.manifest.defaultWorkflowId,
          writeManifest: false,
        }),
      );
    } else if (id === "update") {
      const target = args[2] || projectId;
      if (!target) throw new Error("Choose --project ID or project update ID.");
      if (projectId && target !== projectId)
        throw new Error("Project update target does not match --project.");
      if (values.workflow && values["clear-default"])
        throw new Error("Choose --workflow ID or --clear-default.");
      if (!values.name && !values.workflow && !values["clear-default"])
        throw new Error("Provide --name, --workflow or --clear-default.");
      print(
        await client.updateProject(target, {
          ...(values.name && { name: values.name }),
          ...(values.workflow && { defaultWorkflowId: values.workflow }),
          ...(values["clear-default"] && { defaultWorkflowId: null }),
        }),
      );
    } else
      print(
        await client.project((id === "inspect" ? args[2] : id) || projectId),
      );
  } else if (command === "guide") print(await client.guide());
  else if (command === "rules") {
    if (!id) print(await client.ruleTemplates());
    else if (id === "save") {
      if (!values.from)
        throw new Error(
          "Provide --from rule.json containing {id,title,group?,text}.",
        );
      print(
        await client.saveRuleTemplate(
          JSON.parse(await readFile(resolve(values.from), "utf8")),
        ),
      );
    } else
      throw new Error(
        "Use `flow rules` or `flow rules save --from rule.json`.",
      );
  } else if (command === "schema") print(await request("/api/schema/workflow"));
  else if (command === "workflow" && id === "create")
    print(
      await client.createWorkflow(
        await prepareWorkflow(client, values, { create: true }),
      ),
    );
  else if (command === "workflow" && id === "organize") {
    if (!args[2]) throw new Error("Provide a workflow ID.");
    const graph = await client.workflow(args[2]);
    print(
      await client.organizeWorkflow(graph.id, {
        revision: graph.revision || 0,
        ...(values.geometry && {
          geometry: JSON.parse(
            await readFile(resolve(values.geometry), "utf8"),
          ),
        }),
        preview: Boolean(values.plan),
      }),
    );
  } else if (command === "workflow" && ["archive", "restore"].includes(id)) {
    if (!args[2]) throw new Error("Provide a workflow ID.");
    print(await client.archiveWorkflows([args[2]], id === "archive"));
  } else if (command === "workflow") {
    if (!id) throw new Error("Provide a workflow ID.");
    print(await loadWorkflow(client, id));
  } else if (command === "fork") {
    if (!id) throw new Error("Provide a source workflow ID.");
    let snapshot;
    if (values.run) {
      const run = await client.inspect(values.run);
      if (run.workflowId !== id)
        throw new Error(
          `Run ${values.run} belongs to workflow ${run.workflowId}, not ${id}.`,
        );
      snapshot = { ...run.graph, id: run.workflowId };
    }
    print(await client.fork(id, { name: values.name, workflow: snapshot }));
  } else if (command === "import") {
    if (!values.from) throw new Error("Provide --from workflow.flow.json.");
    const graph = owned(
      fromFlowFile(JSON.parse(await readFile(resolve(values.from), "utf8"))),
      client.projectId,
    );
    print(await client.saveWorkflow(graph));
  } else if (command === "wait") await waitForRun(id);
  else if (command === "status") print(await request("/api/health"));
  else if (command === "local") {
    const runtime = args[2];
    if (!id || id === "status") print(await client.localModels(runtime));
    else if (id === "configure") {
      if (!runtime || !values.from)
        throw new Error(
          "Use local configure ollama|comfyui --from config.json containing {baseUrl}.",
        );
      print(
        await client.configureLocalRuntime(
          runtime,
          JSON.parse(await readFile(resolve(values.from), "utf8")),
        ),
      );
    } else if (
      ["setup", "start", "stop", "pull", "cancel", "install"].includes(id)
    ) {
      if (!runtime)
        throw new Error(
          "Choose ollama/comfyui, or a preset ID for local install.",
        );
      const input = values.from
        ? JSON.parse(await readFile(resolve(values.from), "utf8"))
        : values.model
          ? { model: values.model }
          : {};
      const runtimeId = id === "install" ? "comfyui" : runtime;
      let status = await (id === "install"
        ? client.installLocalModel(runtime)
        : client.localModelAction(runtime, id, input));
      if (values.wait) {
        const until = Date.now() + Number(values.timeout || 3600) * 1000;
        while (status.task?.status === "running") {
          if (Date.now() > until)
            throw new Error(
              "Local setup is still running. Use local status to inspect it; this wait did not cancel it.",
            );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          status = await client.localModels(runtimeId);
        }
        if (
          ["failed", "interrupted", "cancelled"].includes(status.task?.status)
        )
          throw new Error(status.task.message);
        await client.reloadProviders();
      }
      print(status);
    } else if (id === "profiles") print(await client.localProfiles());
    else if (id === "profile") {
      if (runtime === "save") {
        if (!values.from)
          throw new Error("Use local profile save --from profile.json.");
        print(
          await client.saveLocalProfile(
            JSON.parse(await readFile(resolve(values.from), "utf8")),
          ),
        );
      } else if (["validate", "remove"].includes(runtime) && args[3])
        print(
          await (runtime === "validate"
            ? client.validateLocalProfile(args[3])
            : client.removeLocalProfile(args[3])),
        );
      else
        throw new Error(
          "Use local profile save --from profile.json or local profile validate|remove PROFILE_ID.",
        );
    } else if (id === "checkpoint") {
      if (!values.from)
        throw new Error(
          "Use local checkpoint --from recipe.json with {id,name,checkpoint,imageToImage?}.",
        );
      print(
        await client.createLocalCheckpointProfile(
          JSON.parse(await readFile(resolve(values.from), "utf8")),
        ),
      );
    } else
      throw new Error(
        "Use local status|configure|setup|start|stop|pull|cancel|profiles|profile|checkpoint.",
      );
  } else if (command === "providers") {
    if (!id) print(await client.providers());
    else if (id === "usage") print(await client.harnessUsage());
    else if (id === "codex") print(await client.codexConnection());
    else if (id === "configure-codex") {
      if (!values.from)
        throw new Error(
          "Provide --from private-codex-connection.json with {mode,apiKey?}. Never pass keys as command arguments.",
        );
      print(
        await client.configureCodex(
          JSON.parse(await readFile(resolve(values.from), "utf8")),
        ),
      );
    } else if (id === "login-codex") print(await client.startCodexLogin());
    else if (id === "cancel-codex-login")
      print(await client.cancelCodexLogin());
    else if (id === "fal") print(await client.falConnection());
    else if (id === "configure-fal") {
      if (!values.from)
        throw new Error(
          "Provide --from private-fal-connection.json. Never pass keys as command arguments.",
        );
      print(
        await client.configureFal(
          JSON.parse(await readFile(resolve(values.from), "utf8")),
        ),
      );
    } else if (id === "grok") print(await client.grokConnection());
    else if (id === "configure-grok") {
      if (!values.from)
        throw new Error(
          "Provide --from private-grok-connection.json. Never put keys in workflow graphs or command arguments.",
        );
      print(
        await client.configureGrok(
          JSON.parse(await readFile(resolve(values.from), "utf8")),
        ),
      );
    } else if (id === "gemini-video")
      print(await client.geminiVideoConnection());
    else if (id === "configure-video") {
      if (!values.from)
        throw new Error(
          "Provide --from private-video-connection.json. API keys belong in that private file, never in workflow graphs or command arguments.",
        );
      print(
        await client.configureGeminiVideo(
          JSON.parse(await readFile(resolve(values.from), "utf8")),
        ),
      );
    } else if (id === "reload") print(await client.reloadProviders());
    else if (id === "example") print(await client.providerExample());
    else if (["save", "create"].includes(id)) {
      if (!values.from)
        throw new Error(
          "Provide --from connection.json. Keys belong in this private file, never in command arguments or workflows.",
        );
      if (id === "create" && args[2])
        throw new Error("Use providers save ID to update a connection.");
      print(
        await client.saveProviderConnection(
          JSON.parse(await readFile(resolve(values.from), "utf8")),
          args[2],
        ),
      );
    } else if (["test", "remove"].includes(id)) {
      if (!args[2]) throw new Error("Provide a provider connection ID.");
      print(
        await (id === "test"
          ? client.testProviderConnection(args[2])
          : client.removeProviderConnection(args[2])),
      );
    } else
      throw new Error(
        "Use providers [usage|codex|configure-codex|login-codex|cancel-codex-login|fal|configure-fal|grok|configure-grok|gemini-video|configure-video|reload|example|create|save|test|remove].",
      );
  } else if (command === "workflows")
    print(
      (
        await client.workflows(projectId, {
          archived: values.archived ? "archived" : undefined,
        })
      ).map((g) => ({
        projectId: g.projectId,
        id: g.id,
        name: g.name,
        nodes: g.nodes.length,
        forkedFrom: g.forkedFrom,
      })),
    );
  else if (command === "search") {
    const query = args.slice(1).join(" ").trim();
    if (!query) throw new Error('Provide search text: flow search "a scene".');
    const limit = values.count === undefined ? undefined : Number(values.count);
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > 200)
    )
      throw new Error("Search result count must be 1–200.");
    print(
      await client.searchImages({
        query,
        scope: values.scope,
        workflowId: values.workflow,
        runId: values.run,
        providerId: values.provider,
        limit,
      }),
    );
  } else if (command === "runs") print(await client.runs());
  else if (command === "inspect") print(await client.inspect(id));
  else if (["pause", "resume", "retry", "cancel"].includes(command))
    print(await client.control(id, command));
  else if (command === "download") {
    if (!id) throw new Error("Provide a run ID.");
    const target = resolve(values.output || `flow-${id}.zip`);
    await writeFile(target, await client.download(id));
    print("Saved " + target);
  } else if (command === "export") {
    const graph = await loadWorkflow(client, id);
    if (values.output) {
      await writeFile(resolve(values.output), JSON.stringify(toFlowFile(graph), null, 2) + "\n");
      print("Saved " + resolve(values.output));
    } else print(toFlowFile(graph));
  } else if (command === "prompt-set" && id === "preview") {
    const workflowId = args[2] || values.workflow;
    if (
      !workflowId ||
      !values.node ||
      !values.items ||
      values.items.includes(",")
    )
      throw new Error(
        "Use prompt-set preview WORKFLOW_ID --node SET_ID --items SCENE_ID.",
      );
    print(
      await client.previewPromptItem(workflowId, values.node, values.items),
    );
  } else if (["run", "plan"].includes(command)) {
    const workflow = await prepareWorkflow(client, values, {
      workflowId:
        values.workflow || (!values.from ? defaultWorkflowId : undefined),
    });
    const options = runOptions(values);
    if (values.plan || command === "plan")
      print(await client.plan(workflow, options));
    else {
      const run = await client.run(workflow, options, {
        concurrency:
          values.concurrency === undefined
            ? undefined
            : Number(values.concurrency),
      });
      if (values.wait) await waitForRun(run.id);
      else
        print(
          values.json
            ? {
                runId: run.id,
                workflowId: run.workflowId,
                projectId: run.projectId,
                total: run.jobs.length,
                status: run.status,
              }
            : `Run ${run.id} · ${run.jobs.length} jobs\n${base} · Outputs stay in the local workspace`,
        );
    }
  } else throw new Error("Unknown command. Run flow --help.");
} catch (error) {
  console.error(
    error.cause?.code === "ECONNREFUSED"
      ? `Flow is not running at ${base}. Start it with npm run dev.`
      : error.message,
  );
  process.exitCode = 1;
}
