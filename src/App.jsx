import { RunFailure } from "./components/RunFailure.jsx";
import { WorkspaceNotch } from "./components/WorkspaceNotch.jsx";
import { falDefaults, falModel } from "../shared/fal.mjs";
import { GenerationModes } from "./nodes/GenerationModes.jsx";
import { MediaPreview } from "./media/MediaPreview.jsx";
import { generationKind, mediaKind } from "../shared/media.mjs";
import { VideoGenerationControls } from "./nodes/VideoGenerateNode.jsx";
import { Autocomplete } from "./components/Autocomplete.jsx";
import {
  workflowActivity,
  workflowRunToRestore,
} from "../shared/run-state.mjs";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ReactFlow,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStore,
  SelectionMode,
} from "@xyflow/react";
import {
  Plus,
  Image as ImageIcon,
  Type,
  Sparkles,
  Layers,
  Grid2X2,
  Settings2,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowRight,
  CheckCheck,
  Play,
  Pause,
  Square,
  Terminal,
  Command,
  Search,
  X,
  Upload,
  Download,
  FolderOpen,
  MousePointer2,
  Hand,
  Undo2,
  Redo2,
  Maximize,
  Minus,
  Copy,
  Trash2,
  RotateCcw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Workflow,
  SlidersHorizontal,
  HelpCircle,
  Link2,
  RefreshCw,
  Shuffle,
  FileJson,
  FileInput,
  Palette,
  Network,
} from "lucide-react";

import {
  ProviderPicker,
  modelsFor,
  nodeForProvider,
} from "./panels/ProviderPicker.jsx";
import { copySubgraph, cloneSubgraph } from "./canvas/graph-operations.mjs";
import { WorkflowSaver } from "./canvas/workflow-saver.mjs";
import { recordFields, recordTitle } from "../shared/inspection.mjs";
import { NodeInterface, NodeExplanation } from "./panels/NodeInterface.jsx";
import { PromptSetEditor } from "./panels/PromptSetEditor.jsx";
import { defaultPromptTemplate } from "../shared/prompt-sets.mjs";
import { overlayJobResults } from "../shared/job-results.mjs";
import { ImageEditor } from "./image-editor/ImageEditor.jsx";
import { AgentDock } from "./agent/AgentDock.jsx";
import { HarnessUsage } from "./harnesses/HarnessUsage.jsx";
import { HarnessLogo, UsageBadge } from "./harnesses/HarnessLogo.jsx";
import { useHarnessUsage } from "./harnesses/useHarnessUsage.mjs";
import { SettingsPage } from "./settings/SettingsPage.jsx";
import { ImageTray } from "./panels/ImageTray.jsx";
import { StyleGallery } from "./styles/StyleGallery.jsx";
import { validateGraph, outputType, inputTypes } from "../shared/graph.mjs";

import { StudioContext } from "./studio/context.jsx";
import { subscribeWorkspaceEvents } from "./studio/workspace-events.mjs";
import { jsonRequest, download, cls } from "./studio/ui.mjs";
import {
  toFlowFile,
  fromFlowFile,
  flowFileName,
} from "../shared/flow-file.mjs";
import {
  accents,
  icons,
  nodeNames,
  nodeDescriptions,
} from "./nodes/catalog.mjs";
import { nodeTypes } from "./nodes/index.mjs";
import { edgeTypes } from "./canvas/FlowEdge.jsx";
import { graphForSave } from "./canvas/graph-state.mjs";
import { organizeGraph } from "../shared/graph-layout.mjs";
import { collectCanvasGeometry } from "./canvas/layout-geometry.mjs";

import { IconButton } from "./components/IconButton.jsx";
import { Tooltip } from "./components/Tooltip.jsx";
import {
  changeWorkspacePanel,
  inspectorPanels,
  workspacePanelVisibility,
} from "./studio/workspace-panels.mjs";
import { Logo } from "./components/Logo.jsx";
import { RunStatus } from "./components/RunStatus.jsx";
import { WorkflowMenu } from "./projects/WorkflowMenu.jsx";
import { ProjectsPage } from "./projects/ProjectsPage.jsx";
import { ProjectFilter, matchesProject } from "./projects/ProjectFilter.jsx";
import { assignWorkflowProject } from "./projects/assign-workflow.mjs";
import { AgentAccess } from "./panels/AgentAccess.jsx";
import { useGallerySearch } from "./gallery/useGallerySearch.mjs";
import { promptGuide } from "../shared/prompt-guide.mjs";
import { resolveViewerTarget } from "./canvas/viewer-target.mjs";
import { PromptGuide } from "./panels/PromptGuide.jsx";
import { RecordInputs } from "./panels/RecordInputs.jsx";
import { canvasIdentity, canvasShortcut } from "./canvas/shortcuts.mjs";
import { RuleTemplates } from "./panels/RuleTemplates.jsx";
import {
  inheritedRules,
  mergeRules,
  ruleNodeTypes,
} from "../shared/rule-templates.mjs";
import { navigateViewer, viewerParams } from "./studio/navigation.mjs";
import "./prompt-guide.css";

function organizationFingerprint(current) {
  const graph = graphForSave(current.workflow, current.nodes, current.edges);
  return JSON.stringify({
    nodes: graph.nodes,
    edges: graph.edges,
  });
}

function geometryFingerprint(geometry) {
  return JSON.stringify(
    Object.entries(geometry)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => [
        id,
        value.width,
        value.height,
        [...(value.ports || [])].sort((left, right) =>
          `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
        ),
      ]),
  );
}

export default function App() {
  const harnessUsage = useHarnessUsage();
  const ruleSectionRef = useRef(null);
  const [leftMenu, setLeftMenu] = useState(() => {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem("flow:left-menu"));
    } catch {
      /* Use the default layout when storage is unavailable. */
    }
    return {
      collapsed: saved?.collapsed === true,
      library:
        typeof saved?.library === "boolean"
          ? saved.library
          : window.innerWidth > 1080,
      width: Number.isFinite(saved?.width)
        ? Math.max(188, Math.min(360, saved.width))
        : 250,
    };
  });
  const [activeWorkspacePanel, setActiveWorkspacePanel] = useState(() =>
    leftMenu.library && !leftMenu.collapsed ? "library" : null,
  );
  const { library, flowMenu, panel } =
    workspacePanelVisibility(activeWorkspacePanel);
  const libraryResize = useRef(null);
  useEffect(() => {
    try {
      localStorage.setItem(
        "flow:left-menu",
        JSON.stringify({ ...leftMenu, library }),
      );
    } catch {
      /* The layout still works without persistence. */
    }
  }, [leftMenu, library]);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [promptItem, setPromptItem] = useState(null);
  const [workflow, setWorkflow] = useState(null),
    [workflows, setWorkflows] = useState([]),
    [projects, setProjects] = useState([]),
    [runs, setRuns] = useState([]),
    [activeRun, setActiveRun] = useState(null),
    [jobs, setJobs] = useState([]),
    [nodeResults, setNodeResults] = useState({ workflowId: null, jobs: [] }),
    [resultsRevision, setResultsRevision] = useState(0),
    [health, setHealth] = useState(null),
    [providers, setProviders] = useState([]),
    [plan, setPlan] = useState(null),
    [planError, setPlanError] = useState("");
  const [projectContextId, setProjectContextId] = useState(() =>
    viewerParams(window.location).get("project"),
  );
  const [styleProjectId, setStyleProjectId] = useState(() =>
    viewerParams(window.location).get("project"),
  );
  const [view, setView] = useState("projects"),
    [settingsSection, setSettingsSection] = useState("workspace"),
    [panelContent, setPanelContent] = useState("runs"),
    [viewingRun, setViewingRun] = useState(null),
    [viewerError, setViewerError] = useState(null),
    [selection, setSelection] = useState(null),
    [modal, setModalState] = useState(null),
    [providerTarget, setProviderTarget] = useState(null),
    [nodeSearch, setNodeSearch] = useState(""),
    [inspectedImage, setInspectedImage] = useState(null),
    [editingImage, setEditingImage] = useState(null),
    [agentHost, setAgentHost] = useState(null),
    [agentStream, setAgentStream] = useState(null),
    [applyingAgent, setApplyingAgent] = useState(false),
    [editorAgentContext, setEditorAgentContext] = useState(null),
    [styleAgentContext, setStyleAgentContext] = useState(null),
    [toast, setToast] = useState(null),
    [runFailure, setRunFailure] = useState(null),
    [saveState, setSaveState] = useState("saved"),
    [menu, setMenuState] = useState(null),
    [query, setQuery] = useState(""),
    [pan, setPan] = useState(false),
    [concurrency, setConcurrency] = useState(4),
    [starting, setStarting] = useState(false),
    [organizing, setOrganizing] = useState(null),
    [gallery, setGallery] = useState([]),
    [galleryQuery, setGalleryQuery] = useState(""),
    [galleryRun, setGalleryRun] = useState("all"),
    [galleryProject, setGalleryProject] = useState("all"),
    [historyProject, setHistoryProject] = useState("all"),
    [galleryProvider, setGalleryProvider] = useState("all"),
    [undoCount, setUndoCount] = useState(0),
    [redoCount, setRedoCount] = useState(0);
  const setLibrary = useCallback((value) => {
    if (value !== false) setMenuState(null);
    setActiveWorkspacePanel((current) =>
      changeWorkspacePanel(current, "library", value),
    );
  }, []);
  const setFlowMenu = useCallback((value) => {
    if (value !== false) setMenuState(null);
    setActiveWorkspacePanel((current) =>
      changeWorkspacePanel(current, "workflows", value),
    );
  }, []);
  const setPanel = useCallback((next) => {
    if (next) {
      setPanelContent(next);
      setMenuState(null);
    }
    setActiveWorkspacePanel(
      (current) => next || (inspectorPanels.includes(current) ? null : current),
    );
  }, []);
  const setModal = useCallback((next) => {
    if (next) {
      setActiveWorkspacePanel(null);
      setMenuState(null);
    }
    setModalState(next);
  }, []);
  const setMenu = useCallback((next) => {
    if (next) {
      setActiveWorkspacePanel(null);
      setModalState(null);
    }
    setMenuState(next);
  }, []);
  const navigateView = (next) => {
    setActiveWorkspacePanel(null);
    setMenu(null);
    const page = next === "canvas" && !workflow ? "projects" : next;
    if (view === "projects" && ["gallery", "styles"].includes(page)) {
      saveCurrentWorkflow().catch(() => {});
      setWorkflow(null);
      setNodes([]);
      setEdges([]);
      setViewingRun(null);
      setSelection(null);
      navigateViewer({
        project: projectContextId,
        view: page,
        gallery: page === "gallery",
      });
      setView(page);
      return;
    }
    navigateViewer(
      page === "projects"
        ? { view: page, project: projectContextId }
        : {
            workflow: workflow?.id,
            project: workflow?.projectId || styleProjectId,
            run: viewingRun?.id,
            view: page,
            gallery: page === "gallery",
            node: selection,
          },
    );
    setView(page);
  };
  const openSettings = async (section = "workspace") => {
    try {
      await saveCurrentWorkflow();
      setActiveWorkspacePanel(null);
      setModal(null);
      setMenu(null);
      setInspectedImage(null);
      setEditingImage(null);
      setSettingsSection(section);
      navigateViewer({ view: "settings", section });
      setView("settings");
    } catch (error) {
      notify(error.message, "error");
    }
  };
  const updateConcurrency = (value) => {
    setConcurrency(value);
    try {
      localStorage.setItem("flow:parallel-jobs", String(value));
    } catch {}
  };
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const history = useRef([]),
    future = useRef([]),
    state = useRef({}),
    initialized = useRef(false),
    workflowSaver = useRef(null),
    viewportTimer = useRef(null),
    runRequest = useRef(0),
    pendingRun = useRef(false),
    navigationRequest = useRef(0),
    organizationRequest = useRef(0),
    fileInput = useRef(null),
    importInput = useRef(null),
    uploadTarget = useRef(null),
    toastTimer = useRef(null),
    initialViewerParams = useRef(viewerParams(window.location)),
    routeReady = useRef(false),
    restoringRoute = useRef(false);
  state.current = {
    editingImage,
    applyingAgent,
    nodes,
    edges,
    workflow,
    activeRun,
    viewingRun,
    selection,
    view,
    concurrency,
    runs,
    modal,
    flowMenu,
    leftMenu,
    activeWorkspacePanel,
    projectContextId,
    styleProjectId,
  };
  const notify = useCallback((message, type = "success") => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  if (!workflowSaver.current)
    workflowSaver.current = new WorkflowSaver({
      save: (graph) =>
        jsonRequest("/api/workflows/" + graph.id, {
          method: "PUT",
          body: JSON.stringify(graph),
        }),
      onState: ({ id, graph, status, error }) => {
        setWorkflows((gs) => gs.map((g) => (g.id === id ? graph : g)));
        if (state.current.workflow?.id === id) {
          setSaveState(status);
          if (Number.isInteger(graph?.revision))
            setWorkflow((old) =>
              old?.id === id && old.revision !== graph.revision
                ? { ...old, revision: graph.revision }
                : old,
            );
        }
        if (error)
          notify(`Could not save “${graph.name}”: ${error.message}`, "error");
      },
    });
  const saveCurrentWorkflow = useCallback(() => {
    const current = state.current;
    if (!current.workflow || current.viewingRun) return Promise.resolve();
    workflowSaver.current.stage(
      graphForSave(
        current.workflow,
        current.nodes,
        current.edges,
        flow.getViewport(),
      ),
    );
    return workflowSaver.current.flush(current.workflow.id);
  }, [flow]);
  const checkpoint = useCallback(() => {
    const { nodes, edges } = state.current;
    history.current = [
      ...history.current.slice(-59),
      structuredClone({ nodes, edges }),
    ];
    future.current = [];
    setUndoCount(history.current.length);
    setRedoCount(0);
  }, []);
  const undo = useCallback(() => {
    if (state.current.viewingRun) return;
    if (!history.current.length) return;
    future.current.push(
      structuredClone({
        nodes: state.current.nodes,
        edges: state.current.edges,
      }),
    );
    const next = history.current.pop();
    setNodes(next.nodes);
    setEdges(next.edges);
    setUndoCount(history.current.length);
    setRedoCount(future.current.length);
  }, []);
  const redo = useCallback(() => {
    if (state.current.viewingRun) return;
    if (!future.current.length) return;
    history.current.push(
      structuredClone({
        nodes: state.current.nodes,
        edges: state.current.edges,
      }),
    );
    const next = future.current.pop();
    setNodes(next.nodes);
    setEdges(next.edges);
    setUndoCount(history.current.length);
    setRedoCount(future.current.length);
  }, []);
  const editNode = useCallback((id, data) => {
    if (state.current.viewingRun) return;
    checkpoint();
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
    );
  }, []);
  const fit = useCallback(
    () =>
      flow.fitView({
        padding: 0.15,
        minZoom: 0.1,
        maxZoom: 0.85,
        duration: 450,
      }),
    [flow],
  );
  const organizeCanvas = useCallback(async () => {
    const current = state.current;
    if (!current.workflow || current.viewingRun || !current.nodes.length)
      return;
    const request = ++organizationRequest.current;
    const navigation = navigationRequest.current;
    const workflowId = current.workflow.id;
    const fingerprint = organizationFingerprint(current);
    const geometry = collectCanvasGeometry(flow, current.nodes);
    const dimensions = geometryFingerprint(geometry);
    setOrganizing(workflowId);
    try {
      const { graph, diagnostics } = await organizeGraph(
        graphForSave(current.workflow, current.nodes, current.edges),
        { geometry },
      );
      const latest = state.current;
      if (
        request !== organizationRequest.current ||
        navigation !== navigationRequest.current ||
        latest.workflow?.id !== workflowId ||
        latest.viewingRun ||
        latest.view !== "canvas"
      )
        return;
      if (
        organizationFingerprint(latest) !== fingerprint ||
        geometryFingerprint(collectCanvasGeometry(flow, latest.nodes)) !==
          dimensions
      ) {
        notify(
          "The canvas changed while organizing. Click Organize again.",
          "error",
        );
        return;
      }
      checkpoint();
      const arranged = new Map(graph.nodes.map((node) => [node.id, node]));
      setNodes((previous) =>
        previous.map((node) => {
          const result = arranged.get(node.id);
          return result
            ? { ...node, position: result.position, data: result.data }
            : node;
        }),
      );
      const warning = diagnostics.warnings[0];
      notify(
        warning
          ? `Canvas organized. ${warning}`
          : "Canvas organized · Undo to restore the previous layout",
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (
            navigation === navigationRequest.current &&
            state.current.workflow?.id === workflowId &&
            state.current.view === "canvas"
          )
            flow.fitView({
              padding: 0.15,
              minZoom: 0.1,
              maxZoom: 0.85,
              duration: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? 0
                : 450,
            });
        }),
      );
    } catch (error) {
      if (
        request === organizationRequest.current &&
        state.current.workflow?.id === workflowId
      )
        notify(`Could not organize the canvas: ${error.message}`, "error");
    } finally {
      if (request === organizationRequest.current) setOrganizing(null);
    }
  }, [flow, checkpoint, notify]);
  const fetchRun = useCallback(
    async (id, workflowId = state.current.workflow?.id) => {
      const requestId = ++runRequest.current;
      try {
        const r = await jsonRequest("/api/runs/" + id);
        if (
          requestId !== runRequest.current ||
          state.current.workflow?.id !== workflowId
        )
          return;
        setActiveRun(r);
        setJobs(r.jobs);
      } catch (e) {
        if (requestId === runRequest.current) notify(e.message, "error");
      }
    },
    [],
  );
  const loadWorkflow = useCallback(
    (g, availableRuns = state.current.runs, target = {}) => {
      if (state.current.workflow && state.current.workflow.id !== g.id)
        saveCurrentWorkflow().catch(() => {});
      if (!target.run)
        g = workflowSaver.current.seed(g, { fresh: target.fresh });
      ++navigationRequest.current;
      ++organizationRequest.current;
      setOrganizing(null);
      setRunFailure(null);
      setViewingRun(target.run || null);
      setViewerError(null);
      setView(target.styles ? "styles" : target.gallery ? "gallery" : "canvas");
      ++runRequest.current;
      clearTimeout(viewportTimer.current);
      initialized.current = false;
      setWorkflow(g);
      navigateViewer(
        {
          workflow: g.id,
          project: g.projectId,
          node: target.nodeId,
          run: target.run?.id,
          gallery: target.gallery,
          view: target.styles ? "styles" : "canvas",
        },
        { replace: target.history === "replace" },
      );
      localStorage.setItem("flow:last-workflow", g.id);
      setNodes(
        g.nodes.map((node) => ({
          ...node,
          selected: target.styles && node.id === target.nodeId,
        })),
      );
      setEdges(g.edges.map((e) => ({ ...e, type: "flow" })));
      setSelection(target.styles ? target.nodeId || null : null);
      setPanel(null);
      setInspectedImage(null);
      setMenu(null);
      setModal(null);
      setPlan(null);
      setPlanError("");
      history.current = [];
      future.current = [];
      setUndoCount(0);
      setRedoCount(0);
      setSaveState(workflowSaver.current.status(g.id));
      setFlowMenu(false);
      setActiveRun(null);
      setJobs([]);
      setNodeResults({ workflowId: g.id, jobs: [] });
      const latest = workflowRunToRestore(availableRuns || [], g.id);
      if (target.run) {
        setActiveRun(target.run);
        setJobs(target.run.jobs);
      } else if (latest) fetchRun(latest.id, g.id);
      viewportTimer.current = setTimeout(() => {
        if (!target.styles) {
          if (g.viewport) flow.setViewport(g.viewport, { duration: 250 });
          else fit();
        }
        initialized.current = true;
        if (target.nodeId && !target.gallery && !target.styles)
          viewportTimer.current = setTimeout(
            () => inspectNode(target.nodeId),
            300,
          );
      }, 180);
    },
    [flow, fit, fetchRun, saveCurrentWorkflow],
  );
  useEffect(() => {
    setGalleryProject(
      workflow?.id
        ? `workflow:${workflow.id}`
        : projectContextId
          ? `project:${projectContextId}`
          : "all",
    );
    setHistoryProject(
      workflow?.id
        ? `workflow:${workflow.id}`
        : projectContextId
          ? `project:${projectContextId}`
          : "all",
    );
    setGalleryRun(viewingRun?.id || "all");
  }, [workflow?.id, workflow?.projectId, viewingRun?.id, projectContextId]);
  const refreshGallery = useCallback(async () => {
    try {
      setGallery(await jsonRequest("/api/gallery"));
    } catch (e) {
      notify(e.message, "error");
    }
  }, []);
  useEffect(() => {
    jsonRequest("/api/bootstrap")
      .then(async (data) => {
        setWorkflows(data.workflows);
        setProjects(data.projects || []);
        setRuns(data.runs);
        let savedParallel;
        try {
          savedParallel = Number(localStorage.getItem("flow:parallel-jobs"));
        } catch {}
        setConcurrency(
          [1, 2, 4, 8, 16, 32, 64, 128].includes(savedParallel)
            ? savedParallel
            : data.concurrency,
        );
        setProviders(data.providers || []);
        const target = await resolveViewerTarget(initialViewerParams.current, {
          workflows: data.workflows,
          projects: data.projects || [],
          fetchRun: (id) => jsonRequest(`/api/runs/${encodeURIComponent(id)}`),
        });
        routeReady.current = true;
        if (target?.settings) {
          setView("settings");
          setSettingsSection(target.section);
          setLibrary(false);
          return;
        }
        if (!target || target.projects) {
          setView("projects");
          setLibrary(false);
          return;
        }
        if (
          (target?.styles || target?.gallery) &&
          !["workflow", "run", "node"].some((key) =>
            initialViewerParams.current.has(key),
          )
        ) {
          setView(target.styles ? "styles" : "gallery");
          setLibrary(false);
          return;
        }
        const choices = target?.projectId
          ? data.workflows.filter((g) => g.projectId === target.projectId)
          : data.workflows;
        const initial =
          target?.workflow ||
          choices.find(
            (g) => g.id === localStorage.getItem("flow:last-workflow"),
          ) ||
          choices[0];
        if (initial)
          loadWorkflow(initial, data.runs, { ...target, history: "replace" });
        else if (target?.gallery) setView("gallery");
        if (!initial && target?.styles) {
          setView("styles");
          setPanel(null);
          setLibrary(false);
        }
      })
      .catch((e) => {
        setViewerError(e.message);
        setView("projects");
        setLibrary(false);
        notify("Could not open the viewer: " + e.message, "error");
      });
    const editorId = initialViewerParams.current.get("editor");
    if (editorId) setEditingImage({ editorId });
    jsonRequest("/api/health")
      .then(setHealth)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const streamQuery = new URLSearchParams();
    if (agentStream) {
      streamQuery.set("sessionId", agentStream.sessionId);
      if (agentStream.projectId)
        streamQuery.set("projectId", agentStream.projectId);
    }
    return subscribeWorkspaceEvents(`/api/events?${streamQuery}`, {
      onConnection: (connected) =>
        window.dispatchEvent(
          new CustomEvent("flow:agent-connection", { detail: connected }),
        ),
      onMessage: (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "agent") {
          window.dispatchEvent(
            new CustomEvent("flow:agent-session", { detail: data.session }),
          );
          return;
        }
        if (
          data.type === "run" &&
          data.run.workflowId === state.current.workflow?.id &&
          (data.run.id !== state.current.activeRun?.id ||
            ["completed", "failed", "cancelled"].includes(data.run.status))
        )
          setResultsRevision((r) => r + 1);
        if (data.type === "run") {
          setRuns((rs) =>
            [data.run, ...rs.filter((r) => r.id !== data.run.id)].sort((a, b) =>
              b.createdAt.localeCompare(a.createdAt),
            ),
          );
          if (state.current.activeRun?.id === data.run.id) {
            setActiveRun((r) => ({ ...r, ...data.run }));
            if (["completed", "failed"].includes(data.run.status))
              refreshGallery();
          }
        } else if (
          data.type === "job" &&
          state.current.activeRun?.id === data.runId
        )
          setJobs((js) => js.map((j) => (j.id === data.job.id ? data.job : j)));
        else if (data.type === "error") notify(data.message, "error");
        else if (
          data.type === "progress" &&
          state.current.activeRun?.id === data.runId
        )
          setJobs((js) =>
            js.map((j) =>
              j.id === data.jobId ? { ...j, message: data.message } : j,
            ),
          );
      },
      onOpen: () => {
        Promise.all([
          jsonRequest("/api/runs"),
          jsonRequest("/api/workflows"),
          jsonRequest("/api/projects"),
        ])
          .then(([runs, workflows, projects]) => {
            setRuns(runs);
            setWorkflows(workflows);
            setProjects(projects);
            const current = state.current;
            const restored =
              current.viewingRun ||
              workflowRunToRestore(runs, current.workflow?.id);
            if (restored) fetchRun(restored.id, current.workflow?.id);
          })
          .catch(() => {});
      },
    });
  }, [agentStream]);
  useEffect(() => {
    if (!workflow || viewingRun) return;
    const restored = workflowRunToRestore(runs, workflow.id);
    if (
      restored &&
      restored.id !== activeRun?.id &&
      (!activeRun || ["running", "paused"].includes(restored.status))
    )
      fetchRun(restored.id, workflow.id);
  }, [runs, workflow?.id, viewingRun?.id, activeRun?.id, fetchRun]);
  useEffect(() => {
    if (!workflow?.id || viewingRun) return;
    const id = workflow.id,
      controller = new AbortController();
    const timer = setTimeout(
      () =>
        jsonRequest(`/api/workflows/${id}/results`, {
          signal: controller.signal,
        })
          .then((jobs) => {
            if (!controller.signal.aborted && state.current.workflow?.id === id)
              setNodeResults({ workflowId: id, jobs });
          })
          .catch((e) => {
            if (!controller.signal.aborted) notify(e.message, "error");
          }),
      120,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [workflow?.id, resultsRevision, viewingRun]);
  useEffect(() => {
    if (!workflow || viewingRun) return;
    const graph = graphForSave(workflow, nodes, edges);
    workflowSaver.current.stage(graph);
  }, [nodes, edges, workflow, viewingRun]);
  useEffect(() => {
    if (!workflow) return;
    const graph = graphForSave(workflow, nodes, edges);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const p = await jsonRequest("/api/plan", {
          method: "POST",
          body: JSON.stringify({ workflow: graph }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setPlan(p);
        setPlanError("");
      } catch (e) {
        if (controller.signal.aborted) return;
        setPlan(null);
        setPlanError(e.message);
      }
    }, 650);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [nodes, edges, workflow]);
  useEffect(() => {
    const leaving = (event) => {
      workflowSaver.current.flushAll();
      if (!workflowSaver.current.hasPending()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const hidden = () => {
      if (document.visibilityState === "hidden")
        workflowSaver.current.flushAll();
    };
    window.addEventListener("beforeunload", leaving);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      document.removeEventListener("visibilitychange", hidden);
      clearTimeout(viewportTimer.current);
    };
  }, []);
  useEffect(() => {
    if (view === "gallery") refreshGallery();
  }, [view]);
  useEffect(() => {
    if (!flowMenu) return;
    const dismiss = (event) => {
      if (
        event.target.closest(
          ".workflow-menu, [data-workflow-menu-trigger], .autocomplete-popup",
        )
      )
        return;
      setFlowMenu(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [flowMenu]);
  useEffect(() => {
    if (!flowMenu) return;
    const controller = new AbortController();
    Promise.all([
      jsonRequest("/api/workflows", { signal: controller.signal }),
      jsonRequest("/api/projects", { signal: controller.signal }),
    ])
      .then(([saved, registered]) => {
        if (controller.signal.aborted) return;
        setWorkflows(saved);
        setProjects(registered);
      })
      .catch((error) => {
        if (!controller.signal.aborted) notify(error.message, "error");
      });
    return () => controller.abort();
  }, [flowMenu]);
  useEffect(() => {
    if (!routeReady.current || restoringRoute.current) return;
    const target =
      view === "settings"
        ? { view: "settings", section: settingsSection }
        : view === "projects"
          ? { view: "projects", project: projectContextId }
          : {
              workflow: workflow?.id,
              project:
                workflow?.projectId ||
                (view === "styles"
                  ? styleProjectId
                  : view === "gallery"
                    ? projectContextId
                    : undefined),
              run: viewingRun?.id,
              view,
              gallery: view === "gallery",
              node: selection,
            };
    if (editingImage?.editorId) target.editor = editingImage.editorId;
    else if (viewerParams(window.location).has("editor") && editingImage)
      target.editor = viewerParams(window.location).get("editor");
    navigateViewer(target, { replace: true });
  }, [
    view,
    settingsSection,
    workflow?.id,
    workflow?.projectId,
    selection,
    styleProjectId,
    projectContextId,
    viewingRun?.id,
    editingImage,
  ]);
  useEffect(() => {
    const restore = async () => {
      restoringRoute.current = true;
      const params = viewerParams(window.location);
      const token = ++navigationRequest.current;
      try {
        await saveCurrentWorkflow();
        const [graphs, registered, runList] = await Promise.all([
          jsonRequest("/api/workflows"),
          jsonRequest("/api/projects"),
          jsonRequest("/api/runs"),
        ]);
        const target = await resolveViewerTarget(params, {
          workflows: graphs,
          projects: registered,
          fetchRun: (id) => jsonRequest(`/api/runs/${encodeURIComponent(id)}`),
        });
        if (token !== navigationRequest.current) return;
        setWorkflows(graphs);
        setProjects(registered);
        setRuns(runList);
        setProjectContextId(target?.projectId || null);
        setStyleProjectId(target?.projectId || null);
        setEditingImage(
          params.get("editor") ? { editorId: params.get("editor") } : null,
        );
        setInspectedImage(null);
        setActiveWorkspacePanel(null);
        if (target?.settings) {
          setSettingsSection(target.section);
          setView("settings");
          return;
        }
        if (
          target?.workflow &&
          !(
            (target.styles || target.gallery) &&
            !["workflow", "run", "node"].some((key) => params.has(key))
          )
        )
          loadWorkflow(target.workflow, runList, {
            ...target,
            history: "replace",
            fresh: true,
          });
        else {
          setView(
            target?.styles
              ? "styles"
              : target?.gallery
                ? "gallery"
                : "projects",
          );
          setWorkflow(null);
          setNodes([]);
          setEdges([]);
          setViewingRun(null);
          setSelection(null);
        }
      } catch (error) {
        setViewerError(error.message);
        notify(error.message, "error");
      } finally {
        restoringRoute.current = false;
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [loadWorkflow, saveCurrentWorkflow]);
  useEffect(() => {
    const timer = setTimeout(() => view === "canvas" && fit(), 200);
    return () => clearTimeout(timer);
  }, [view]);
  const chooseProvider = useCallback((id) => {
    if (state.current.viewingRun) return;
    setProviderTarget(id);
    setModal("providers");
  }, []);
  const providerName = (id) =>
    providers.find((p) => p.id === (id || "codex"))?.name ||
    id ||
    "Codex Image";
  const reloadProviders = async () => {
    try {
      setProviders(
        await jsonRequest("/api/providers/reload", {
          method: "POST",
          body: "{}",
        }),
      );
      notify("Providers reloaded");
    } catch (error) {
      notify(error.message, "error");
    }
  };
  const connectorExample = async () => {
    try {
      download(await jsonRequest("/api/providers/example"), "providers.json");
    } catch (error) {
      notify(error.message, "error");
    }
  };
  const addNode = useCallback(
    (type, position, overrides = {}) => {
      if (state.current.viewingRun) return;
      checkpoint();
      const center = flow.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const data = {
        label: nodeNames[type],
        ...(type === "image"
          ? { images: [] }
          : type === "filter"
            ? { filterField: "role", filterValues: ["quote"] }
            : type === "section"
              ? {
                  width: 1400,
                  height: 700,
                  subtitle: "Shared inputs. A separate generation flow.",
                  tone: "neutral",
                  members: [],
                }
              : type === "prompt-set"
                ? {
                    text: defaultPromptTemplate,
                    prompts: [
                      {
                        id: crypto.randomUUID(),
                        label: "First scene",
                        scene: "Describe your first scene",
                        concept: "",
                      },
                    ],
                  }
                : type === "dataset"
                  ? {
                      records: [
                        {
                          id: "quote-1",
                          fields: {
                            quote: "Your first quote",
                            author: "Author",
                            scene: "A quiet classical scene",
                          },
                        },
                      ],
                    }
                  : type === "template"
                    ? {
                        text: "Quote: {{quote}}\nAuthor: {{author}}\nScene: {{scene}}",
                      }
                    : type === "prompt"
                      ? { text: "" }
                      : type === "prompt-generate"
                        ? {
                            text: "Write a detailed image prompt from the incoming brief. Return only the prompt.",
                            providerId: "codex-text",
                            model: "default",
                          }
                        : type === "variations"
                          ? {
                              lines:
                                "Warm amber + soft violet\nDeep blue + pale peach",
                            }
                          : type === "video-generate"
                            ? {
                                providerId: "gemini-video",
                                model: "gemini-omni-1.1-flash",
                                count: 1,
                                ratio: "16:9",
                                video: { resolution: "720p" },
                              }
                            : type === "generate"
                              ? {
                                  count: 1,
                                  seed: 42,
                                  ratio: "1:1",
                                  quality: "high",
                                }
                              : {}),
      };
      Object.assign(data, overrides);
      if (["fal-image", "fal-video"].includes(data.providerId)) {
        const detail = falModel(data.model);
        if (detail) Object.assign(data, falDefaults(detail), overrides);
      }
      if (data.providerId === "grok-image") {
        data.quality = overrides.quality || "medium";
        data.image = overrides.image || { resolution: "1k" };
      }
      if (data.providerId === "grok-video")
        data.video = overrides.video || {
          resolution: "720p",
          durationSeconds: 8,
        };
      const node = {
        selected: true,
        id: crypto.randomUUID(),
        type,
        position: position || { x: center.x - 140, y: center.y - 100 },
        data,
      };
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
      setSelection(node.id);
      setLibrary(false);
      setPanel("properties");
      const destination = canvasIdentity(state.current);
      clearTimeout(viewportTimer.current);
      viewportTimer.current = setTimeout(() => {
        if (canvasIdentity(state.current) === destination) inspectNode(node.id);
      }, 180);
      setModal(null);
      setMenu(null);
      notify(`${nodeNames[type]} added`);
    },
    [flow],
  );
  const deleteNode = useCallback((id) => {
    if (state.current.viewingRun) return;
    checkpoint();
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelection(null);
    setMenu(null);
  }, []);
  const pasteGraph = useCallback((graph) => {
    if (state.current.viewingRun) return;
    if (!graph?.nodes.length) return;
    checkpoint();
    const next = cloneSubgraph(graph);
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      ...next.nodes,
    ]);
    setEdges((es) => [
      ...es.map((e) => ({ ...e, selected: false })),
      ...next.edges,
    ]);
    setSelection(next.nodes.length === 1 ? next.nodes[0].id : null);
    setMenu(null);
  }, []);
  const duplicateNode = useCallback(
    (id) =>
      pasteGraph(copySubgraph(state.current.nodes, state.current.edges, [id])),
    [],
  );
  const selectedNodeIds = () => {
    const ids = state.current.nodes.filter((n) => n.selected).map((n) => n.id);
    return ids.length
      ? ids
      : state.current.selection
        ? [state.current.selection]
        : [];
  };
  const deleteSelection = () => {
    if (state.current.viewingRun) return;
    const ids = new Set(selectedNodeIds());
    const selectedEdges = state.current.edges.filter((e) => e.selected);
    if (!ids.size && !selectedEdges.length) return;
    checkpoint();
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((es) =>
      es.filter((e) => !ids.has(e.source) && !ids.has(e.target) && !e.selected),
    );
    setSelection(null);
    setMenu(null);
  };
  const isValidConnection = useCallback((c) => {
    if (c.source === c.target) return false;
    const source = state.current.nodes.find((n) => n.id === c.source),
      target = state.current.nodes.find((n) => n.id === c.target);
    if (!source || !target) return false;
    const out = outputType(source.type);
    if (out !== c.targetHandle || !inputTypes[target.type].includes(out))
      return false;
    const seen = new Set();
    const reaches = (id) => {
      if (id === c.source) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return state.current.edges
        .filter((e) => e.source === id)
        .some((e) => reaches(e.target));
    };
    return !reaches(c.target);
  }, []);
  const onConnect = useCallback((connection) => {
    if (state.current.viewingRun) return;
    if (!isValidConnection(connection)) {
      notify("Connect matching types without creating a loop.", "error");
      return;
    }
    checkpoint();
    setEdges((es) => addEdge({ ...connection, type: "flow" }, es));
  }, []);
  const uploadImages = useCallback((id) => {
    if (state.current.viewingRun) return;
    uploadTarget.current = id;
    fileInput.current?.click();
  }, []);
  async function handleFiles(files, target = uploadTarget.current) {
    if (!files?.length || !state.current.workflow || state.current.viewingRun)
      return;
    const canvas = canvasIdentity(state.current);
    try {
      const form = new FormData();
      [...files].forEach((f) => form.append("images", f));
      const assets = await jsonRequest("/api/uploads", {
        method: "POST",
        body: form,
      });
      if (
        canvasIdentity(state.current) !== canvas ||
        state.current.viewingRun
      ) {
        notify(
          "Images uploaded; the canvas changed before they could be attached.",
        );
        return;
      }
      checkpoint();
      if (target)
        setNodes((ns) =>
          ns.map((n) =>
            n.id === target
              ? { ...n, data: { ...n.data, images: assets.map((a) => a.url) } }
              : n,
          ),
        );
      else {
        const center = flow.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        setNodes((ns) => [
          ...ns,
          {
            id: crypto.randomUUID(),
            type: "image",
            position: center,
            data: { label: "Seed image", images: assets.map((a) => a.url) },
          },
        ]);
      }
      notify(`${assets.length} image${assets.length > 1 ? "s" : ""} imported`);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      uploadTarget.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  const runWorkflow = useCallback(async (nodeId, options = {}) => {
    if (pendingRun.current || state.current.viewingRun) return;
    const { workflow, nodes, edges, concurrency } = state.current;
    if (!workflow) return;
    pendingRun.current = true;
    const canvas = canvasIdentity(state.current);
    const requestId = ++runRequest.current;
    setStarting(true);
    setRunFailure(null);
    try {
      const graph = graphForSave(workflow, nodes, edges);
      const r = await jsonRequest("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          workflow: graph,
          options: { ...options, ...(nodeId ? { nodeId } : {}) },
          concurrency,
        }),
      });
      if (
        canvasIdentity(state.current) === canvas &&
        requestId === runRequest.current
      ) {
        setActiveRun(r);
        setJobs(r.jobs);
        setPanel("runs");
      }
      notify(`${r.jobs.length} jobs queued · ${concurrency} at a time`);
    } catch (e) {
      if (
        canvasIdentity(state.current) === canvas &&
        requestId === runRequest.current
      )
        setRunFailure({ canvas, error: e });
      else notify(e.message, "error");
    } finally {
      pendingRun.current = false;
      setStarting(false);
    }
  }, []);
  const runAction = async (id, action) => {
    const canvas = canvasIdentity(state.current);
    setRunFailure(null);
    try {
      const r = await jsonRequest(`/api/runs/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({
          projectId: runs.find((run) => run.id === id)?.projectId ?? null,
        }),
      });
      if (
        state.current.activeRun?.id === id ||
        r.workflowId === state.current.workflow?.id
      ) {
        setActiveRun(r);
        setJobs(r.jobs);
      }
      notify(
        action === "pause"
          ? "Queue paused. Active jobs will finish."
          : action === "cancel"
            ? "Run cancelled"
            : action === "retry"
              ? "Unfinished jobs queued again"
              : "Run resumed",
      );
    } catch (e) {
      if (canvasIdentity(state.current) === canvas)
        setRunFailure({ canvas, error: e });
      else notify(e.message, "error");
    }
  };
  const openSavedWorkflow = async (graph) => {
    const requestId = ++navigationRequest.current;
    try {
      const saved = await jsonRequest(
        `/api/workflows/${encodeURIComponent(graph.id)}`,
      );
      if (requestId === navigationRequest.current)
        loadWorkflow(saved, state.current.runs, { fresh: true });
    } catch (error) {
      notify(error.message, "error");
    }
  };
  const openRecordedRun = async (id, gallery = false) => {
    const requestId = ++navigationRequest.current;
    try {
      const target = await resolveViewerTarget(
        new URLSearchParams({ run: id, ...(gallery ? { gallery: "1" } : {}) }),
        {
          workflows,
          projects,
          fetchRun: (runId) =>
            jsonRequest(`/api/runs/${encodeURIComponent(runId)}`),
        },
      );
      if (requestId === navigationRequest.current)
        loadWorkflow(target.workflow, state.current.runs, target);
    } catch (error) {
      notify(error.message, "error");
    }
  };
  const newWorkflow = async (projectId = state.current.workflow?.projectId) => {
    try {
      const g = {
        id: crypto.randomUUID(),
        name: "Untitled exploration",
        projectId,
        nodes: [],
        edges: [],
      };
      await jsonRequest("/api/workflows/" + g.id, {
        method: "PUT",
        body: JSON.stringify(g),
      });
      setWorkflows((gs) => [g, ...gs]);
      loadWorkflow(g);
      setActiveRun(null);
      setJobs([]);
    } catch (error) {
      notify(error.message, "error");
    }
  };
  const forkWorkflow = async () => {
    try {
      const { workflow, nodes, edges } = state.current;
      const g = await jsonRequest(`/api/workflows/${workflow.id}/fork`, {
        method: "POST",
        body: JSON.stringify({
          workflow: graphForSave(workflow, nodes, edges, flow.getViewport()),
        }),
      });
      setWorkflows((gs) => [g, ...gs]);
      loadWorkflow(g);
      notify(`Forked from ${workflow.name}`);
    } catch (error) {
      notify(error.message, "error");
    }
  };
  async function importWorkflow(file) {
    try {
      const data = fromFlowFile(JSON.parse(await file.text()));
      data.id = crypto.randomUUID();
      const g = await jsonRequest("/api/workflows/" + data.id, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      setWorkflows((gs) => [g, ...gs]);
      loadWorkflow(g);
      notify("Workflow imported");
    } catch (e) {
      notify("Import failed: " + e.message, "error");
    }
    importInput.current.value = "";
  }
  useEffect(() => {
    const handler = (e) => {
      if (state.current.editingImage || state.current.applyingAgent) return;
      if (
        ["styles", "projects", "settings"].includes(state.current.view) &&
        !(
          e.key === "Escape" &&
          (state.current.modal || state.current.activeWorkspacePanel)
        )
      )
        return;
      const element = document.activeElement;
      const action = canvasShortcut(e, {
        editing:
          ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName) ||
          element?.isContentEditable,
        readOnly: Boolean(state.current.viewingRun),
        dialogOpen: Boolean(state.current.modal || state.current.flowMenu),
        interactiveFocus: Boolean(
          element?.closest(
            "button, a, summary, [role=button], [role=combobox]",
          ),
        ),
      });
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "escape":
          setActiveWorkspacePanel(null);
          setModal(null);
          setInspectedImage(null);
          setMenu(null);
          setSelection(null);
          setPanel(null);
          setFlowMenu(false);
          break;
        case "save":
          saveCurrentWorkflow().catch(() => {});
          break;
        case "undo":
          undo();
          break;
        case "redo":
          redo();
          break;
        case "select-all":
          setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
          setSelection(null);
          break;
        case "duplicate":
          pasteGraph(
            copySubgraph(
              state.current.nodes,
              state.current.edges,
              selectedNodeIds(),
            ),
          );
          break;
        case "add":
          setNodeSearch("");
          setModal("add");
          break;
        case "delete":
          deleteSelection();
          break;
        case "fit":
          fit();
          break;
        case "pan":
          setPan(true);
          break;
        case "run":
          runWorkflow();
          break;
      }
    };
    const up = (e) => {
      if (e.code === "Space") setPan(false);
    };
    const editing = () =>
      ["INPUT", "TEXTAREA", "SELECT"].includes(
        document.activeElement?.tagName,
      ) || document.activeElement?.isContentEditable;
    const copy = (event) => {
      if (
        editing() ||
        state.current.editingImage ||
        ["styles", "projects", "settings"].includes(state.current.view)
      )
        return;
      const graph = copySubgraph(
        state.current.nodes,
        state.current.edges,
        selectedNodeIds(),
      );
      if (!graph.nodes.length) return;
      event.clipboardData.setData(
        "text/plain",
        JSON.stringify({ type: "flow-subgraph", version: 1, graph }),
      );
      event.preventDefault();
    };
    const paste = (event) => {
      if (["styles", "projects", "settings"].includes(state.current.view))
        return;
      if (
        editing() ||
        state.current.editingImage ||
        state.current.viewingRun ||
        state.current.modal
      )
        return;
      let value;
      try {
        value = JSON.parse(event.clipboardData.getData("text/plain"));
      } catch {
        return;
      }
      if (value?.type !== "flow-subgraph") return;
      event.preventDefault();
      try {
        const { graph } = validateGraph({
          id: "clipboard",
          name: "Clipboard",
          ...value.graph,
        });
        for (const n of graph.nodes)
          for (const url of [
            ...(n.data.images || []),
            ...(n.data.preview ? [n.data.preview] : []),
          ])
            if (!url.startsWith("/assets/") && !url.startsWith("/files/"))
              throw new Error(
                "Clipboard images must reference this local workspace.",
              );
        pasteGraph(graph);
      } catch (error) {
        notify("Cannot paste that graph: " + error.message, "error");
      }
    };
    window.addEventListener("copy", copy);
    window.addEventListener("paste", paste);
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("paste", paste);
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", up);
    };
  }, [undo, redo, fit, runWorkflow, saveCurrentWorkflow]);
  const selected = nodes.find((n) => n.id === selection),
    activity = workflowActivity(runs, workflow?.id, viewingRun?.id),
    busy = activity.counts.running > 0,
    complete = jobs.filter((j) => j.status === "completed").length,
    failed = jobs.filter((j) => j.status === "failed").length;
  const outputSources = {};
  for (const node of nodes.filter((n) =>
    ["output", "video-output"].includes(n.type),
  )) {
    const sources = new Set(),
      visited = new Set();
    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const edge of edges.filter((e) => e.target === id)) {
        if (
          ["generate", "video-generate"].includes(
            nodes.find((n) => n.id === edge.source)?.type,
          )
        )
          sources.add(edge.source);
        else visit(edge.source);
      }
    };
    visit(node.id);
    outputSources[node.id] = sources;
  }
  const canvasJobs = overlayJobResults(
    nodeResults.workflowId === workflow?.id ? nodeResults.jobs : [],
    activeRun?.workflowId === workflow?.id
      ? jobs.map((j) => ({
          ...j,
          runId: activeRun.id,
          runName: activeRun.name,
          projectId: activeRun.projectId ?? null,
          workflowId: activeRun.workflowId,
        }))
      : [],
  );
  const openImage = (image) => {
    const source = canvasJobs.find(
      (job) =>
        (image.id && job.id === image.id) ||
        (image.output && job.output === image.output),
    );
    setActiveWorkspacePanel(null);
    setInspectedImage({
      ...source,
      ...image,
      id: source?.id || image.id,
      runId: image.runId || source?.runId,
      projectId:
        image.projectId !== undefined
          ? image.projectId
          : view === "styles"
            ? (styleProjectId ?? undefined)
            : source
              ? source.projectId
              : (workflow?.projectId ?? projectContextId ?? undefined),
      workflowId: image.workflowId || source?.workflowId,
    });
    setPanel(null);
    setMenu(null);
  };
  const promptMap = promptGuide({ nodes, edges }, plan);
  const inspectNode = (id, { showHelp = false } = {}) => {
    const node = flow.getNode(id);
    if (!node) return;
    setView("canvas");
    setSelection(id);
    setNodes((items) => items.map((n) => ({ ...n, selected: n.id === id })));
    setPanel("properties");
    if (showHelp)
      requestAnimationFrame(() => {
        document.querySelector(".property-content")?.scrollTo({ top: 0 });
      });
    setLibrary(false);
    const rail = state.current.leftMenu.collapsed ? 44 : 62;
    const right = window.innerWidth <= 650 ? 280 : 300;
    const width = node.measured?.width || 360;
    const height = node.measured?.height || 300;
    const available = Math.max(170, window.innerWidth - rail - right - 48);
    const zoom = Math.min(0.85, available / width);
    const pixelCenter = rail + 16 + available / 2;
    flow.setCenter(
      node.position.x +
        width / 2 +
        (window.innerWidth / 2 - pixelCenter) / zoom,
      node.position.y + height / 2,
      { zoom, duration: 400 },
    );
  };
  const openPromptGuide = () => {
    setPanel("guide");
    setLibrary(false);
    setView("canvas");
  };
  const openProjectsPage = () => {
    saveCurrentWorkflow().catch(() => {});
    setActiveWorkspacePanel(null);
    setInspectedImage(null);
    setMenu(null);
    navigateViewer({ view: "projects" });
    setView("projects");
    setProjectContextId(null);
    setSelection(null);
  };
  const selectProjectContext = useCallback((id) => {
    if (state.current.projectContextId === id) return;
    setProjectContextId(id);
    navigateViewer({ view: "projects", project: id });
  }, []);
  const refreshWorkspaceLists = async () => {
    try {
      const [graphs, registered, history] = await Promise.all([
        jsonRequest("/api/workflows"),
        jsonRequest("/api/projects"),
        jsonRequest("/api/runs"),
      ]);
      setWorkflows(graphs);
      setProjects(registered);
      setRuns(history);
      if (workflow && !graphs.some((graph) => graph.id === workflow.id)) {
        setWorkflow(null);
        setNodes([]);
        setEdges([]);
        setJobs([]);
        setViewingRun(null);
        setActiveRun(null);
      }
    } catch (error) {
      notify(error.message, "error");
    }
  };
  const openStyleGallery = () => {
    if (view === "projects") {
      saveCurrentWorkflow().catch(() => {});
      setWorkflow(null);
      setNodes([]);
      setEdges([]);
      setViewingRun(null);
      setSelection(null);
    }
    setStyleProjectId(
      view === "projects" ? projectContextId : workflow?.projectId || null,
    );
    setPanel(null);
    setInspectedImage(null);
    setLibrary(false);
    setFlowMenu(false);
    navigateViewer({
      view: "styles",
      project:
        view === "projects"
          ? projectContextId
          : workflow?.projectId || styleProjectId,
      workflow: view === "projects" ? undefined : workflow?.id,
    });
    setView("styles");
  };
  const startStyleWorkflow = async (style, options) => {
    const graph = await jsonRequest(
      `/api/styles/${encodeURIComponent(style.id)}/workflows`,
      {
        method: "POST",
        body: JSON.stringify({
          ...options,
          projectId: styleProjectId || null,
        }),
      },
    );
    setWorkflows((items) => [graph, ...items]);
    loadWorkflow(graph);
    notify(`Created ${style.name} workflow. Edit your scene, then run.`);
  };
  const applyStyleDirection = (style) => {
    if (!selected || viewingRun) return;
    editNode(selected.id, {
      text: [selected.data.text?.trim(), style.prompt]
        .filter(Boolean)
        .join("\n\n"),
      style: {
        id: style.id,
        name: style.name,
        category: style.category,
        prompt: style.prompt,
        referenceUrls: [],
      },
    });
    setView("canvas");
    setPanel("properties");
    notify(`Added ${style.name} direction to ${selected.data.label}.`);
  };
  const scrollToRules = () => {
    const section = ruleSectionRef.current;
    const scroller = section?.closest(".property-content");
    if (!scroller) return;
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        section.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        12,
      behavior: "smooth",
    });
  };
  const context = {
    inspectNode,
    inspectPromptItem: (nodeId, itemId) => {
      setPromptItem({ nodeId, itemId });
      inspectNode(nodeId);
    },
    ruleCounts: new Map(
      nodes
        .filter((n) => ruleNodeTypes.includes(n.type))
        .map((n) => [
          n.id,
          mergeRules(inheritedRules(n.id, nodes, edges), n.data.rules || [])
            .length,
        ]),
    ),
    editNode,
    providers,
    chooseProvider,
    openSettings,
    uploadImages,
    openImage,
    runWorkflow,
    resumeRun: (id) => runAction(id, "resume"),
    jobs: canvasJobs,
    starting,
    activeNodeIds: activity.activeNodeIds,
    focusNodes: (ids) =>
      flow.fitView({
        nodes: ids.map((id) => ({ id })),
        padding: 0.12,
        minZoom: 0.1,
        maxZoom: 0.85,
        duration: 350,
      }),
    plan,
    setView,
    menu,
    setMenu,
    outputSources,
    readOnly: Boolean(viewingRun),
    promptOrigins: new Map(
      promptMap.starts.map((source) => [source.id, source]),
    ),
  };
  const libraryItems = Object.keys(nodeTypes).filter((t) =>
    (
      nodeNames[t] +
      " " +
      nodeDescriptions[t] +
      " " +
      {
        image: "reference import upload",
        prompt: "text description",
        "prompt-generate": "Pi Codex Gemini Claude prompt harness",
        variations: "batch list",
        dataset: "CSV JSON quotes records source",
        "prompt-set": "collection scenes batch shared prompts",
        template: "reusable scene scenery variables fields",
        filter: "route records roles category journey quotes",
        section: "lane frame group flow",
        generate: "codex model",
        output: "gallery images",
        "video-generate": "Gemini Veo video motion clip movie",
        "video-output": "gallery videos clips",
      }[t]
    )
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const historyRuns = runs.filter((run) => matchesProject(run, historyProject));
  const galleryRuns = runs.filter((run) => matchesProject(run, galleryProject));
  const scopedGallery = gallery.filter((image) =>
    matchesProject(image, galleryProject),
  );
  const semanticSearch = useGallerySearch({
    query: galleryQuery,
    scope: galleryProject,
    runId: galleryRun,
    providerId: galleryProvider,
    revision: gallery,
    enabled: view === "gallery",
  });
  const visibleGallery = semanticSearch.active
    ? semanticSearch.items
    : scopedGallery.filter(
        (j) =>
          (galleryRun === "all" || j.runId === galleryRun) &&
          (galleryProvider === "all" ||
            (j.providerId || "codex") === galleryProvider),
      );
  const inspectionTools = (
    <div className="dock-tools">
      {viewingRun && !["styles", "projects", "settings"].includes(view) && (
        <div className="snapshot-banner">
          <span>Recorded run · read only</span>
          <button onClick={forkWorkflow}>Fork to edit</button>
        </div>
      )}
      {viewerError && view !== "projects" && (
        <div className="snapshot-banner" role="alert">
          <span>{viewerError}</span>
          <button onClick={() => setFlowMenu(true)}>Choose workflow</button>
        </div>
      )}
      {workflow && !["styles", "projects", "settings"].includes(view) && (
        <RunStatus
          activity={activity}
          busy={["running", "queued", "retrying"].includes(activity.status)}
          stage={
            activeRun?.id === activity.runId
              ? jobs.find((j) => j.status === "running" && j.message)?.message
              : null
          }
          recordedFor={(() => {
            const run = runs.find((run) => run.id === activity.runId);
            return run &&
              (run.projectId || null) !== (workflow.projectId || null)
              ? run.project?.name || "Unassigned history"
              : null;
          })()}
          onAction={runAction}
          onInspect={(id) => {
            fetchRun(id);
            setPanel("runs");
          }}
        />
      )}
      <button
        aria-expanded={panel === "runs"}
        aria-controls="workspace-inspector"
        onClick={() => setPanel(panel === "runs" ? null : "runs")}
      >
        <Clock size={15} /> Job history
      </button>
      {view === "canvas" && (
        <button
          className="canvas-properties"
          aria-expanded={panel === "properties"}
          aria-controls="workspace-inspector"
          onClick={() => {
            setPanel(panel === "properties" ? null : "properties");
            if (panel !== "properties" && !selected) {
              const fallback = nodes.find((n) =>
                ["generate", "video-generate"].includes(n.type),
              );
              if (fallback) {
                setSelection(fallback.id);
                setNodes((current) =>
                  current.map((node) => ({
                    ...node,
                    selected: node.id === fallback.id,
                  })),
                );
              }
            }
          }}
        >
          <SlidersHorizontal size={15} />
          Properties
        </button>
      )}
    </div>
  );
  const exportGraph = () =>
    download(
      toFlowFile(graphForSave(workflow, nodes, edges, flow.getViewport())),
      flowFileName(workflow?.name || "workflow"),
    );
  const canvasControls = (
    <>
      <IconButton
        label="Select tool"
        active={!pan}
        onClick={() => setPan(false)}
      >
        <MousePointer2 size={18} />
      </IconButton>
      <IconButton label="Pan tool" active={pan} onClick={() => setPan(true)}>
        <Hand size={18} />
      </IconButton>
      <span className="toolbar-separator" />
      <IconButton
        label="Undo"
        className="canvas-history-control"
        onClick={undo}
        disabled={Boolean(viewingRun) || !undoCount}
      >
        <Undo2 size={16} />
      </IconButton>
      <IconButton
        label="Redo"
        className="canvas-history-control"
        onClick={redo}
        disabled={Boolean(viewingRun) || !redoCount}
      >
        <Redo2 size={16} />
      </IconButton>
      <span className="toolbar-separator" />
      <IconButton
        label="Zoom out"
        className="canvas-zoom-control"
        onClick={() => flow.zoomOut({ duration: 200 })}
      >
        <Minus size={16} />
      </IconButton>
      <Tooltip label="Reset zoom to 100%">
        <button
          className="zoom-label canvas-zoom-control"
          onClick={() => flow.zoomTo(1, { duration: 250 })}
          title="Zoom to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
      </Tooltip>
      <IconButton
        label="Zoom in"
        className="canvas-zoom-control"
        onClick={() => flow.zoomIn({ duration: 200 })}
      >
        <Plus size={16} />
      </IconButton>
      <span className="toolbar-separator" />
      <IconButton label="Fit all nodes" onClick={fit}>
        <Maximize size={16} />
      </IconButton>
      <span className="toolbar-separator" />
      <IconButton
        label={viewingRun ? "Fork to organize nodes" : "Organize nodes"}
        aria-busy={organizing === workflow?.id}
        disabled={
          Boolean(viewingRun) || !nodes.length || organizing === workflow?.id
        }
        onClick={organizeCanvas}
      >
        {organizing === workflow?.id ? (
          <Loader2 size={18} className="spin" />
        ) : (
          <Network size={18} />
        )}
      </IconButton>
    </>
  );

  const agentWorkflow =
    ["projects", "settings"].includes(view) ||
    (inspectedImage &&
      (inspectedImage.projectId || undefined) !==
        (workflow?.projectId || undefined))
      ? null
      : workflow;
  const agentProjectId =
    editingImage && editorAgentContext
      ? editorAgentContext.projectId
      : inspectedImage
        ? inspectedImage.projectId
        : agentWorkflow?.projectId ||
          (view === "projects"
            ? projectContextId
            : view === "styles"
              ? styleProjectId
              : view === "gallery"
                ? projectContextId
                : undefined);
  const agentPage = editingImage
    ? "editor"
    : viewingRun && agentWorkflow
      ? "recorded"
      : view;
  const agentContext = {
    page: agentPage,
    ...(view === "styles" &&
      styleAgentContext && { styleId: styleAgentContext.styleId }),
    ...(agentWorkflow &&
      !editingImage && {
        workflowId: agentWorkflow.id,
        revision:
          workflowSaver.current.draft(agentWorkflow.id)?.revision ||
          agentWorkflow.revision ||
          0,
        selectedNodeIds: nodes
          .filter((n) => n.selected || n.id === selection)
          .map((n) => n.id),
      }),
    ...(viewingRun &&
      agentWorkflow &&
      !editingImage && { runId: viewingRun.id }),
    ...(editingImage &&
      editorAgentContext && {
        editorId: editorAgentContext.editorId,
        regionIds: editorAgentContext.regionIds,
      }),
    ...(inspectedImage?.runId &&
      mediaKind(inspectedImage) === "image" &&
      !editingImage && {
        image: {
          output: inspectedImage.output,
          runId: inspectedImage.runId,
          jobId: inspectedImage.id,
        },
      }),
  };
  const agentContextLabel = editingImage
    ? `Image editor · ${editorAgentContext?.regionIds.length || 0} ${editorAgentContext?.regionIds.length === 1 ? "region" : "regions"} selected`
    : view === "settings"
      ? `Settings / ${settingsSection}`
      : `${projects.find((p) => p.id === agentProjectId)?.name || "Workspace"} / ${view === "styles" ? styleAgentContext?.name || "Style library" : agentWorkflow?.name || (view === "projects" ? "Projects" : "Gallery")}${selection && agentWorkflow && view !== "styles" ? ` · ${nodes.find((n) => n.id === selection)?.data.label || selection}` : ""}`;
  const prepareAgentContext = async (context) => {
    if (context.page === "editor" && !context.editorId)
      throw new Error(
        "Wait for the image editor to finish opening before sending a message.",
      );
    if (context.workflowId && !context.runId) {
      if (
        state.current.workflow?.id !== context.workflowId ||
        ["projects", "settings"].includes(state.current.view)
      )
        throw new Error(
          "The page changed. Send this message from the intended workflow.",
        );
      await saveCurrentWorkflow();
      return {
        ...context,
        revision:
          workflowSaver.current.draft(context.workflowId)?.revision || 0,
      };
    }
    return context;
  };
  const reconcileAgentChange = async (
    client,
    sessionId,
    turn,
    action = "apply",
  ) => {
    if (
      state.current.workflow?.id !== turn.context.workflowId ||
      ["projects", "settings"].includes(state.current.view) ||
      state.current.viewingRun ||
      state.current.editingImage
    )
      throw new Error("Open the original live workflow to apply this change.");
    const identity = () =>
      `${canvasIdentity(state.current)}/${state.current.view}/${state.current.editingImage?.editorId || state.current.editingImage?.output || ""}`;
    const targetIdentity = identity();
    setApplyingAgent(true);
    try {
      await saveCurrentWorkflow();
      if (identity() !== targetIdentity)
        throw new Error(
          "The page changed while saving. Apply from the original workflow.",
        );
      const result = await (action === "undo"
        ? client.undoAgentTurn(sessionId, turn.id)
        : client.applyAgentTurn(sessionId, turn.id));
      if (result.workflow && identity() === targetIdentity) {
        if (workflowSaver.current.status(result.workflow.id) !== "saved") {
          notify(
            "The agent saved its change, but a newer local draft is preserved. Resolve the save conflict before continuing.",
            "error",
          );
          return result;
        }
        checkpoint();
        const saved = workflowSaver.current.seed(result.workflow, {
          fresh: true,
        });
        setWorkflow(saved);
        setNodes(saved.nodes);
        setEdges(saved.edges);
        setWorkflows((gs) => gs.map((g) => (g.id === saved.id ? saved : g)));
        notify(
          action === "undo" ? "Agent change undone" : "Agent changes saved",
        );
      }
      return result;
    } finally {
      setApplyingAgent(false);
    }
  };
  return (
    <StudioContext.Provider value={context}>
      <div
        inert={applyingAgent}
        aria-busy={applyingAgent}
        className={cls(
          "studio",
          viewingRun && "snapshot-mode",
          view === "canvas" && "canvas-mode",
          leftMenu.collapsed && "rail-collapsed",
          library && !leftMenu.collapsed && "library-open",
          panel && "panel-open",
        )}
        style={{ "--library-width": `${leftMenu.width}px` }}
      >
        <IconButton
          label="Expand left menu"
          className="rail-restore"
          aria-hidden={!leftMenu.collapsed}
          tabIndex={leftMenu.collapsed ? 0 : -1}
          aria-label="Expand left menu"
          aria-expanded="false"
          aria-controls="left-menu"
          title="Expand left menu"
          onClick={() => setLeftMenu((menu) => ({ ...menu, collapsed: false }))}
        >
          <PanelLeftOpen size={19} />
        </IconButton>
        <aside
          className="rail"
          id="left-menu"
          aria-label="Left menu"
          inert={leftMenu.collapsed}
          aria-hidden={leftMenu.collapsed}
        >
          <Tooltip label="Flow home">
            <button
              className="brand"
              aria-label="Flow home"
              onClick={openProjectsPage}
            >
              <Logo />
            </button>
          </Tooltip>
          <div className="rail-main">
            <IconButton
              label="Projects"
              active={view === "projects"}
              onClick={openProjectsPage}
            >
              <FolderOpen size={20} />
            </IconButton>
            <IconButton
              label="Add nodes"
              disabled={!workflow || ["projects", "settings"].includes(view)}
              active={library}
              aria-expanded={library}
              aria-controls="node-library"
              onClick={() => setLibrary((x) => !x)}
            >
              <Plus size={22} />
            </IconButton>
            <IconButton
              label="Start here · prompt and inputs"
              disabled={!workflow || ["projects", "settings"].includes(view)}
              active={panel === "guide"}
              aria-expanded={panel === "guide"}
              aria-controls="workspace-inspector"
              onClick={openPromptGuide}
            >
              <Type size={20} />
            </IconButton>
            <IconButton
              label="Workflows"
              active={flowMenu}
              data-workflow-menu-trigger
              aria-expanded={flowMenu}
              aria-controls="workflow-menu"
              onClick={() => setFlowMenu((x) => !x)}
            >
              <Workflow size={20} />
            </IconButton>
            <IconButton
              label="Image gallery"
              active={view === "gallery"}
              onClick={() =>
                navigateView(view === "gallery" ? "canvas" : "gallery")
              }
            >
              <Grid2X2 size={19} />
            </IconButton>
            <IconButton
              label="Style library"
              active={view === "styles"}
              onClick={
                view === "styles"
                  ? () => navigateView("canvas")
                  : openStyleGallery
              }
            >
              <Palette size={20} />
            </IconButton>
            <div className="rail-separator" />
            <IconButton
              label="Agent access · CLI and MCP"
              onClick={() => setModal("cli")}
            >
              <Terminal size={19} />
            </IconButton>
            <IconButton
              label="Import workflow"
              onClick={() => importInput.current.click()}
            >
              <FileInput size={20} />
            </IconButton>
          </div>
          <div className="rail-bottom">
            <IconButton
              label="Collapse left menu"
              aria-expanded="true"
              aria-controls="left-menu"
              onClick={() => {
                setLeftMenu((menu) => ({ ...menu, collapsed: true }));
                setActiveWorkspacePanel(null);
              }}
            >
              <PanelLeftClose size={19} />
            </IconButton>
            <HarnessUsage
              usage={harnessUsage}
              hidden={leftMenu.collapsed}
              onOpen={() => setActiveWorkspacePanel(null)}
              onSettings={() => openSettings("providers")}
            />
            <IconButton
              label="Settings"
              active={view === "settings"}
              onClick={() => openSettings()}
            >
              <Settings2 size={20} />
            </IconButton>
            <IconButton
              label="Keyboard shortcuts"
              onClick={() => setModal("help")}
            >
              <HelpCircle size={20} />
            </IconButton>
            <Tooltip label="Local workspace">
              <button
                className="avatar"
                aria-label="Local workspace"
                onClick={() => openSettings()}
                title="Local workspace"
              >
                L
              </button>
            </Tooltip>
          </div>
        </aside>
        {view !== "settings" && (
          <WorkspaceNotch
            holdOpen={flowMenu}
            status={
              workflow && activity.runId
                ? `${activity.label} · ${activity.counts.completed}/${activity.total}`
                : null
            }
            busy={["running", "queued", "retrying"].includes(activity.status)}
          >
            <header className="topbar">
              {view === "projects" && <strong>Projects</strong>}
              {view !== "projects" && (
                <div className="workflow-switcher">
                  <div className="project-pill">
                    {!workflow ? (
                      <span className="projects-topbar-title">
                        {view === "styles" ? "Style library" : "Image gallery"}
                      </span>
                    ) : (
                      <>
                        <Tooltip label="Projects and workflows">
                          <button
                            className="breadcrumb-icon"
                            aria-label="Projects and workflows"
                            data-workflow-menu-trigger
                            aria-expanded={flowMenu}
                            aria-controls="workflow-menu"
                            onClick={() => setFlowMenu((x) => !x)}
                            title="Workflows"
                          >
                            <Workflow size={17} />
                          </button>
                        </Tooltip>
                        <span className="crumb-separator" />
                        <div className="workflow-title-stack">
                          <span
                            className="workflow-project-label"
                            title={
                              projects.find((p) => p.id === workflow?.projectId)
                                ?.root ||
                              "Assign this workflow to a local project in the workflow menu"
                            }
                          >
                            {projects.find((p) => p.id === workflow?.projectId)
                              ?.name || "Unassigned"}{" "}
                            · local
                          </span>
                          <input
                            aria-label="Workflow name"
                            readOnly={Boolean(viewingRun)}
                            value={
                              workflow?.name ||
                              (viewerError
                                ? "Choose a workflow"
                                : "Loading workspace…")
                            }
                            onChange={(e) =>
                              setWorkflow((g) => ({
                                ...g,
                                name: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <Tooltip label="Workflow menu">
                          <button
                            className="chevron-button"
                            aria-label="Workflow menu"
                            data-workflow-menu-trigger
                            aria-expanded={flowMenu}
                            aria-controls="workflow-menu"
                            onClick={() => setFlowMenu((x) => !x)}
                          >
                            <ChevronDown size={13} />
                          </button>
                        </Tooltip>
                        <Tooltip
                          label={
                            viewingRun
                              ? "Recorded run · read only"
                              : saveState === "error"
                                ? "Retry saving workflow"
                                : saveState === "saving"
                                  ? "Saving workflow"
                                  : "Saved to local database"
                          }
                        >
                          <button
                            className={cls(
                              "save-status",
                              saveState === "error" && "save-error",
                            )}
                            disabled={Boolean(viewingRun)}
                            title={
                              saveState === "saved"
                                ? "Saved to local database"
                                : saveState
                            }
                            aria-label={
                              viewingRun
                                ? "Recorded run · read only"
                                : saveState === "error"
                                  ? "Retry saving workflow"
                                  : saveState === "saving"
                                    ? "Saving workflow"
                                    : "Saved to local database"
                            }
                            onClick={() =>
                              saveCurrentWorkflow().catch(() => {})
                            }
                          >
                            {saveState === "saving" ? (
                              <Loader2 size={13} className="spin" />
                            ) : saveState === "error" ? (
                              <AlertCircle size={13} />
                            ) : (
                              <CheckCheck size={14} />
                            )}
                          </button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                  {view === "canvas" &&
                    nodes.some((node) => node.type === "section") && (
                      <Autocomplete
                        className="canvas-flow-picker"
                        label="Jump to flow"
                        value=""
                        fallbackLabel="Flows"
                        searchPlaceholder="Find a flow…"
                        options={[
                          { value: "all", label: "All flows" },
                          {
                            value: "shared",
                            label: "Shared source",
                            disabled: !nodes.some(
                              (node) =>
                                node.type === "dataset" ||
                                node.id === "shared-style",
                            ),
                          },
                          ...nodes
                            .filter((node) => node.type === "section")
                            .map((node) => ({
                              value: `section:${node.id}`,
                              label: node.data.label.replace(/^\d+\s*/, ""),
                            })),
                        ]}
                        onChange={(value) => {
                          if (value === "all") return fit();
                          if (value === "shared")
                            return context.focusNodes(
                              nodes
                                .filter(
                                  (node) =>
                                    node.type === "dataset" ||
                                    node.id === "shared-style",
                                )
                                .map((node) => node.id),
                            );
                          const section = nodes.find(
                            (node) => `section:${node.id}` === value,
                          );
                          if (section)
                            context.focusNodes([
                              section.id,
                              ...(section.data.members || []),
                            ]);
                        }}
                      />
                    )}
                </div>
              )}
              {view !== "projects" && (
                <div className="topbar-actions">
                  <button
                    className="connection-status"
                    onClick={() => openSettings("providers")}
                  >
                    <span
                      className={cls(
                        "status-dot",
                        providers.some((p) => p.ready) && "ready",
                      )}
                    />
                    <span>
                      {providers.filter((p) => p.ready).length} providers
                    </span>
                    <ChevronDown size={12} />
                  </button>
                  <Tooltip label="Run from your terminal">
                    <button
                      className="cli-button"
                      onClick={() => setModal("cli")}
                      title="Run from your terminal"
                    >
                      <Terminal size={15} />
                      <span>CLI</span>
                    </button>
                  </Tooltip>
                  {workflow && (
                    <Tooltip
                      label={
                        plan
                          ? `${plan.imageJobs || 0} images · ${plan.videoJobs || 0} videos · ${plan.textJobs || 0} prompts ready`
                          : planError || "Preparing workflow…"
                      }
                    >
                      <button
                        className="primary-button run-workflow"
                        onClick={() => runWorkflow()}
                        disabled={
                          starting ||
                          !workflow ||
                          Boolean(viewingRun) ||
                          view === "styles"
                        }
                      >
                        <Play size={13} fill="currentColor" />
                        <span>{starting ? "Starting…" : "Run workflow"}</span>
                        <kbd>⌘ ↵</kbd>
                      </button>
                    </Tooltip>
                  )}
                </div>
              )}
            </header>
            {inspectionTools}
          </WorkspaceNotch>
        )}
        {flowMenu && (
          <WorkflowMenu
            workflows={workflows.filter(
              (graph) =>
                !projects.some(
                  (project) =>
                    project.id === graph.projectId &&
                    project.kind === "library",
                ) || graph.projectId === workflow?.projectId,
            )}
            workflow={workflow}
            readOnly={Boolean(viewingRun)}
            projects={projects.filter(
              (project) =>
                project.kind !== "library" ||
                project.id === workflow?.projectId,
            )}
            onProjects={openProjectsPage}
            onLoad={openSavedWorkflow}
            onNew={newWorkflow}
            onFork={forkWorkflow}
            onExport={exportGraph}
            onImport={() => {
              setFlowMenu(false);
              importInput.current.click();
            }}
            onAssign={async (projectId) => {
              try {
                const current = state.current;
                const graph = graphForSave(
                  current.workflow,
                  current.nodes,
                  current.edges,
                  flow.getViewport(),
                );
                workflowSaver.current.stage(graph);
                await assignWorkflowProject({
                  graph,
                  projectId,
                  saver: workflowSaver.current,
                  setProject: (id, projectId) =>
                    setWorkflow((current) =>
                      current?.id === id ? { ...current, projectId } : current,
                    ),
                });
                notify(
                  projectId
                    ? "Workflow linked to project"
                    : "Workflow is unassigned",
                );
              } catch (error) {
                notify(error.message, "error");
              }
            }}
            onCreateProject={async (input) => {
              const p = await jsonRequest("/api/projects", {
                method: "POST",
                body: JSON.stringify(input),
              });
              setProjects((ps) => [
                ...ps.filter((existing) => existing.id !== p.id),
                p,
              ]);
              notify("Local project registered");
              return p;
            }}
          />
        )}
        <aside
          className={cls(
            "library",
            library && !leftMenu.collapsed && "is-open",
            leftMenu.width < 224 && "library-compact",
          )}
          inert={!library || leftMenu.collapsed}
          aria-hidden={!library || leftMenu.collapsed}
          id="node-library"
          aria-label="Node library"
        >
          <div className="library-title">
            <span>Add nodes</span>
            <IconButton
              label="Close node library"
              onClick={() => setLibrary(false)}
            >
              <PanelLeftClose size={15} />
            </IconButton>
          </div>
          <label className="search-field">
            <Search size={14} />
            <input
              aria-label="Search nodes"
              placeholder="Search nodes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>Tab</kbd>
          </label>
          <div className="library-content">
            <div className="library-section-heading">Nodes</div>
            <div className="node-library-list">
              {libraryItems.map((type) => {
                const Icon = icons[type];
                return (
                  <Tooltip key={type} label={nodeDescriptions[type]}>
                    <button
                      draggable={!viewingRun}
                      disabled={Boolean(viewingRun) || !workflow}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/flow-node", type);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => addNode(type)}
                      className="library-item"
                    >
                      <span className="library-icon">
                        <Icon size={18} />
                      </span>
                      <span>
                        <strong>{nodeNames[type]}</strong>
                        <small className="node-library-description">
                          {nodeDescriptions[type]}
                        </small>
                      </span>
                      <Plus size={14} className="library-plus" />
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            <div className="library-section-heading">Providers</div>
            {providers
              .filter((p) =>
                `${p.name} ${p.models.join(" ")}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((provider) => (
                <button
                  className="library-item provider-library-item"
                  key={provider.id}
                  disabled={
                    (!provider.ready &&
                      !provider.capabilities?.includes("video") &&
                      provider.kind !== "grok") ||
                    Boolean(viewingRun)
                  }
                  draggable={
                    !viewingRun &&
                    (provider.ready ||
                      provider.capabilities?.includes("video") ||
                      provider.kind === "grok")
                  }
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/flow-node",
                      nodeForProvider(provider),
                    );
                    e.dataTransfer.setData(
                      "application/flow-provider",
                      provider.id,
                    );
                  }}
                  onClick={() =>
                    addNode(nodeForProvider(provider), undefined, {
                      label: provider.name,
                      providerId: provider.id,
                      ...(provider.kind === "fal"
                        ? falDefaults(falModel(model))
                        : provider.id === "grok-image"
                          ? { quality: "medium", image: { resolution: "1k" } }
                          : provider.id === "grok-video"
                            ? {
                                video: {
                                  resolution: "720p",
                                  durationSeconds: 8,
                                },
                              }
                            : {}),
                      model: modelsFor(
                        provider,
                        generationKind(nodeForProvider(provider)),
                      )[0],
                    })
                  }
                >
                  <span className="library-icon">
                    {provider.kind === "command" ? (
                      <Terminal size={18} />
                    ) : (
                      <HarnessLogo id={provider.id} size={18} />
                    )}
                  </span>
                  <span>
                    <strong>{provider.name}</strong>
                    <small>
                      {provider.kind === "codex"
                        ? "ChatGPT subscription"
                        : provider.kind === "command"
                          ? "Local command"
                          : provider.kind === "gemini-video"
                            ? "Video API · separate billing"
                            : provider.kind === "grok"
                              ? "xAI API · separate billing"
                              : provider.kind === "fal"
                                ? "fal API"
                                : ["ollama", "comfyui"].includes(provider.kind)
                                  ? "Local model"
                                  : provider.kind === "harness"
                                    ? "Prompt harness"
                                    : "Compatible API"}
                    </small>
                  </span>
                  <UsageBadge
                    report={harnessUsage.report}
                    providerId={provider.id}
                  />
                  <Plus size={14} className="library-plus" />
                </button>
              ))}
          </div>
          <div
            className="library-resize"
            role="separator"
            tabIndex={0}
            aria-label="Resize node library"
            aria-orientation="vertical"
            aria-valuemin={188}
            aria-valuemax={360}
            aria-valuenow={leftMenu.width}
            title="Drag to resize. Arrow keys resize; Enter collapses."
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              libraryResize.current = {
                x: event.clientX,
                width:
                  event.currentTarget.parentElement.getBoundingClientRect()
                    .width,
              };
            }}
            onPointerMove={(event) => {
              if (!libraryResize.current) return;
              const width =
                libraryResize.current.width +
                event.clientX -
                libraryResize.current.x;
              if (width < 160) {
                libraryResize.current = null;
                setLibrary(false);
              } else
                setLeftMenu((menu) => ({
                  ...menu,
                  width: Math.max(188, Math.min(360, Math.round(width))),
                }));
            }}
            onPointerUp={(event) => {
              libraryResize.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              libraryResize.current = null;
            }}
            onLostPointerCapture={() => {
              libraryResize.current = null;
            }}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Enter") setLibrary(false);
              else
                setLeftMenu((menu) => ({
                  ...menu,
                  width:
                    event.key === "Home"
                      ? 188
                      : event.key === "End"
                        ? 360
                        : Math.max(
                            188,
                            Math.min(
                              360,
                              menu.width +
                                (event.key === "ArrowLeft" ? -16 : 16),
                            ),
                          ),
                }));
            }}
          />
        </aside>
        <main
          className={cls(
            "main",
            view === "settings"
              ? "settings-main"
              : view === "projects"
                ? "projects-main"
                : view === "styles"
                  ? "styles-main"
                  : view === "gallery"
                    ? "gallery-main"
                    : "canvas-main",
          )}
        >
          {view === "settings" ? (
            <SettingsPage
              section={settingsSection}
              onSection={(section) => {
                setSettingsSection(section);
                navigateViewer({ view: "settings", section });
              }}
              onBack={() => navigateView(workflow ? "canvas" : "projects")}
              providers={providers}
              usage={harnessUsage}
              onReload={reloadProviders}
              onChange={setProviders}
              concurrency={concurrency}
              onConcurrency={updateConcurrency}
              health={health}
              onExample={connectorExample}
              projects={projects}
            />
          ) : view === "projects" ? (
            <ProjectsPage
              initialProjectId={projectContextId}
              onSelectProject={selectProjectContext}
              onOpen={openSavedWorkflow}
              onNew={newWorkflow}
              onChanged={refreshWorkspaceLists}
            />
          ) : view === "styles" ? (
            <StyleGallery
              onOpenImage={openImage}
              onAgentContext={setStyleAgentContext}
              project={projects.find(
                (project) => project.id === styleProjectId,
              )}
              onStart={startStyleWorkflow}
              backLabel={workflow ? "Back to canvas" : "Back to projects"}
              onApply={
                !viewingRun &&
                ["prompt", "template", "prompt-generate", "generate"].includes(
                  selected?.type,
                )
                  ? applyStyleDirection
                  : undefined
              }
              onClose={() => navigateView("canvas")}
            />
          ) : view === "canvas" ? (
            <>
              <div
                className="canvas-surface"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  if (viewingRun) return;
                  e.preventDefault();
                  const type = e.dataTransfer.getData("application/flow-node");
                  if (type)
                    addNode(
                      type,
                      flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
                      (() => {
                        const id = e.dataTransfer.getData(
                          "application/flow-provider",
                        );
                        const p = providers.find((p) => p.id === id);
                        return p
                          ? {
                              label: p.name,
                              providerId: p.id,
                              model: modelsFor(
                                p,
                                generationKind(nodeForProvider(p)),
                              )[0],
                            }
                          : {};
                      })(),
                    );
                  else if (e.dataTransfer.files.length)
                    handleFiles(e.dataTransfer.files, null);
                }}
              >
                <ReactFlow
                  nodesDraggable={!viewingRun}
                  nodesConnectable={!viewingRun}
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  defaultEdgeOptions={{ type: "flow" }}
                  onNodeClick={(event, node) => {
                    setSelection(node.id);
                    setMenu(null);
                    if (
                      !event.target.closest(
                        "button, a, input, textarea, select, summary",
                      )
                    ) {
                      setInspectedImage(null);
                      setPanel("properties");
                    }
                  }}
                  onNodeDragStart={checkpoint}
                  onSelectionChange={({ nodes: selected }) =>
                    setSelection(selected.length === 1 ? selected[0].id : null)
                  }
                  onNodeContextMenu={(event, node) => {
                    event.preventDefault();
                    setSelection(node.id);
                    setMenu(node.id);
                  }}
                  onPaneClick={() => {
                    setSelection(null);
                    setMenu(null);
                    setFlowMenu(false);
                  }}
                  onPaneContextMenu={(e) => {
                    e.preventDefault();
                    if (viewingRun) return;
                    setModal("add");
                  }}
                  onEdgesDelete={checkpoint}
                  onNodeDoubleClick={(_, node) => {
                    setSelection(node.id);
                    setPanel("properties");
                  }}
                  isValidConnection={isValidConnection}
                  minZoom={0.1}
                  maxZoom={1.6}
                  panOnDrag={pan || [1, 2]}
                  selectionOnDrag={!pan}
                  selectionMode={SelectionMode.Partial}
                  panOnScroll
                  zoomOnScroll={false}
                  zoomOnPinch
                  onEdgeDoubleClick={(_, edge) => {
                    if (viewingRun) return;
                    checkpoint();
                    setEdges((es) => es.filter((e) => e.id !== edge.id));
                  }}
                  onMoveEnd={(_, viewport) => {
                    if (initialized.current)
                      setWorkflow((g) => ({ ...g, viewport }));
                  }}
                  deleteKeyCode={null}
                  fitView
                  fitViewOptions={{
                    padding: 0.15,
                    minZoom: 0.1,
                    maxZoom: 0.85,
                  }}
                >
                  <Background color="#333333" gap={22} size={0.8} />
                  <MiniMap
                    position="bottom-right"
                    pannable
                    zoomable
                    nodeColor={(n) =>
                      n.type === "section" ? "transparent" : "#777777"
                    }
                    nodeStrokeWidth={1}
                    maskColor="rgba(20,20,20,.7)"
                  />
                </ReactFlow>
              </div>
              {!nodes.length && (
                <div className="empty-canvas">
                  <h2>Start a workflow</h2>
                  <div className="empty-canvas-actions">
                    <button
                      className="primary-button"
                      onClick={() => addNode("image")}
                    >
                      <Plus size={15} />
                      Add image
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => addNode("prompt")}
                    >
                      <Type size={15} />
                      Add prompt
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="gallery-page">
              <div className="gallery-heading">
                <div>
                  <h1>Gallery</h1>
                </div>
                <div className="gallery-export-actions">
                  <a
                    className="secondary-button"
                    download
                    href={`/api/assets/dataset?${new URLSearchParams({ mode: "all", ...(galleryProject.startsWith("workflow:") ? { workflowId: galleryProject.slice(9), ...(workflow?.projectId ? { projectId: workflow.projectId } : {}) } : galleryProject !== "all" ? { projectId: galleryProject === "unassigned" ? "unassigned" : galleryProject.replace(/^project:/, "") } : {}), ...(galleryRun !== "all" ? { runId: galleryRun } : {}) })}`}
                    title="Export asset lineage, labels and eligibility as JSONL"
                  >
                    <FileJson size={14} />
                    Asset records
                  </a>
                  <a
                    className="secondary-button"
                    download
                    href={`/api/assets/dataset?${new URLSearchParams({ mode: "training", ...(galleryProject.startsWith("workflow:") ? { workflowId: galleryProject.slice(9), ...(workflow?.projectId ? { projectId: workflow.projectId } : {}) } : galleryProject !== "all" ? { projectId: galleryProject === "unassigned" ? "unassigned" : galleryProject.replace(/^project:/, "") } : {}), ...(galleryRun !== "all" ? { runId: galleryRun } : {}) })}`}
                    title="Only accepted assets with confirmed rights and explicit training permission"
                  >
                    <Download size={14} />
                    Training JSONL
                  </a>
                </div>
                <button className="secondary-button" onClick={refreshGallery}>
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>
              <div className="gallery-filters">
                <ProjectFilter
                  projects={projects}
                  workflow={workflow}
                  value={galleryProject}
                  label="Filter gallery by project"
                  onChange={(scope) => {
                    setGalleryProject(scope);
                    setGalleryRun("all");
                  }}
                />

                <label className="search-field">
                  <Search size={15} />
                  <input
                    placeholder="Search images…"
                    aria-label="Search generated outputs"
                    value={galleryQuery}
                    onChange={(e) => setGalleryQuery(e.target.value)}
                  />
                </label>
                <Autocomplete
                  label="Filter gallery by run"
                  value={galleryRun}
                  onChange={setGalleryRun}
                  options={[
                    { value: "all", label: "All runs" },
                    ...galleryRuns.map((r) => ({
                      value: r.id,
                      label: `${r.name} · ${new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
                    })),
                  ]}
                />
                <Autocomplete
                  className="gallery-provider-filter"
                  label="Filter gallery by provider"
                  value={galleryProvider}
                  onChange={setGalleryProvider}
                  options={[
                    { value: "all", label: "All providers" },
                    ...providers.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
                <span>{visibleGallery.length} outputs</span>
              </div>
              {semanticSearch.active && (
                <div className="semantic-search-status" role="status">
                  {semanticSearch.loading ? (
                    <>
                      <Loader2 size={13} className="spin" /> Searching by
                      meaning on this computer…
                    </>
                  ) : semanticSearch.error ? (
                    <>
                      <AlertCircle size={13} /> {semanticSearch.error}
                      <button
                        onClick={async () => {
                          try {
                            await jsonRequest("/api/search/retry", {
                              method: "POST",
                            });
                            refreshGallery();
                          } catch (error) {
                            notify(error.message, "error");
                          }
                        }}
                      >
                        {semanticSearch.index?.state === "setup-required"
                          ? "Download search model"
                          : "Retry model download"}
                      </button>
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} /> Semantic results
                      {semanticSearch.index?.state !== "ready" && (
                        <span>
                          Indexing {semanticSearch.index?.indexed || 0}/
                          {semanticSearch.index?.total || 0} outputs…
                        </span>
                      )}
                      {semanticSearch.total > visibleGallery.length && (
                        <span>
                          Showing the best {visibleGallery.length} of{" "}
                          {semanticSearch.total}
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
              {visibleGallery.length ? (
                <div className="gallery-grid">
                  {visibleGallery.map((j) => (
                    <button
                      className={cls(
                        "gallery-tile",
                        j.records?.length && "quote-art",
                      )}
                      key={j.id}
                      aria-label={
                        j.edit
                          ? `Inspect edited variation #${j.seed}`
                          : undefined
                      }
                      onClick={() =>
                        openImage({ ...j, collection: visibleGallery })
                      }
                    >
                      <div>
                        <MediaPreview
                          item={j}
                          alt={
                            j.edit
                              ? "Edited image variation"
                              : j.records?.[0]?.fields.scene || j.prompt
                          }
                          loading="lazy"
                        />
                        <span className="gallery-open">
                          <Maximize size={16} />
                        </span>
                        {mediaKind(j) === "video" && (
                          <span className="gallery-video-label">
                            Video
                            {j.metadata?.durationSeconds
                              ? ` · ${j.metadata.durationSeconds}s`
                              : ""}
                          </span>
                        )}
                        {j.edit && (
                          <span className="gallery-variation-label">
                            Variation
                          </span>
                        )}
                      </div>
                      <footer>
                        <span>
                          <span className="tiny-dot" />
                          {recordTitle(j) || `#${j.seed}`}
                        </span>
                        <small>
                          {j.metadata?.width
                            ? `${j.metadata.width}×${j.metadata.height}`
                            : j.ratio}{" "}
                          · {providerName(j.providerId)}
                        </small>
                      </footer>
                      {j.mode && (
                        <div className="mode-badge">
                          <HarnessLogo id={j.providerId} size={13} />
                          <span>
                            {j.mode.label} ·{" "}
                            {j.metadata?.actualModel ||
                              j.metadata?.model ||
                              j.model ||
                              "Default"}{" "}
                            · copy {(j.comparison?.copyIndex ?? 0) + 1}
                          </span>
                        </div>
                      )}
                      {(j.records?.[0]?.fields.quote ||
                        j.records?.[0]?.fields.title) && (
                        <p className="gallery-quote">
                          {recordFields(j).quote ||
                            recordFields(j).scene ||
                            recordFields(j).title}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="gallery-empty">
                  <h2>
                    {semanticSearch.loading
                      ? "Searching by meaning…"
                      : semanticSearch.error
                        ? "Local search needs attention"
                        : semanticSearch.index &&
                            semanticSearch.index.state !== "ready"
                          ? "Building the local search index…"
                          : gallery.length
                            ? "No matching images"
                            : "No images yet"}
                  </h2>
                  <p>
                    {semanticSearch.loading
                      ? "Matching scenes, quotes and prompts with local embeddings."
                      : semanticSearch.error
                        ? "Download the local search model to search by meaning. Your saved outputs are available when you clear the search."
                        : semanticSearch.index &&
                            semanticSearch.index.state !== "ready"
                          ? "You can keep browsing while new outputs are indexed."
                          : galleryProject !== "all" && !scopedGallery.length
                            ? "No outputs were recorded in this project scope. Earlier unassigned runs remain available under Unassigned; the canvas retains this workflow’s saved results."
                            : gallery.length
                              ? "Try another prompt, seed, or run."
                              : "Run your workflow and your generated outputs will appear here."}
                  </p>
                  {galleryProject.startsWith("project:") &&
                    !scopedGallery.length && (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setGalleryProject("unassigned");
                          setGalleryRun("all");
                        }}
                      >
                        View unassigned results
                      </button>
                    )}
                  <button
                    className="secondary-button"
                    onClick={() => navigateView("canvas")}
                  >
                    {workflow ? "Back to canvas" : "Back to projects"}
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
        <div className={cls("right-dock", panel && "is-open")}>
          <div className="panel-reveal" inert={!panel} aria-hidden={!panel}>
            <aside
              className="right-panel"
              id="workspace-inspector"
              aria-label={
                panelContent === "runs"
                  ? "Run history"
                  : panelContent === "guide"
                    ? "Prompt map"
                    : "Node properties"
              }
            >
              <div className="right-panel-title">
                <span>
                  {panelContent === "runs"
                    ? "Run history"
                    : panelContent === "guide"
                      ? "Start here"
                      : "Node properties"}
                </span>
                <IconButton label="Close panel" onClick={() => setPanel(null)}>
                  <X size={17} />
                </IconButton>
              </div>
              {panelContent === "runs" ? (
                <>
                  <div className="parallel-control">
                    <label htmlFor="parallel">Parallel jobs</label>
                    <Autocomplete
                      id="parallel"
                      label="Parallel jobs"
                      value={concurrency}
                      onChange={(value) => updateConcurrency(Number(value))}
                      options={[1, 2, 4, 8, 16, 32, 64, 128].map((n) => ({
                        value: String(n),
                        label: `${n} at a time`,
                      }))}
                    />
                  </div>
                  <div className="history-project-filter">
                    <ProjectFilter
                      projects={projects}
                      workflow={workflow}
                      value={historyProject}
                      label="Filter run history by project"
                      onChange={setHistoryProject}
                    />
                  </div>
                  <div className="run-list">
                    {historyRuns.length ? (
                      historyRuns.map((r) => (
                        <div
                          className={cls(
                            "run-card",
                            r.id === activeRun?.id && "selected",
                          )}
                          key={r.id}
                        >
                          <button
                            className="run-select"
                            onClick={() =>
                              viewingRun
                                ? openRecordedRun(r.id)
                                : fetchRun(r.id)
                            }
                          >
                            <span className={cls("run-status-icon", r.status)}>
                              {r.status === "running" ? (
                                <Loader2 size={16} className="spin" />
                              ) : r.status === "completed" ? (
                                <CheckCircle2 size={16} />
                              ) : r.status === "failed" ? (
                                <AlertCircle size={16} />
                              ) : r.status === "paused" ? (
                                <Pause size={15} />
                              ) : (
                                <Clock size={15} />
                              )}
                            </span>
                            <span>
                              <strong>{r.name}</strong>
                              <small>
                                {new Date(r.createdAt).toLocaleDateString([], {
                                  month: "short",
                                  day: "numeric",
                                })}{" "}
                                ·{" "}
                                {new Date(r.createdAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </small>
                              <small>
                                {r.project?.name ||
                                  projects.find(
                                    (project) => project.id === r.projectId,
                                  )?.name ||
                                  "Unassigned"}
                              </small>
                              <em className="run-provider-name">
                                {r.provider === "mixed"
                                  ? "Mixed providers"
                                  : providerName(r.provider)}
                              </em>
                            </span>
                            <ChevronRight size={14} />
                          </button>
                          <div className="run-progress">
                            <div
                              style={{
                                width: `${(r.counts.completed / r.total) * 100}%`,
                              }}
                            />
                          </div>
                          <div className="run-counts">
                            <span>
                              {r.counts.completed} / {r.total} jobs
                            </span>
                            <span className={cls("status-word", r.status)}>
                              {r.status}
                            </span>
                          </div>
                          {r.id === activeRun?.id && (
                            <>
                              <div className="run-actions">
                                {r.status === "running" ? (
                                  <button
                                    onClick={() => runAction(r.id, "pause")}
                                  >
                                    <Pause size={12} />
                                    Pause
                                  </button>
                                ) : r.status === "paused" ? (
                                  <button
                                    onClick={() => runAction(r.id, "resume")}
                                  >
                                    <Play size={12} />
                                    Resume
                                  </button>
                                ) : [
                                    "failed",
                                    "interrupted",
                                    "cancelled",
                                  ].includes(r.status) ? (
                                  <button
                                    onClick={() => runAction(r.id, "retry")}
                                  >
                                    <RotateCcw size={12} />
                                    Retry unfinished
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => openRecordedRun(r.id, true)}
                                  >
                                    <Grid2X2 size={12} />
                                    View outputs
                                  </button>
                                )}
                                {["running", "paused"].includes(r.status) && (
                                  <button
                                    onClick={() => runAction(r.id, "cancel")}
                                  >
                                    <Square size={11} />
                                    Cancel
                                  </button>
                                )}
                                <a
                                  href={`/api/runs/${r.id}/download`}
                                  download
                                  title="Download all completed outputs as ZIP"
                                >
                                  <Download size={13} />
                                </a>
                                <a
                                  href={`/api/runs/${r.id}/manifest`}
                                  download
                                  title="Download run manifest"
                                >
                                  <FileJson size={13} />
                                </a>
                              </div>
                              <div className="job-summary">
                                {jobs
                                  .filter(
                                    (j) => j.kind === "text" && j.resultText,
                                  )
                                  .map((j) => (
                                    <details
                                      className="run-text-result"
                                      key={j.id}
                                    >
                                      <summary>
                                        <Type size={12} /> {j.label} ·{" "}
                                        {j.metadata?.providerName}
                                      </summary>
                                      <p>{j.resultText}</p>
                                    </details>
                                  ))}
                                {jobs
                                  .filter((j) =>
                                    ["failed", "running", "retrying"].includes(
                                      j.status,
                                    ),
                                  )
                                  .slice(0, 4)
                                  .map((j) => (
                                    <div
                                      key={j.id}
                                      className={cls(
                                        "job-line",
                                        j.status === "failed" && "error",
                                      )}
                                    >
                                      <span>
                                        {j.records?.[0]?.fields.author ||
                                          `#${j.seed}`}{" "}
                                        · {j.status}
                                      </span>
                                      {j.error && <p>{j.error}</p>}
                                    </div>
                                  ))}
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="no-runs">
                        <Clock size={25} />
                        <strong>Your first run starts here.</strong>
                        <p>Connect your nodes, then run a workflow.</p>
                      </div>
                    )}
                  </div>
                  <div className="run-footer">
                    <FolderOpen size={13} />
                    <span>Images saved on this computer</span>
                  </div>
                </>
              ) : panelContent === "guide" ? (
                <PromptGuide
                  graph={{ nodes, edges }}
                  plan={plan}
                  onInspect={inspectNode}
                />
              ) : selected ? (
                <div className="property-content" key={selected.id}>
                  <button className="prompt-map-back" onClick={openPromptGuide}>
                    <ArrowRight
                      size={12}
                      style={{ transform: "rotate(180deg)" }}
                    />{" "}
                    Prompt & inputs map
                  </button>
                  <div className="property-node-name">
                    <span>
                      {React.createElement(icons[selected.type], { size: 22 })}
                    </span>
                    <strong>{nodeNames[selected.type]}</strong>
                  </div>
                  <NodeExplanation type={selected.type} />
                  <label>
                    Node name
                    <input
                      readOnly={Boolean(viewingRun)}
                      value={selected.data.label}
                      onChange={(e) =>
                        editNode(selected.id, { label: e.target.value })
                      }
                    />
                  </label>
                  {ruleNodeTypes.includes(selected.type) && (
                    <button
                      className="property-rules-link"
                      onClick={() => scrollToRules()}
                    >
                      <CheckCheck size={13} /> Rules & templates{" "}
                      <ArrowRight size={12} />
                    </button>
                  )}
                  {["prompt", "variations", "template"].includes(
                    selected.type,
                  ) && (
                    <label className="primary-prompt-editor">
                      {promptMap.starts.find(
                        (source) => source.id === selected.id,
                      )?.kind ||
                        (selected.type === "template"
                          ? "Prompt template"
                          : selected.type === "variations"
                            ? "Variations · one per line"
                            : "Prompt")}
                      <textarea
                        rows="10"
                        aria-label="Edit prompt text"
                        readOnly={Boolean(viewingRun)}
                        value={
                          selected.data[
                            selected.type === "variations" ? "lines" : "text"
                          ] || ""
                        }
                        onChange={(e) =>
                          editNode(selected.id, {
                            [selected.type === "variations" ? "lines" : "text"]:
                              e.target.value,
                          })
                        }
                      />
                      <small>
                        {viewingRun
                          ? "Recorded input. Fork this run to edit it."
                          : selected.type === "template"
                            ? "{{fields}} are filled from each connected record."
                            : "Shared direction flows into every connected branch. Changes save automatically."}
                      </small>
                    </label>
                  )}
                  {selected.type === "prompt-set" && (
                    <PromptSetEditor
                      node={selected}
                      graph={{ ...workflow, nodes, edges }}
                      jobs={canvasJobs}
                      itemId={
                        promptItem?.nodeId === selected.id
                          ? promptItem.itemId
                          : undefined
                      }
                      readOnly={Boolean(viewingRun)}
                      starting={starting}
                      onChange={(patch) => editNode(selected.id, patch)}
                      onRun={runWorkflow}
                      onOpenImage={openImage}
                    />
                  )}
                  {ruleNodeTypes.includes(selected.type) && (
                    <RuleTemplates
                      sectionRef={ruleSectionRef}
                      key={selected.id}
                      node={selected}
                      nodes={nodes}
                      edges={edges}
                      readOnly={Boolean(viewingRun)}
                      onChange={(patch) => editNode(selected.id, patch)}
                    />
                  )}
                  <NodeInterface
                    node={selected}
                    nodes={nodes}
                    edges={edges}
                    onInspect={inspectNode}
                  />
                  {selected.type === "dataset" && (
                    <RecordInputs
                      records={selected.data.records || []}
                      readOnly={Boolean(viewingRun)}
                      onChange={(records) => editNode(selected.id, { records })}
                    />
                  )}
                  {selected.type === "video-generate" && (
                    <VideoGenerationControls
                      id={selected.id}
                      data={selected.data}
                      providers={providers}
                      readOnly={Boolean(viewingRun)}
                      editNode={editNode}
                      chooseProvider={chooseProvider}
                      plan={plan}
                    />
                  )}
                  {selected.type === "generate" && (
                    <>
                      <GenerationModes
                        id={selected.id}
                        data={selected.data}
                        kind="image"
                        providers={providers}
                        readOnly={Boolean(viewingRun)}
                        editNode={editNode}
                        plan={plan}
                      />
                      <label>
                        Additional art direction
                        <textarea
                          readOnly={Boolean(viewingRun)}
                          value={selected.data.text || ""}
                          placeholder="Optional refinement for this branch…"
                          onChange={(e) =>
                            editNode(selected.id, { text: e.target.value })
                          }
                        />
                      </label>
                      <div className="property-estimate">
                        <Sparkles size={15} />
                        <span>
                          <strong>
                            {plan?.nodes?.[selected.id] || selected.data.count}{" "}
                            images
                          </strong>{" "}
                          in this branch
                        </span>
                      </div>
                      <button
                        className="primary-button"
                        disabled={Boolean(viewingRun) || starting}
                        onClick={() => runWorkflow(selected.id)}
                      >
                        <Play size={13} />
                        Run this node
                      </button>
                    </>
                  )}
                  {selected.type === "prompt-generate" && (
                    <>
                      <button
                        className="provider-property-button"
                        disabled={Boolean(viewingRun)}
                        onClick={() => chooseProvider(selected.id)}
                      >
                        <Terminal size={16} />
                        {providerName(selected.data.providerId || "codex-text")}
                        <ChevronDown size={13} />
                      </button>
                      <p className="provider-property-hint">
                        The result replaces incoming text and carries reference
                        images onward.
                      </p>
                      <label>
                        Instructions
                        <textarea
                          readOnly={Boolean(viewingRun)}
                          rows="8"
                          value={selected.data.text || ""}
                          onChange={(e) =>
                            editNode(selected.id, { text: e.target.value })
                          }
                        />
                      </label>
                      <button
                        className="primary-button"
                        disabled={Boolean(viewingRun) || starting}
                        onClick={() => runWorkflow(selected.id)}
                      >
                        <Play size={13} />
                        Run this node
                      </button>
                    </>
                  )}
                  {selected.type === "image" && (
                    <button
                      className="secondary-button"
                      disabled={Boolean(viewingRun)}
                      onClick={() => uploadImages(selected.id)}
                    >
                      <Upload size={14} />
                      Replace reference images
                    </button>
                  )}
                  <div className="property-actions">
                    <button
                      disabled={Boolean(viewingRun)}
                      onClick={() => duplicateNode(selected.id)}
                    >
                      <Copy size={14} />
                      Duplicate
                    </button>
                    <button
                      disabled={Boolean(viewingRun)}
                      onClick={() => deleteNode(selected.id)}
                    >
                      <Trash2 size={14} />
                      Delete node
                    </button>
                  </div>
                </div>
              ) : (
                <div className="no-runs">
                  <MousePointer2 size={24} />
                  <strong>Select a node</strong>
                </div>
              )}
            </aside>
          </div>
        </div>
        {menu && (
          <div
            className="node-context-menu floating-panel"
            style={{
              left: Math.min(
                window.innerWidth - 195,
                (document
                  .querySelector(`[data-id="${CSS.escape(menu)}"]`)
                  ?.getBoundingClientRect().right || window.innerWidth / 2) -
                  40,
              ),
              top: Math.min(
                window.innerHeight - 170,
                (document
                  .querySelector(`[data-id="${CSS.escape(menu)}"]`)
                  ?.getBoundingClientRect().top || 200) + 30,
              ),
            }}
          >
            <button
              onClick={() => {
                inspectNode(menu);
                setMenu(null);
              }}
            >
              <Settings2 size={14} />
              Properties
            </button>
            <button
              disabled={Boolean(viewingRun)}
              onClick={() => duplicateNode(menu)}
            >
              <Copy size={14} />
              Duplicate <kbd>⌘D</kbd>
            </button>
            <button
              disabled={Boolean(viewingRun)}
              onClick={() => deleteNode(menu)}
              className="danger"
            >
              <Trash2 size={14} />
              Delete <kbd>⌫</kbd>
            </button>
          </div>
        )}
        {modal && (
          <div className="modal-backdrop" onClick={() => setModal(null)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={
                modal === "providers"
                  ? "Choose a provider"
                  : modal === "cli"
                    ? "Run from your terminal"
                    : modal === "add"
                      ? "Add a node"
                      : "Keyboard shortcuts"
              }
              className={cls("modal", modal === "add" && "add-modal")}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-top">
                <div className="modal-icon">
                  {modal === "cli" ? (
                    <Terminal size={21} />
                  ) : modal === "add" ? (
                    <Plus size={21} />
                  ) : modal === "providers" ? (
                    <Layers size={21} />
                  ) : (
                    <Settings2 size={21} />
                  )}
                </div>
                <IconButton label="Close dialog" onClick={() => setModal(null)}>
                  <X size={20} />
                </IconButton>
              </div>
              {modal === "providers" ? (
                <ProviderPicker
                  usage={harnessUsage}
                  providers={providers}
                  operation={
                    generationKind(
                      nodes.find((n) => n.id === providerTarget)?.type,
                    ) || "image"
                  }
                  current={
                    nodes.find((n) => n.id === providerTarget)?.data
                      .providerId || "codex"
                  }
                  onChoose={(provider) => {
                    const node = nodes.find((n) => n.id === providerTarget);
                    const model = modelsFor(
                      provider,
                      generationKind(node?.type) || "image",
                    )[0];
                    editNode(providerTarget, {
                      providerId: provider.id,
                      ...(provider.kind === "fal"
                        ? falDefaults(falModel(model))
                        : provider.id === "grok-image"
                          ? { quality: "medium", image: { resolution: "1k" } }
                          : provider.id === "grok-video"
                            ? {
                                video: {
                                  resolution: "720p",
                                  durationSeconds: 8,
                                },
                              }
                            : {}),
                      model,
                      ratio: provider.ratios.includes(node?.data.ratio || "1:1")
                        ? node?.data.ratio || "1:1"
                        : provider.ratios[0],
                    });
                    setModal(null);
                  }}
                />
              ) : modal === "cli" ? (
                <AgentAccess
                  recordedRun={viewingRun}
                  workflow={workflow}
                  project={projects.find((p) => p.id === workflow?.projectId)}
                  concurrency={concurrency}
                  notify={notify}
                />
              ) : modal === "add" ? (
                <>
                  <h2>Add node</h2>
                  <label className="search-field add-search">
                    <Search size={15} />
                    <input
                      autoFocus
                      aria-label="Find a node or model"
                      placeholder="Search nodes, providers, models…"
                      value={nodeSearch}
                      onChange={(e) => setNodeSearch(e.target.value)}
                    />
                  </label>
                  <div className="add-node-grid">
                    {Object.keys(nodeTypes)
                      .filter((type) =>
                        nodeNames[type]
                          .toLowerCase()
                          .includes(nodeSearch.toLowerCase()),
                      )
                      .map((type) => {
                        const Icon = icons[type];
                        return (
                          <button
                            key={type}
                            disabled={Boolean(viewingRun) || !workflow}
                            onClick={() => addNode(type)}
                          >
                            <Icon size={23} />
                            <strong>{nodeNames[type]}</strong>
                            <Plus size={15} />
                          </button>
                        );
                      })}
                  </div>
                  <div className="provider-add-heading">MODELS & HARNESSES</div>
                  {providers
                    .filter((p) =>
                      `${p.name} ${p.models.join(" ")}`
                        .toLowerCase()
                        .includes(nodeSearch.toLowerCase()),
                    )
                    .map((p) => (
                      <button
                        className="provider-add-row"
                        key={p.id}
                        disabled={
                          (!p.ready &&
                            !p.capabilities?.includes("video") &&
                            p.kind !== "grok") ||
                          Boolean(viewingRun)
                        }
                        onClick={() =>
                          addNode(nodeForProvider(p), undefined, {
                            label: p.name,
                            providerId: p.id,
                            model: modelsFor(
                              p,
                              generationKind(nodeForProvider(p)),
                            )[0],
                          })
                        }
                      >
                        <HarnessLogo id={p.id} size={16} />
                        {p.name}
                        <small>
                          {p.kind === "codex"
                            ? "ChatGPT"
                            : ["command", "harness"].includes(p.kind)
                              ? "Local"
                              : "API"}
                        </small>
                        <Plus size={14} />
                      </button>
                    ))}
                </>
              ) : (
                <>
                  <h2>Keyboard shortcuts</h2>
                  <div className="shortcut-list">
                    {[
                      ["Add a node", "Tab"],
                      ["Pan the canvas", "Hold Space"],
                      ["Undo / redo", "⌘ Z / ⌘ ⇧ Z"],
                      ["Save workflow", "⌘ S"],
                      ["Select all nodes", "⌘ A"],
                      ["Copy / paste selection", "⌘ C / ⌘ V"],
                      ["Duplicate selection", "⌘ D"],
                      ["Delete selection", "⌫"],
                      ["Fit all nodes", "Shift 1"],
                      ["Run workflow", "⌘ Enter"],
                      ["Close panels", "Esc"],
                    ].map(([label, key]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <kbd>{key}</kbd>
                      </div>
                    ))}
                  </div>
                  <div className="modal-note">
                    <Link2 size={16} />
                    <span>
                      Drag between matching sockets to connect nodes. Click a
                      node to inspect its inputs and outputs. Double-click a
                      connection to remove it.
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {editingImage && (
          <ImageEditor
            key={editingImage.editorId || editingImage.output}
            image={editingImage}
            providers={providers}
            onEditVariation={(image) => setEditingImage(image)}
            onAgentHost={setAgentHost}
            onAgentContext={setEditorAgentContext}
            onClose={() => setEditingImage(null)}
            onOpenWorkflow={async (graph) => {
              setEditingImage(null);
              setInspectedImage(null);
              await openSavedWorkflow(graph);
            }}
          />
        )}
        {inspectedImage && !editingImage && (
          <ImageTray
            image={inspectedImage}
            onClose={() => setInspectedImage(null)}
            onSelect={openImage}
            providerName={providerName}
            onEdit={(image) => {
              if (mediaKind(image) !== "image") return;
              setActiveWorkspacePanel(null);
              setEditingImage({
                ...image,
                projectId: image.projectId || workflow?.projectId,
              });
            }}
            onUseSeed={(image) => {
              if (mediaKind(image) !== "image") return;
              if (viewingRun) {
                notify("Fork this recorded run before adding a seed.");
                return;
              }
              checkpoint();
              const center = flow.screenToFlowPosition({
                x: window.innerWidth / 2,
                y: window.innerHeight / 2,
              });
              setNodes((ns) => [
                ...ns,
                {
                  id: crypto.randomUUID(),
                  type: "image",
                  position: center,
                  data: { label: "New seed", images: [image.output] },
                },
              ]);
              setInspectedImage(null);
              setView("canvas");
              notify("Image added to canvas as a new seed");
            }}
          />
        )}
        <AgentDock
          context={agentContext}
          contextLabel={agentContextLabel}
          projectId={agentProjectId || undefined}
          providers={providers}
          controls={view === "canvas" && !editingImage ? canvasControls : null}
          host={agentHost}
          onPrepare={prepareAgentContext}
          onApply={reconcileAgentChange}
          onUndo={(client, sessionId, turn) =>
            reconcileAgentChange(client, sessionId, turn, "undo")
          }
          onFocus={inspectNode}
          onStreamSession={setAgentStream}
        />
        {view === "canvas" &&
          runFailure?.canvas === canvasIdentity({ workflow, viewingRun }) && (
            <RunFailure
              error={runFailure.error}
              onDismiss={() => setRunFailure(null)}
              onSettings={(section) => {
                setRunFailure(null);
                openSettings(section);
              }}
            />
          )}
        {toast && (
          <div
            role={toast.type === "error" ? "alert" : "status"}
            className={cls("toast", toast.type === "error" && "error")}
          >
            {toast.type === "error" ? (
              <AlertCircle size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)}>
              <X size={13} />
            </button>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        <input
          ref={importInput}
          type="file"
          accept="application/json,.flow.json,.flow,.json"
          hidden
          onChange={(e) =>
            e.target.files[0] && importWorkflow(e.target.files[0])
          }
        />
      </div>
    </StudioContext.Provider>
  );
}
