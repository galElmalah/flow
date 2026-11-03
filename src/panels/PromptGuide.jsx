import React from "react";
import { ArrowUpRight, FileText, Image, Layers } from "lucide-react";
import { promptGuide } from "../../shared/prompt-guide.mjs";

export function PromptGuide({ graph, plan, onInspect }) {
  const guide = promptGuide(graph, plan);
  return (
    <div className="prompt-guide" aria-label="Prompt map">
      <section>
        <h3>1 · Your starting prompt</h3>
        {guide.starts.length ? (
          guide.starts.map((source) => (
            <button
              className="prompt-source-card"
              key={source.id}
              onClick={() => onInspect(source.id)}
            >
              <span>
                {source.kind}
                <ArrowUpRight size={13} />
              </span>
              <strong>{source.label}</strong>
              <small>{source.description}</small>
            </button>
          ))
        ) : (
          <p>Add a Prompt node and connect it to Image generation.</p>
        )}
        {guide.optional.map((source) => (
          <details key={source.id} className="prompt-optional">
            <summary>{source.label} · empty</summary>
            <p>{source.description}</p>
            <button onClick={() => onInspect(source.id)}>
              Add optional direction <ArrowUpRight size={12} />
            </button>
          </details>
        ))}
      </section>
      <section>
        <h3>2 · Records & reference images</h3>
        <p>
          Each record gets its own image. Reference images guide the visual
          style.
        </p>
        {guide.sources.map((source) => (
          <button
            className="prompt-source-link"
            key={source.id}
            onClick={() => onInspect(source.id)}
          >
            {source.type === "dataset" ? (
              <FileText size={14} />
            ) : (
              <Image size={14} />
            )}
            <span>
              {source.data.label}
              <small>
                {source.type === "dataset"
                  ? `${source.data.records?.length || 0} records`
                  : `${source.data.images?.length || 0} references`}
              </small>
            </span>
            <ArrowUpRight size={12} />
          </button>
        ))}
      </section>
      <section>
        <h3>3 · Follow a flow</h3>
        <p>
          Templates fill record fields. AI scene writers expand the brief. Image
          generators create the artwork.
        </p>
        {guide.flows.map((flow, index) => (
          <details className="prompt-flow" key={flow.id} open={index === 0}>
            <summary>
              <Layers size={14} />
              <span>
                {flow.label}
                <small>
                  {flow.textJobs === null
                    ? "Plan appears when the workflow is ready"
                    : `${flow.textJobs} prompt jobs → ${flow.imageJobs} images`}
                </small>
              </span>
            </summary>
            <ol>
              {flow.steps.map((step) => (
                <li key={step.id}>
                  <button onClick={() => onInspect(step.id)}>
                    <small>{step.kind}</small>
                    <span>{step.label}</span>
                    <ArrowUpRight size={12} />
                  </button>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </section>
      <p className="prompt-guide-note">
        Edit the base prompt for shared style. Edit a record for one scene. Run
        a collection node for just that flow; Run workflow runs every flow.
      </p>
    </div>
  );
}
