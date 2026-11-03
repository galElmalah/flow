import React from "react";
import { Download, Check, LoaderCircle } from "lucide-react";
import "./sam-setup.css";

const bytes = (value) => `${(value / 1024 / 1024).toFixed(1)} MB`;
const stages = {
  runtime: "Creating Python runtime",
  dependencies: "Installing dependencies",
  download: "Downloading model weights",
  verification: "Verifying model loading",
};

export function SamSetup({
  model,
  busy,
  onSetup,
  details = false,
  editor = false,
}) {
  const installing = model?.status === "installing";
  return (
    <section className="sam-setup" aria-label="SAM model setup">
      <div className="sam-setup-heading">
        <div>
          <h3>SAM 2.1</h3>
          <p>{model?.model || "Reading local model…"}</p>
        </div>
        <span>
          {installing ? (
            <LoaderCircle size={14} className="spin" />
          ) : model?.ready ? (
            <Check size={14} />
          ) : null}
          {model?.ready
            ? "Ready"
            : installing
              ? "Setting up"
              : model?.status === "failed"
                ? "Setup failed"
                : model?.status === "incomplete"
                  ? "Incomplete"
                  : model
                    ? "Not installed"
                    : "Loading"}
        </span>
      </div>
      <div role="status" aria-live="polite">
        <strong>
          {installing
            ? stages[model.stage] || "Preparing installation"
            : model?.ready
              ? "Ready to segment images locally"
              : "Set up the runtime and model weights"}
        </strong>
        {model?.message && <p>{model.message}</p>}
        {model?.download && !model.ready && (
          <div className="sam-download">
            <div>
              <span>
                {bytes(model.download.downloadedBytes)}
                {model.download.totalBytes
                  ? ` / ${bytes(model.download.totalBytes)}`
                  : " downloaded"}
              </span>
              <span>
                {model.download.percent != null
                  ? `${Math.round(model.download.percent)}%`
                  : ""}
              </span>
            </div>
            {installing && (
              <progress
                aria-label="SAM model download"
                max="100"
                {...(model.download.percent != null
                  ? { value: model.download.percent }
                  : {})}
              />
            )}
          </div>
        )}
      </div>
      {details && (
        <dl className="sam-setup-facts">
          {[
            ["Python runtime", model?.components?.runtime],
            ["Model checkpoint", model?.components?.checkpoint],
            ["Model load verification", model?.components?.verification],
          ].map(([label, item]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {item
                  ? item.ready
                    ? label === "Model load verification"
                      ? "Verified"
                      : "Installed"
                    : "Pending"
                  : "Checking…"}
                {item?.bytes ? ` · ${bytes(item.bytes)}` : ""}
                {item?.path && <code>{item.path}</code>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {model?.error && (
        <p role="alert" className="sam-setup-error">
          {model.error}
        </p>
      )}
      {!model?.ready && (
        <button disabled={!model || busy || installing} onClick={onSetup}>
          {installing ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Download size={15} />
          )}
          {installing
            ? "Setup in progress…"
            : model?.status === "failed" || model?.status === "incomplete"
              ? "Retry setup"
              : "Download & set up SAM"}
        </button>
      )}
      <p className="sam-setup-note">
        {editor
          ? "Set up once on this computer. New images start region detection automatically when setup finishes. Existing masks remain usable; whole-image regeneration is available without SAM."
          : "SAM runs on this computer. Setup downloads Python dependencies and model weights, then loads the checkpoint to verify it."}
      </p>
    </section>
  );
}
