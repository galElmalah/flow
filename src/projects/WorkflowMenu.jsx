import { Autocomplete } from "../components/Autocomplete.jsx";
import React, { useState } from "react";
import {
  Workflow,
  Check,
  Plus,
  Copy,
  Download,
  Upload,
  FolderOpen,
} from "lucide-react";

export function WorkflowMenu({
  workflows,
  workflow,
  projects,
  onLoad,
  onProjects,
  onNew,
  onFork,
  onExport,
  onImport,
  onAssign,
  onCreateProject,
  readOnly = false,
}) {
  const [filter, setFilter] = useState(
    workflow?.projectId ? `project:${workflow.projectId}` : "all",
  );
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const visible = workflows.filter(
    (g) =>
      filter === "all" ||
      (filter === "unassigned"
        ? !g.projectId
        : g.projectId === filter.slice("project:".length)),
  );
  const project = projects.find((p) => p.id === workflow?.projectId);
  return (
    <div
      className="workflow-menu floating-panel"
      id="workflow-menu"
      role="dialog"
      aria-label="Projects and workflows"
    >
      <div className="panel-eyebrow">
        LOCAL PROJECTS <span>{projects.length} registered</span>
      </div>
      <label className="project-field">
        <span>Browse project</span>
        <Autocomplete
          label="Browse project"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All local projects" },
            { value: "unassigned", label: "Unassigned workflows" },
            ...projects.map((p) => ({
              value: `project:${p.id}`,
              label: p.name,
            })),
          ]}
        />
      </label>
      <div className="workflow-list">
        {visible.map((g) => (
          <button key={g.id} onClick={() => onLoad(g)}>
            <Workflow size={15} />
            <span>
              {g.name}
              <small>
                {projects.find((p) => p.id === g.projectId)?.name ||
                  "Unassigned"}
              </small>
            </span>
            {g.id === workflow?.id && <Check size={14} />}
          </button>
        ))}
        {!visible.length && (
          <p className="project-empty">No workflows in this project yet.</p>
        )}
      </div>
      {workflow && (
        <div className="workflow-project-details">
          <label className="project-field">
            <span>This workflow belongs to</span>
            <Autocomplete
              label="Workflow project"
              value={workflow.projectId || ""}
              disabled={assigning || readOnly}
              options={[
                { value: "", label: "Unassigned" },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={async (value) => {
                setAssigning(true);
                try {
                  await onAssign(value || null);
                } finally {
                  setAssigning(false);
                }
              }}
            />
          </label>
          {project && (
            <>
              <code title={project.root}>{project.root}</code>
              <span className="project-platform">
                Generation via Flow · local platform
              </span>
            </>
          )}
          {workflow.forkedFrom && (
            <div className="fork-provenance">
              Forked from {workflow.forkedFrom.name}
            </div>
          )}
        </div>
      )}
      <div className="divider" />
      {onProjects && (
        <button onClick={onProjects}>
          <FolderOpen size={15} /> All projects
        </button>
      )}
      <button
        onClick={() =>
          onNew(
            filter === "unassigned"
              ? null
              : filter === "all"
                ? undefined
                : filter.slice("project:".length),
          )
        }
      >
        <Plus size={15} />
        New workflow
      </button>
      <button onClick={onFork}>
        <Copy size={15} />
        Fork workflow
      </button>
      <button onClick={onExport}>
        <Download size={15} />
        Export workflow
      </button>
      <button onClick={onImport}>
        <Upload size={15} />
        Import workflow
      </button>
      <button onClick={() => setCreating((x) => !x)} aria-expanded={creating}>
        <FolderOpen size={15} />
        Register local project
      </button>
      {creating && (
        <form
          className="project-create"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setSaving(true);
            try {
              const p = await onCreateProject({ name, root });
              setFilter(`project:${p.id}`);
              setCreating(false);
              setName("");
              setRoot("");
            } catch (error) {
              setError(error.message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            Project name
            <input
              aria-label="Local project name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Local folder
            <input
              aria-label="Local project folder"
              required
              placeholder="/absolute/path/to/project"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
            />
          </label>
          <p>
            Links workflows to this folder. Harness jobs keep their isolated
            working directories.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="secondary-button" disabled={saving}>
            {saving ? "Registering…" : "Register project"}
          </button>
        </form>
      )}
    </div>
  );
}
