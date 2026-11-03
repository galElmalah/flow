import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  projectIdSchema,
  projectInputSchema,
  projectUpdateSchema,
} from "../shared/projects.mjs";

function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

export class ProjectService {
  constructor(store) {
    this.store = store;
  }

  list({ search = "", archived = "active" } = {}) {
    const words = search
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return [...this.store.projects.values()]
      .filter(
        (project) =>
          archived === "all" ||
          this.store.isProjectArchived(project.id) ===
            (archived === "archived"),
      )
      .map((project) => {
        const workflows = this.store
          .listWorkflows(archived)
          .filter((graph) => graph.projectId === project.id);
        const runs = this.store
          .listRuns({ archived })
          .filter((run) => run.projectId === project.id);
        const images = runs.flatMap((run) =>
          run.jobs.filter(
            (job) =>
              job.status === "completed" &&
              (job.kind || "image") === "image" &&
              job.output,
          ),
        );
        return {
          ...project,
          archived: this.store.isProjectArchived(project.id),
          workflowCount: workflows.length,
          imageCount: images.length,
          videoCount: runs.reduce(
            (count, run) =>
              count +
              run.jobs.filter(
                (job) =>
                  job.kind === "video" &&
                  job.status === "completed" &&
                  job.output,
              ).length,
            0,
          ),
          cover: images[0]?.output || null,
          lastActivityAt: runs[0]?.createdAt || project.updatedAt,
          workflowNames: workflows.map((graph) => graph.name),
        };
      })
      .filter((project) =>
        words.every((word) =>
          `${project.name} ${project.id} ${project.root} ${project.workflowNames.join(" ")}`
            .normalize("NFKD")
            .replace(/\p{Diacritic}/gu, "")
            .toLowerCase()
            .includes(word),
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  archiveWorkflows(ids, archived, reason, projectId) {
    for (const id of ids) {
      const graph = this.store.workflows.get(id);
      if (!graph)
        throw Object.assign(new Error("Workflow not found."), { status: 404 });
      this.assertWorkflow(graph, projectId);
      if (archived) {
        if (
          this.store
            .listRuns()
            .some(
              (run) =>
                run.workflowId === id &&
                ["running", "paused"].includes(run.status),
            )
        )
          throw conflict("Stop the active run before archiving this workflow.");
        if (
          [...this.store.projects.values()].some(
            (project) => project.defaultWorkflowId === id,
          )
        )
          throw conflict(
            "Choose another project default before archiving this workflow.",
          );
      }
    }
    this.store.setArchived("workflow", ids, archived, reason);
    return { ids, archived };
  }
  archiveProject(id, archived, reason) {
    this.require(id);
    if (
      archived &&
      this.store
        .listRuns()
        .some(
          (run) =>
            run.projectId === id && ["running", "paused"].includes(run.status),
        )
    )
      throw conflict("Stop the active project runs before archiving.");
    this.store.setArchived("project", [id], archived, reason);
    return { ...this.require(id), archived };
  }
  assertActive(graph) {
    if (
      this.store.isWorkflowArchived(graph.workflowId || graph.id) ||
      this.store.isProjectArchived(graph.projectId)
    )
      throw conflict(
        "This workflow or project is archived. Restore it before editing or running.",
      );
  }

  filter(items, projectId) {
    if (projectId === undefined) return items;
    this.require(projectId);
    return items.filter((item) => item.projectId === projectId);
  }

  require(id) {
    projectIdSchema.parse(id);
    const project = this.store.projects.get(id);
    if (!project)
      throw Object.assign(new Error(`Project "${id}" is not registered.`), {
        status: 404,
      });
    return project;
  }

  async create(input) {
    const parsed = projectInputSchema.parse(input);
    if (!path.isAbsolute(parsed.root))
      throw new Error("Project root must be an absolute directory path.");
    const root = await realpath(parsed.root);
    if (!(await stat(root)).isDirectory())
      throw new Error("Project root must be an existing directory.");
    const previous = parsed.id
      ? this.store.projects.get(parsed.id)
      : [...this.store.projects.values()].find(
          (project) => project.root === root,
        );
    if (previous) {
      if (previous.root !== root)
        throw conflict("That project ID already belongs to another directory.");
      return { project: previous, created: false };
    }
    if ([...this.store.projects.values()].some((p) => p.root === root))
      throw conflict(
        "That directory is already registered as another project.",
      );
    const now = new Date().toISOString();
    const project = {
      ...parsed,
      id: parsed.id ?? randomUUID(),
      root,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveProject(project);
    return { project, created: true };
  }

  async update(id, input) {
    const current = this.require(id);
    const edit = projectUpdateSchema.parse(input);
    if (edit.defaultWorkflowId) {
      const workflow = this.store.workflows.get(edit.defaultWorkflowId);
      if (!workflow || workflow.projectId !== id)
        throw new Error("The default workflow must belong to this project.");
      this.assertActive(workflow);
    }
    const project = {
      ...current,
      ...edit,
      updatedAt: new Date().toISOString(),
    };
    if (project.defaultWorkflowId === null) delete project.defaultWorkflowId;
    await this.store.saveProject(project);
    return project;
  }

  assertWorkflow(graph, explicitProjectId) {
    if (graph.projectId) this.require(graph.projectId);
    if (explicitProjectId !== undefined) {
      if (explicitProjectId !== null) this.require(explicitProjectId);
      if ((graph.projectId || null) !== explicitProjectId)
        throw conflict(
          "Workflow ownership does not match the selected project.",
        );
    }
  }

  assertReassignment(graph) {
    for (const project of this.store.projects.values()) {
      if (
        project.defaultWorkflowId === graph.id &&
        graph.projectId !== project.id
      )
        throw conflict(
          "Choose another project default workflow before moving this workflow.",
        );
    }
  }
}
