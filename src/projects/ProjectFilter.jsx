import { Autocomplete } from "../components/Autocomplete.jsx";
import React from "react";
export const projectScope = (projectId) =>
  projectId ? `project:${projectId}` : "unassigned";
export const matchesProject = (item, scope) =>
  scope === "all" ||
  (scope === "unassigned"
    ? !item.projectId
    : scope.startsWith("workflow:")
      ? item.workflowId === scope.slice("workflow:".length)
      : item.projectId === scope.slice("project:".length));
export function ProjectFilter({ projects, workflow, value, onChange, label }) {
  return (
    <Autocomplete
      label={label}
      value={value}
      onChange={onChange}
      options={[
        ...(workflow
          ? [
              {
                value: `workflow:${workflow.id}`,
                label: "This workflow · all history",
              },
            ]
          : []),
        { value: "all", label: "All local projects" },
        { value: "unassigned", label: "Unassigned" },
        ...projects.map((p) => ({ value: projectScope(p.id), label: p.name })),
      ]}
    />
  );
}
