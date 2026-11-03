import React from "react";
import { Copy, FolderOpen } from "lucide-react";

export function AgentAccess({
  workflow,
  project,
  concurrency,
  notify,
  recordedRun,
}) {
  const projectId = recordedRun ? recordedRun.projectId : workflow?.projectId;
  const workflowId = recordedRun?.workflowId || workflow?.id;
  const scope = projectId ? ` --project ${projectId}` : "";
  const recorded = recordedRun ? ` --run ${recordedRun.id}` : "";
  const fork = `node cli/flow.mjs fork ${workflowId}${recorded}${scope} --json`;
  const target = recordedRun ? "FORK_ID" : workflowId;
  const plan = `node cli/flow.mjs plan --workflow ${target}${scope} --json`;
  const run = `node cli/flow.mjs run --workflow ${target}${scope} --concurrency ${concurrency} --wait --json`;
  const commands = [recordedRun && fork, plan, run].filter(Boolean).join("\n");
  const viewer = `node cli/flow.mjs open ${workflowId}${recorded}${recordedRun ? " --gallery" : ""}${scope}`;
  return (
    <>
      <h2>Agent access</h2>
      {recordedRun ? (
        <p>
          Fork this recorded run, then replace FORK_ID with the returned
          workflow ID.
        </p>
      ) : !project ? (
        <p>Assign a project from the workflow menu, or run it unassigned.</p>
      ) : null}
      <div className="code-block">
        <div>
          <span>
            {recordedRun
              ? "FORK RECORDED GRAPH, PLAN, THEN RUN"
              : "PLAN, THEN RUN"}
          </span>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(commands);
                notify("Commands copied");
              } catch {
                notify(
                  "Could not copy commands. Select the text and copy it manually.",
                  "error",
                );
              }
            }}
          >
            <Copy size={14} />
            Copy
          </button>
        </div>
        <code>
          {recordedRun && (
            <>
              {fork}
              <br />
              <br />
            </>
          )}
          {plan}
          <br />
          <br />
          {run}
        </code>
      </div>
      {project && (
        <div className="cli-alternative">
          <strong>Project folder</strong>
          <code>{project.root}</code>
          <p>
            A .weft-project.json manifest lets agents discover the local
            platform, project and default workflow from this folder or its
            children.
          </p>
        </div>
      )}
      <div className="cli-alternative">
        <strong>
          {recordedRun ? "Open this recorded run" : "Open this workflow"}
        </strong>
        <code>
          {viewer}
          <br />
          {viewer} --print-url --json
        </code>
        <p>
          Add --node NODE_ID to jump directly to the prompt editor, or --run
          RUN_ID --gallery to inspect a recorded run.
        </p>
      </div>
      <div className="cli-alternative">
        <strong>MCP for agents</strong>
        <code>node cli/flow.mjs mcp{scope}</code>
        <p>
          Stdio tools create, fork, plan, run, inspect and search workflows
          through the same local platform. Setup: docs/mcp.md.
        </p>
      </div>
      <div className="cli-alternative">
        <strong>Discover, create or fork</strong>
        <code>
          node cli/flow.mjs guide --json
          <br />
          node cli/flow.mjs schema --json
          <br />
          {fork}
        </code>
        <p>
          The client/ folder contains the JavaScript client and workflow
          builder. Start with AGENTS.md for the source map and docs/agents.md
          for task recipes.
        </p>
      </div>
      <div className="modal-note">
        <FolderOpen size={15} />
        <span>
          Run these commands from the <strong>weft</strong> folder, or invoke
          its CLI by absolute path from your local project.
        </span>
      </div>
    </>
  );
}
