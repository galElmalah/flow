import React from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { outputType } from "../../shared/graph.mjs";
import {
  describeField,
  nodeInterfaces,
  templateParameters,
} from "../../shared/inspection.mjs";

export function NodeExplanation({ type }) {
  const definition = nodeInterfaces[type];
  if (!definition) return null;
  return (
    <div className="node-explanation" aria-label="About this node">
      <p className="inspector-description">{definition.description}</p>
      <p className="inspector-example">
        <span>Example</span>
        {definition.example}
      </p>
    </div>
  );
}

export function NodeInterface({ node, nodes, edges, onInspect }) {
  const definition = nodeInterfaces[node.type];
  if (!definition) return null;
  const parameters = ["template", "prompt-set"].includes(node.type)
    ? templateParameters(node.data.text)
    : [];
  const ports = (direction) =>
    definition[direction].map((port) => {
      const links = edges.filter((e) =>
        direction === "inputs"
          ? e.target === node.id &&
            outputType(nodes.find((n) => n.id === e.source)?.type) === port.type
          : e.source === node.id,
      );
      return (
        <div className="inspector-port" key={port.type}>
          <h4>
            {port.label}
            <span>{port.type}</span>
          </h4>
          <p>{port.description}</p>
          {links.length ? (
            <div className="inspector-connections">
              {links.map((edge) => {
                const peer = nodes.find(
                  (n) =>
                    n.id ===
                    (direction === "inputs" ? edge.source : edge.target),
                );
                return (
                  peer && (
                    <button
                      key={edge.id}
                      onClick={() => onInspect(peer.id)}
                      aria-label={`Inspect ${peer.data.label} ${direction === "inputs" ? "input" : "output"}`}
                    >
                      {direction === "inputs" ? (
                        <ArrowDownLeft size={12} />
                      ) : (
                        <ArrowUpRight size={12} />
                      )}
                      {peer.data.label}
                    </button>
                  )
                );
              })}
            </div>
          ) : (
            <small>
              {direction === "inputs"
                ? port.type === "image"
                  ? "No direct image connection. Upstream text may also carry references."
                  : "No connection"
                : "No downstream connection"}
            </small>
          )}
        </div>
      );
    });
  return (
    <div className="node-interface">
      {definition.inputs.length > 0 && (
        <section aria-label="Node inputs">
          <h3>Inputs</h3>
          {ports("inputs")}
        </section>
      )}
      {parameters.length > 0 && (
        <section aria-label="Template inputs">
          <h3>Template inputs</h3>
          <dl className="template-input-descriptions">
            {parameters.map((field) => (
              <div key={field}>
                <dt>{`{{${field}}}`}</dt>
                <dd>{describeField(field)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {definition.outputs.length > 0 && (
        <section aria-label="Node outputs">
          <h3>Outputs</h3>
          {ports("outputs")}
        </section>
      )}
      {node.type === "filter" && (
        <p className="inspector-filter-rule">
          Keep <code>{node.data.filterField || "—"}</code> equal to{" "}
          {(node.data.filterValues || []).join(" or ") || "—"}.
        </p>
      )}
    </div>
  );
}
