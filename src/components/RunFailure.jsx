import React from "react";
import { AlertCircle, ArrowUpRight, X } from "lucide-react";
import { PROVIDER_NOT_READY } from "../../shared/provider-errors.mjs";

export function RunFailure({ error, onDismiss, onSettings }) {
  const blockers = error.code === PROVIDER_NOT_READY ? error.blockers : null;
  return (
    <section
      className="run-failure"
      role="alert"
      aria-label={blockers ? "Run blocked" : "Run could not start"}
    >
      <header>
        <AlertCircle size={17} />
        <strong>{blockers ? "Run blocked" : "Couldn’t start run"}</strong>
        <button
          type="button"
          aria-label="Dismiss run error"
          onClick={onDismiss}
        >
          <X size={15} />
        </button>
      </header>
      {blockers ? (
        <>
          <p>
            No jobs were started. Set up{" "}
            {blockers.length === 1 ? "this provider" : "these providers"} first.
          </p>
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker.providerId}>
                <strong>{blocker.name}</strong>
                <span>{blocker.message}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="run-failure-settings"
            onClick={() =>
              onSettings(
                blockers.every((b) => b.setupPath === "/settings/local-models")
                  ? "local-models"
                  : "providers",
              )
            }
          >
            Set up{" "}
            {blockers.every((b) => b.setupPath === "/settings/local-models")
              ? "local models"
              : "providers"}
            <ArrowUpRight size={13} />
          </button>
        </>
      ) : (
        <p>
          {error.message ||
            "The request failed. Check the connection and try again."}
        </p>
      )}
    </section>
  );
}
