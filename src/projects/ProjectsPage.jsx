import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Archive,
  FolderOpen,
  Plus,
  Search,
  X,
  LoaderCircle,
  RotateCcw,
  Star,
  RefreshCw,
} from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { IconButton } from "../components/IconButton.jsx";
import { jsonRequest } from "../studio/ui.mjs";
import { ProjectLocation } from "./ProjectLocation.jsx";
import "./projects-page.css";

const normalized = (value) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
const matches = (text, query) =>
  normalized(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => normalized(text).includes(word));
export function ProjectsPage({
  initialProjectId,
  onOpen,
  onNew,
  onChanged,
  onSelectProject,
}) {
  const [projects, setProjects] = useState([]),
    [workflows, setWorkflows] = useState([]);
  const [selected, setSelected] = useState(initialProjectId || null),
    [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(null),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [root, setRoot] = useState("");
  useEffect(() => setSelected(initialProjectId || null), [initialProjectId]);
  useEffect(() => {
    onSelectProject?.(selected && selected !== "unassigned" ? selected : null);
  }, [selected, onSelectProject]);
  const refresh = async () => {
    setError("");
    setLoading(true);
    try {
      const [p, w] = await Promise.all([
        jsonRequest(`/api/projects${archived ? "?archived=all" : ""}`),
        jsonRequest(
          `/api/workflows?summary=1&archived=${archived ? "archived" : "active"}`,
        ),
      ]);
      setProjects(p);
      setWorkflows(w);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      jsonRequest(`/api/projects${archived ? "?archived=all" : ""}`),
      jsonRequest(
        `/api/workflows?summary=1&archived=${archived ? "archived" : "active"}`,
      ),
    ])
      .then(([p, w]) => {
        if (live) {
          setProjects(p);
          setWorkflows(w);
          setError("");
        }
      })
      .catch((err) => live && setError(err.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [archived]);
  const action = async (key, callback) => {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await callback();
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const project =
    selected === "unassigned"
      ? { id: "unassigned", name: "Unassigned", root: "", archived: false }
      : projects.find((p) => p.id === selected);
  const owned = workflows.filter(
    (w) => (w.projectId || "unassigned") === selected,
  );
  const visibleWorkflows = owned.filter((w) =>
    matches(`${w.name} ${project?.name || ""} ${project?.root || ""}`, query),
  );
  const cards = projects
    .filter((p) => p.kind !== "library")
    .map((p) => ({
      ...p,
      workflowCount: workflows.filter((w) => w.projectId === p.id).length,
    }));
  const unassigned = workflows.filter((w) => !w.projectId);
  if (unassigned.length)
    cards.push({
      id: "unassigned",
      name: "Unassigned",
      root: "Workflows without a project",
      workflowCount: unassigned.length,
      imageCount: null,
      archived: false,
    });
  const visible = cards
    .filter(
      (p) =>
        (!archived || p.archived || p.workflowCount) &&
        matches(
          `${p.name} ${p.id} ${p.root} ${workflows
            .filter((w) => (w.projectId || "unassigned") === p.id)
            .map((w) => w.name)
            .join(" ")}`,
          query,
        ),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : (b.lastActivityAt || "").localeCompare(a.lastActivityAt || ""),
    );
  const archiveWorkflow = (w) =>
    action(w.id, () =>
      jsonRequest("/api/workflows/archive", {
        method: "POST",
        body: JSON.stringify({ ids: [w.id], archived: !archived }),
      }),
    );
  return (
    <section className="projects-page" aria-label="Projects">
      <header className="projects-heading">
        <div>
          {project && (
            <button
              className="projects-back"
              onClick={() => {
                setSelected(null);
                setQuery("");
              }}
            >
              <ArrowLeft size={14} /> All projects
            </button>
          )}
          <h1>{project ? project.name : "Projects"}</h1>
          {project && <ProjectLocation path={project.root} />}
        </div>
        <div className="projects-heading-actions">
          <IconButton
            label="Refresh projects"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={16} />
          </IconButton>
          {project && !archived && project.id !== "unassigned" && (
            <button
              className="projects-primary"
              onClick={() => onNew(project.id)}
            >
              <Plus size={14} /> New workflow
            </button>
          )}
          {!project && !archived && (
            <button
              className="projects-primary"
              onClick={() => setCreating(!creating)}
            >
              <Plus size={14} /> New project
            </button>
          )}
          {project &&
            project.id !== "unassigned" &&
            (!archived || project.archived) && (
              <button
                className="projects-secondary"
                disabled={!!busy}
                onClick={() =>
                  action(project.id, async () => {
                    await jsonRequest(
                      `/api/projects/${encodeURIComponent(project.id)}/archive`,
                      {
                        method: "POST",
                        body: JSON.stringify({ archived: !project.archived }),
                      },
                    );
                    setSelected(null);
                  })
                }
              >
                {project.archived ? (
                  <RotateCcw size={14} />
                ) : (
                  <Archive size={14} />
                )}{" "}
                {project.archived ? "Restore project" : "Archive project"}
              </button>
            )}
        </div>
      </header>
      <div className="projects-filters">
        <label className="projects-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search projects and workflows"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              project
                ? "Search workflows…"
                : "Search projects, workflows, or folders…"
            }
          />
          {query && (
            <button
              aria-label="Clear project search"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <Autocomplete
          label="Sort projects"
          value={sort}
          options={[
            { value: "recent", label: "Recent activity" },
            { value: "name", label: "Name A–Z" },
          ]}
          onChange={setSort}
        />
        <button
          className={`projects-archive-toggle ${archived ? "is-active" : ""}`}
          aria-pressed={archived}
          onClick={() => {
            setArchived(!archived);
            setSelected(null);
            setQuery("");
          }}
        >
          <Archive size={14} />
          {archived ? "View active" : "Archived"}
        </button>
      </div>
      {creating && (
        <form
          className="project-register"
          onSubmit={(e) => {
            e.preventDefault();
            action("create", async () => {
              await jsonRequest("/api/projects", {
                method: "POST",
                body: JSON.stringify({ name, root }),
              });
              setName("");
              setRoot("");
              setCreating(false);
            });
          }}
        >
          <label>
            Project name
            <input
              aria-label="Project name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Local folder
            <input
              aria-label="Project folder"
              required
              placeholder="/absolute/path/to/project"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
            />
          </label>
          <button className="projects-primary" disabled={!!busy}>
            Create project
          </button>
          <button
            type="button"
            className="projects-secondary"
            onClick={() => setCreating(false)}
          >
            Cancel
          </button>
        </form>
      )}
      {error && (
        <div className="projects-error" role="alert">
          {error}
          <button onClick={refresh}>Retry</button>
        </div>
      )}
      {loading ? (
        <div className="projects-empty" role="status">
          <LoaderCircle className="spin" size={24} /> Loading projects…
        </div>
      ) : project ? (
        <div className="project-workflows">
          {visibleWorkflows.map((w) => (
            <article key={w.id}>
              <button
                className="project-workflow-open"
                onClick={() => !archived && onOpen(w)}
                disabled={archived}
              >
                <FolderOpen size={20} />
                <span>
                  <strong>{w.name}</strong>
                  <small>
                    {w.nodeCount} nodes{" "}
                    {project.defaultWorkflowId === w.id
                      ? "· Default workflow"
                      : ""}
                  </small>
                </span>
                {!archived && <ArrowUpRight size={16} />}
              </button>
              <div className="project-workflow-actions">
                {!archived &&
                  project.id !== "unassigned" &&
                  project.defaultWorkflowId !== w.id && (
                    <IconButton
                      label={`Make ${w.name} the default`}
                      onClick={() =>
                        action(w.id, () =>
                          jsonRequest(`/api/projects/${project.id}`, {
                            method: "PUT",
                            body: JSON.stringify({ defaultWorkflowId: w.id }),
                          }),
                        )
                      }
                      disabled={!!busy}
                    >
                      <Star size={14} />
                    </IconButton>
                  )}
                <button
                  className="projects-secondary"
                  disabled={
                    !!busy ||
                    (!archived && project.defaultWorkflowId === w.id) ||
                    project.archived
                  }
                  title={
                    project.archived
                      ? "Restore the project first"
                      : project.defaultWorkflowId === w.id
                        ? "Choose another default before archiving"
                        : undefined
                  }
                  onClick={() => archiveWorkflow(w)}
                >
                  {archived ? <RotateCcw size={14} /> : <Archive size={14} />}{" "}
                  {archived ? "Restore" : "Archive"}
                </button>
              </div>
            </article>
          ))}
          {!visibleWorkflows.length && (
            <div className="projects-empty">
              <FolderOpen size={28} />
              <h2>
                {query
                  ? "No matching workflows"
                  : archived
                    ? "No archived workflows"
                    : "No workflows yet"}
              </h2>
              {!archived && project.id !== "unassigned" && (
                <button
                  className="projects-primary"
                  onClick={() => onNew(project.id)}
                >
                  Create a workflow
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="projects-grid">
          {visible.map((p) => (
            <article className="project-card" key={p.id}>
              <button
                className="project-card-open"
                onClick={() => {
                  setSelected(p.id);
                  setQuery("");
                }}
              >
                <div className="project-card-cover">
                  {p.cover && !archived ? (
                    <img
                      src={p.cover}
                      alt={`${p.name} artwork`}
                      loading="lazy"
                    />
                  ) : (
                    <FolderOpen size={38} />
                  )}
                </div>
                <div className="project-card-body">
                  <div>
                    <h2>{p.name}</h2>
                    <ArrowUpRight size={16} />
                  </div>
                  <footer>
                    <span>
                      {p.workflowCount}{" "}
                      {p.workflowCount === 1 ? "workflow" : "workflows"}
                    </span>
                    {!archived && p.imageCount != null && (
                      <span>{p.imageCount} images</span>
                    )}
                    {!archived && p.videoCount > 0 && (
                      <span>{p.videoCount} videos</span>
                    )}
                    {p.archived && <span>Archived project</span>}
                  </footer>
                </div>
              </button>
              {p.id !== "unassigned" && <ProjectLocation path={p.root} />}
            </article>
          ))}
          {!visible.length && (
            <div className="projects-empty">
              <Search size={25} />
              <h2>
                {query
                  ? "No matching projects"
                  : archived
                    ? "No archived projects"
                    : "Create your first project"}
              </h2>
              <p>
                {query
                  ? "Try a project name, workflow, or folder."
                  : archived
                    ? "Archived items can be restored here."
                    : "Link a local folder to keep its workflows together."}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
