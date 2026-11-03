import React from "react";
import { ArrowLeft, Settings2, Cpu, Scan, PlugZap } from "lucide-react";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { ProvidersSettings } from "./ProvidersSettings.jsx";
import { ProjectLocation } from "../projects/ProjectLocation.jsx";
import { SamSettings } from "./SamSettings.jsx";
import { LocalModelsSettings } from "./LocalModelsSettings.jsx";
import "./settings.css";

const sections = [
  { id: "workspace", label: "Workspace", icon: Settings2 },
  { id: "providers", label: "Providers", icon: PlugZap },
  { id: "local-models", label: "Local models", icon: Cpu },
  { id: "image-tools", label: "Image tools", icon: Scan },
];
export function SettingsPage({
  section,
  onSection,
  onBack,
  providers,
  usage,
  onReload,
  onChange,
  concurrency,
  onConcurrency,
  health,
  onExample,
  projects,
}) {
  return (
    <section className="settings-page" aria-label="Settings">
      <aside className="settings-sidebar">
        <button className="settings-back" onClick={onBack}>
          <ArrowLeft size={15} /> Back to workspace
        </button>
        <h1>Settings</h1>
        <nav aria-label="Settings sections">
          {sections.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`/settings/${id}`}
              aria-current={section === id ? "page" : undefined}
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                onSection(id);
              }}
            >
              <Icon size={17} />
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="settings-content" key={section}>
        {section === "workspace" ? (
          <>
            <h2>Workspace</h2>
            <section className="settings-card">
              <h3>Parallel generation</h3>
              <p>New runs from this browser. Provider limits still apply.</p>
              <Autocomplete
                label="Default parallel jobs"
                value={concurrency}
                onChange={(value) => onConcurrency(Number(value))}
                options={[1, 2, 4, 8, 16, 32, 64, 128].map((value) => ({
                  value: String(value),
                  label: `${value} jobs at a time`,
                }))}
              />
            </section>
            <section className="settings-card">
              <h3>Local storage</h3>
              <dl className="settings-facts">
                <div>
                  <dt>Platform data</dt>
                  <dd>
                    <code>{health?.dataDirectory || "Loading…"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Database</dt>
                  <dd>SQLite · workflows, runs, projects, and editor state</dd>
                </div>
              </dl>
            </section>
            <section className="settings-card">
              <h3>Project locations</h3>
              {projects
                .filter((project) => project.kind !== "library")
                .map((project) => (
                  <div className="settings-project-location" key={project.id}>
                    <strong>{project.name}</strong>
                    <ProjectLocation path={project.root} />
                  </div>
                ))}
            </section>
          </>
        ) : section === "local-models" ? (
          <LocalModelsSettings onReload={onReload} />
        ) : section === "image-tools" ? (
          <SamSettings />
        ) : (
          <ProvidersSettings
            providers={providers}
            usage={usage}
            onReload={onReload}
            onChange={onChange}
            onExample={onExample}
            configPath={`${health?.dataDirectory || ".flow"}/providers.json`}
          />
        )}
      </div>
    </section>
  );
}
