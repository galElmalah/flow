import { providerFailureFields } from "../shared/provider-errors.mjs";
import { fromFlowFile } from "../shared/flow-file.mjs";
import {
  runOptionsSchema,
  runSubmissionSchema,
} from "../shared/run-options.mjs";
import { resolveViewer } from "./viewer.mjs";
const encoded = (id) => encodeURIComponent(id);

export class FlowError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "FlowError";
    this.status = status;
    if (code) this.code = code;
  }
}

function parseRunInput(schema, value) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw Object.assign(
    new FlowError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
      400,
      "INVALID_ARGUMENT",
    ),
    { issues: parsed.error.issues },
  );
}

function assertProjectScope(boundProject, target) {
  if (boundProject && boundProject !== target)
    throw new FlowError(
      `Project must be ${boundProject}.`,
      409,
      "PROJECT_SCOPE_MISMATCH",
    );
}

function graphInput(input) {
  return input && Object.hasOwn(input, "format") ? fromFlowFile(input) : input;
}

function scopedGraph(input, projectId) {
  const graph = graphInput(input);
  if (graph?.projectId !== undefined)
    assertProjectScope(projectId, graph.projectId);
  return graph && graph.projectId === undefined && projectId !== undefined
    ? { ...graph, projectId }
    : graph;
}

/** A small local HTTP client. All durable writes go through the platform. */
export class FlowClient {
  constructor({
    url = process.env.FLOW_URL || "http://localhost:4310",
    projectId,
    fetch: transport = globalThis.fetch,
  } = {}) {
    this.url = url.replace(/\/$/, "");
    this.projectId = projectId;
    this.fetch = transport.bind(globalThis);
  }
  async response(route, options = {}) {
    const headers = new Headers(options.headers);
    if (typeof options.body === "string" && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    const response = await this.fetch(this.url + route, {
      ...options,
      headers,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => {
        options.signal?.throwIfAborted();
      });
      throw Object.assign(
        new FlowError(
          (typeof data?.error === "string" && data.error) ||
            response.statusText ||
            `HTTP ${response.status}`,
          response.status,
          typeof data?.code === "string" ? data.code : undefined,
        ),
        typeof data?.runId === "string" && { runId: data.runId },
        Array.isArray(data?.issues) && { issues: data.issues },
        providerFailureFields(data),
      );
    }
    return response;
  }
  async request(route, options) {
    return (await this.response(route, options)).json();
  }
  post(route, body) {
    return this.request(route, { method: "POST", body: JSON.stringify(body) });
  }
  put(route, body) {
    return this.request(route, { method: "PUT", body: JSON.stringify(body) });
  }
  scoped(route, projectId = this.projectId) {
    return route + (projectId ? `?projectId=${encoded(projectId)}` : "");
  }
  viewer(options) {
    return resolveViewer(this, options);
  }
  guide() {
    return this.request("/api");
  }
  previewPromptItem(workflow, nodeId, itemId) {
    return this.post("/api/prompt-sets/preview", {
      ...this.runBody(workflow, {}),
      nodeId,
      itemId,
    });
  }
  codexConnection() {
    return this.request("/api/providers/codex");
  }
  configureCodex(input) {
    return this.put("/api/providers/codex", input);
  }
  startCodexLogin() {
    return this.post("/api/providers/codex/login", {});
  }
  cancelCodexLogin() {
    return this.post("/api/providers/codex/login/cancel", {});
  }
  schema() {
    return this.request("/api/schema/workflow");
  }
  styles({ search, category, favorites } = {}) {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (category) query.set("category", category);
    if (favorites !== undefined) query.set("favorites", String(favorites));
    return this.request(`/api/styles${query.size ? `?${query}` : ""}`);
  }
  style(id) {
    return this.request(`/api/styles/${encoded(id)}`);
  }
  createStyle(input) {
    return this.post("/api/styles", input);
  }
  updateStyle(id, changes) {
    return this.put(`/api/styles/${encoded(id)}`, changes);
  }
  favoriteStyle(id, favorite) {
    return this.put(`/api/styles/${encoded(id)}/favorite`, { favorite });
  }
  startStyle(id, options = {}) {
    if (
      this.projectId &&
      options.projectId !== undefined &&
      options.projectId !== this.projectId
    )
      throw new FlowError(
        `Workflow must belong to project ${this.projectId}.`,
        409,
      );
    return this.post(`/api/styles/${encoded(id)}/workflows`, {
      ...options,
      projectId: this.projectId ?? options.projectId,
    });
  }
  styleReferences(id, references) {
    return this.post(`/api/styles/${encoded(id)}/references`, { references });
  }
  importStyleRun(runId) {
    return this.post("/api/styles/import-run", {
      runId,
      projectId: this.projectId,
    });
  }
  agentSession(input = {}) {
    if (
      this.projectId &&
      input.projectId !== undefined &&
      input.projectId !== this.projectId
    )
      throw new FlowError(
        "Agent conversation belongs to another project.",
        409,
      );
    return this.post(this.scoped("/api/agent/sessions"), {
      ...input,
      projectId: this.projectId ?? input.projectId,
    });
  }
  agentConversation(id) {
    return this.request(this.scoped(`/api/agent/sessions/${encoded(id)}`));
  }
  agentTrace(id, turnId) {
    return this.request(
      this.scoped(
        `/api/agent/sessions/${encoded(id)}/turns/${encoded(turnId)}/trace`,
      ),
    );
  }
  reportAgentTiming(id, turnId, timing) {
    return this.post(
      this.scoped(
        `/api/agent/sessions/${encoded(id)}/turns/${encoded(turnId)}/timing`,
      ),
      timing,
    );
  }
  askAgent(id, input) {
    return this.post(
      this.scoped(`/api/agent/sessions/${encoded(id)}/turns`),
      input,
    );
  }
  applyAgentTurn(id, turnId) {
    return this.post(
      this.scoped(
        `/api/agent/sessions/${encoded(id)}/turns/${encoded(turnId)}/apply`,
      ),
      {},
    );
  }
  cancelAgentTurn(id, turnId) {
    return this.post(
      this.scoped(
        `/api/agent/sessions/${encoded(id)}/turns/${encoded(turnId)}/cancel`,
      ),
      {},
    );
  }
  undoAgentTurn(id, turnId) {
    return this.post(
      this.scoped(
        `/api/agent/sessions/${encoded(id)}/turns/${encoded(turnId)}/undo`,
      ),
      {},
    );
  }
  editorStatus() {
    return this.request("/api/image-editors/status");
  }
  setupEditorModel() {
    return this.post("/api/image-editors/setup", {});
  }
  imageEditors() {
    return this.request(this.scoped("/api/image-editors"));
  }
  openImageEditor(input) {
    if (this.projectId && input.projectId && input.projectId !== this.projectId)
      throw new FlowError(
        "Image editor project does not match this client.",
        409,
      );
    return this.post("/api/image-editors", {
      ...input,
      projectId: this.projectId || input.projectId,
    });
  }
  imageEditor(id) {
    return this.request(this.scoped(`/api/image-editors/${encoded(id)}`));
  }
  imageVariations(id) {
    return this.request(
      this.scoped(`/api/image-editors/${encoded(id)}/variations`),
    );
  }
  nameImageRegions(id, input = {}) {
    return this.post(
      this.scoped(`/api/image-editors/${encoded(id)}/names`),
      input,
    );
  }
  cancelImageNaming(id) {
    return this.post(
      this.scoped(`/api/image-editors/${encoded(id)}/names/cancel`),
      {},
    );
  }
  segmentImage(id, input = {}) {
    return this.post(
      this.scoped(`/api/image-editors/${encoded(id)}/segments`),
      input,
    );
  }
  patchImageEditor(id, input) {
    return this.request(this.scoped(`/api/image-editors/${encoded(id)}`), {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }
  prepareImageEdit(id, input) {
    return this.post(
      this.scoped(`/api/image-editors/${encoded(id)}/requests`),
      input,
    );
  }
  sendImageEdit(id, requestId) {
    return this.post(
      this.scoped(
        `/api/image-editors/${encoded(id)}/requests/${encoded(requestId)}/send`,
      ),
      {},
    );
  }
  ruleTemplates() {
    return this.request("/api/rule-templates");
  }
  saveRuleTemplate(template) {
    return this.post("/api/rule-templates", template);
  }
  projects({ search, archived } = {}) {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (archived) query.set("archived", archived);
    return this.request(`/api/projects${query.size ? `?${query}` : ""}`);
  }
  project(id = this.projectId) {
    if (!id) throw new Error("Choose a project first.");
    return this.request(`/api/projects/${encoded(id)}`);
  }
  createProject(project) {
    assertProjectScope(this.projectId, project.id);
    return this.post("/api/projects", project);
  }
  updateProject(id, changes) {
    assertProjectScope(this.projectId, id);
    return this.put(`/api/projects/${encoded(id)}`, changes);
  }
  workflows(projectId = this.projectId, { archived, summary } = {}) {
    const query = new URLSearchParams();
    if (projectId) query.set("projectId", projectId);
    if (archived) query.set("archived", archived);
    if (summary) query.set("summary", "1");
    return this.request(`/api/workflows${query.size ? `?${query}` : ""}`);
  }
  archiveWorkflows(ids, archived = true, reason) {
    return this.post("/api/workflows/archive", {
      ids,
      archived,
      reason,
      projectId: this.projectId,
    });
  }
  archiveProject(id, archived = true, reason) {
    if (this.projectId && this.projectId !== id)
      throw new FlowError("Project does not match this connection.", 409);
    return this.post(`/api/projects/${encoded(id)}/archive`, {
      archived,
      reason,
    });
  }
  workflow(id, { unscoped = false } = {}) {
    const route = `/api/workflows/${encoded(id)}`;
    return this.request(unscoped ? route : this.scoped(route));
  }
  organizeWorkflow(id, options) {
    return this.post(
      this.scoped(`/api/workflows/${encoded(id)}/organize`),
      options,
    );
  }
  createWorkflow(graph) {
    return this.post("/api/workflows", scopedGraph(graph, this.projectId));
  }
  async saveWorkflow(input) {
    const graph = graphInput(input);
    const existing = await this.workflow(graph.id, { unscoped: true }).catch(
      (error) => {
        if (error.status !== 404) throw error;
        return null;
      },
    );
    if (
      this.projectId &&
      existing?.projectId &&
      existing.projectId !== this.projectId
    )
      throw new FlowError(
        `Workflow ${graph.id} belongs to project ${existing.projectId}, not ${this.projectId}. Fork explicitly before editing it.`,
        409,
      );
    const explicitOwner = graph.projectId !== undefined;
    const projectId = explicitOwner
      ? graph.projectId
      : (this.projectId ?? existing?.projectId);
    assertProjectScope(this.projectId, projectId);
    if (existing?.projectId && projectId && existing.projectId !== projectId)
      throw new FlowError(
        `Workflow ${graph.id} belongs to project ${existing.projectId}. Fork explicitly to change projects.`,
        409,
      );
    if (existing && !existing.projectId && this.projectId && !explicitOwner)
      throw new FlowError(
        "Assign an unowned workflow explicitly with projectId before saving it in a project.",
        409,
      );
    return this.put(`/api/workflows/${encoded(graph.id)}`, {
      ...graph,
      projectId,
    });
  }
  fork(id, { name, workflow, runId, projectId = this.projectId } = {}) {
    assertProjectScope(this.projectId, projectId);
    if (runId !== undefined && workflow !== undefined)
      throw new FlowError(
        "Choose a run or a workflow snapshot to fork.",
        400,
        "INVALID_ARGUMENT",
      );
    const route = `/api/workflows/${encoded(id)}/fork`;
    return this.post(runId === undefined ? route : this.scoped(route), {
      name,
      workflow: graphInput(workflow),
      runId,
      projectId,
    });
  }
  plan(workflow, options = {}) {
    return this.post("/api/plan", this.runBody(workflow, options));
  }
  run(workflow, options = {}, submission = {}) {
    return this.post("/api/runs", {
      ...this.runBody(workflow, options),
      ...parseRunInput(runSubmissionSchema, submission),
    });
  }
  runBody(workflow, options) {
    return {
      ...(typeof workflow === "string"
        ? { workflowId: workflow }
        : { workflow: scopedGraph(workflow, this.projectId) }),
      projectId: this.projectId,
      options: parseRunInput(runOptionsSchema, options),
    };
  }
  runs(projectId = this.projectId) {
    return this.request(this.scoped("/api/runs", projectId));
  }
  async inspect(id, { signal } = {}) {
    const run = await this.request(this.scoped(`/api/runs/${encoded(id)}`), {
      signal,
    });
    if (this.projectId && run.projectId !== this.projectId)
      throw new FlowError(
        `Run ${id} belongs to ${run.projectId || "the unassigned workspace"}, not project ${this.projectId}.`,
        409,
      );
    return run;
  }
  control(id, action) {
    return this.post(`/api/runs/${encoded(id)}/${encoded(action)}`, {
      projectId: this.projectId,
    });
  }
  providers() {
    return this.request("/api/providers");
  }
  harnessUsage({ refresh = false } = {}) {
    return this.request(`/api/providers/usage${refresh ? "?refresh=1" : ""}`);
  }
  providerExample() {
    return this.request("/api/providers/example");
  }
  reloadProviders() {
    return this.post("/api/providers/reload", {});
  }
  saveProviderConnection(connection, id) {
    return id
      ? this.put(`/api/providers/connections/${encoded(id)}`, connection)
      : this.post("/api/providers/connections", connection);
  }
  removeProviderConnection(id) {
    return this.request(`/api/providers/connections/${encoded(id)}`, {
      method: "DELETE",
    });
  }
  testProviderConnection(id) {
    return this.post(`/api/providers/connections/${encoded(id)}/test`, {});
  }
  localModels(runtime) {
    return this.request(
      `/api/local-models${runtime ? `/${encoded(runtime)}` : ""}`,
    );
  }
  configureLocalRuntime(runtime, config) {
    return this.put(`/api/local-models/${encoded(runtime)}`, config);
  }
  localModelAction(runtime, action, input = {}) {
    if (!["setup", "start", "stop", "pull", "cancel"].includes(action))
      throw new FlowError("Choose setup, start, stop, pull or cancel.", 400);
    return this.post(`/api/local-models/${encoded(runtime)}/${action}`, input);
  }
  localProfiles() {
    return this.request("/api/local-models/comfyui/profiles");
  }
  installLocalModel(presetId) {
    return this.post(
      `/api/local-models/comfyui/presets/${encoded(presetId)}/install`,
      {},
    );
  }
  saveLocalProfile(profile) {
    return this.post("/api/local-models/comfyui/profiles", profile);
  }
  createLocalCheckpointProfile(recipe) {
    return this.post("/api/local-models/comfyui/checkpoint-profile", recipe);
  }
  validateLocalProfile(id) {
    return this.post(
      `/api/local-models/comfyui/profiles/${encoded(id)}/validate`,
      {},
    );
  }
  removeLocalProfile(id) {
    return this.request(`/api/local-models/comfyui/profiles/${encoded(id)}`, {
      method: "DELETE",
    });
  }
  falConnection() {
    return this.request("/api/providers/fal");
  }
  configureFal(connection) {
    return this.put("/api/providers/fal", connection);
  }
  grokConnection() {
    return this.request("/api/providers/grok");
  }
  configureGrok(connection) {
    return this.put("/api/providers/grok", connection);
  }
  geminiVideoConnection() {
    return this.request("/api/providers/gemini-video");
  }
  configureGeminiVideo(connection) {
    return this.put("/api/providers/gemini-video", connection);
  }
  assets({ url, runId, jobId, workflowId } = {}) {
    const query = new URLSearchParams();
    if (this.projectId) query.set("projectId", this.projectId);
    if (url) query.set("url", url);
    if (runId) query.set("runId", runId);
    if (jobId) query.set("jobId", jobId);
    if (workflowId) query.set("workflowId", workflowId);
    return this.request(`/api/assets${query.size ? `?${query}` : ""}`);
  }
  asset(id) {
    return this.request(this.scoped(`/api/assets/${encoded(id)}`));
  }
  assetLineage(id) {
    return this.request(this.scoped(`/api/assets/${encoded(id)}/lineage`));
  }
  annotateAsset(id, changes) {
    return this.request(this.scoped(`/api/assets/${encoded(id)}/annotations`), {
      method: "PATCH",
      body: JSON.stringify({ ...changes, projectId: this.projectId }),
    });
  }
  datasetTarget({ mode = "all", runId, workflowId } = {}) {
    if (!["all", "training"].includes(mode))
      throw new Error("Choose dataset mode all or training.");
    const query = new URLSearchParams({ mode });
    if (this.projectId) query.set("projectId", this.projectId);
    if (runId) query.set("runId", runId);
    if (workflowId) query.set("workflowId", workflowId);
    return {
      url: `${this.url}/api/assets/dataset?${query}`,
      format: "application/x-ndjson",
      schemaVersion: 1,
    };
  }
  async exportDataset(options = {}) {
    const { url } = this.datasetTarget(options);
    const response = await this.response(url.slice(this.url.length));
    const jsonl = await response.text();
    return {
      jsonl,
      total: Number(response.headers.get("X-Flow-Dataset-Total") || 0),
      skipped: Number(response.headers.get("X-Flow-Dataset-Skipped") || 0),
      skipReasons: JSON.parse(
        response.headers.get("X-Flow-Dataset-Skip-Reasons") || "{}",
      ),
    };
  }
  gallery() {
    return this.request(this.scoped("/api/gallery"));
  }
  async workflowResults(id) {
    const graph = await this.workflow(id);
    if (this.projectId && graph.projectId !== this.projectId)
      throw new FlowError(
        `Workflow ${id} does not belong to project ${this.projectId}.`,
        409,
      );
    return this.request(this.scoped(`/api/workflows/${encoded(id)}/results`));
  }
  async manifest(id) {
    // The manifest is the complete recorded run, including exact inputs.
    return this.inspect(id);
  }
  async downloadTarget(id) {
    await this.inspect(id);
    return {
      runId: id,
      url: `${this.url}${this.scoped(`/api/runs/${encoded(id)}/download`)}`,
    };
  }
  async searchImages(
    { query, scope, workflowId, runId, providerId, limit } = {},
    { signal } = {},
  ) {
    const projectScope = this.projectId
      ? `project:${this.projectId}`
      : undefined;
    if (projectScope && scope !== undefined && scope !== projectScope)
      throw new FlowError(
        `Search belongs to project ${this.projectId}. Use workflowId to narrow that project; another scope would replace its ownership restriction.`,
        409,
      );
    return this.request("/api/gallery/search", {
      method: "POST",
      signal,
      body: JSON.stringify({
        query,
        scope: projectScope || scope || "all",
        workflowId,
        runId,
        providerId,
        limit,
      }),
    });
  }
  searchStatus() {
    return this.request("/api/search/status");
  }
  searchRetry() {
    return this.post("/api/search/retry", {});
  }
  upload(files) {
    const form = new FormData();
    if (this.projectId) form.append("projectId", this.projectId);
    for (const { name, data, type } of files)
      form.append(
        "images",
        data instanceof Blob ? data : new Blob([data], { type }),
        name,
      );
    return this.request("/api/uploads", { method: "POST", body: form });
  }
  async download(id) {
    if (this.projectId) await this.inspect(id);
    return new Uint8Array(
      await (
        await this.response(this.scoped(`/api/runs/${encoded(id)}/download`))
      ).arrayBuffer(),
    );
  }
  async wait(id, { timeout = 3600, interval = 500, onProgress, signal } = {}) {
    if (!id) throw new Error("Provide a run ID.");
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new Error("Timeout must be a positive number of seconds.");
    if (!Number.isFinite(interval) || interval <= 0)
      throw new FlowError(
        "Poll interval must be a positive number of milliseconds.",
        400,
        "INVALID_ARGUMENT",
      );
    const deadline = Date.now() + Math.ceil(timeout * 1000);
    let lastRun;
    const timedOut = () =>
      Object.assign(
        new FlowError(
          `Timed out waiting for run ${id}. It continues on the server; inspect or wait again.`,
          408,
          "RUN_WAIT_TIMEOUT",
        ),
        { runId: id, timeoutSeconds: timeout, lastRun },
      );
    const controller = new AbortController();
    const waitSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    // Re-arm long waits because platform timers take a signed 32-bit delay.
    let timer;
    const armDeadline = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) controller.abort(timedOut());
      else timer = setTimeout(armDeadline, Math.min(remaining, 2 ** 31 - 1));
    };
    armDeadline();
    try {
      for (;;) {
        waitSignal.throwIfAborted();
        const run = await this.inspect(id, { signal: waitSignal });
        if (Date.now() >= deadline) throw timedOut();
        lastRun = run;
        onProgress?.(run);
        if (!["running", "paused"].includes(run.status)) return run;
        await new Promise((resolve, reject) => {
          const abort = () => {
            clearTimeout(poll);
            reject(waitSignal.reason);
          };
          const poll = setTimeout(
            () => {
              waitSignal.removeEventListener("abort", abort);
              resolve();
            },
            Math.min(interval, 2 ** 31 - 1),
          );
          waitSignal.addEventListener("abort", abort, { once: true });
          if (waitSignal.aborted) abort();
        });
      }
    } catch (error) {
      // Response body readers may wrap the caller's abort reason.
      waitSignal.throwIfAborted();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
export { createImageWorkflow, createVideoWorkflow } from "./workflows.mjs";
export {
  toFlowFile,
  fromFlowFile,
  flowFileName,
} from "../shared/flow-file.mjs";
