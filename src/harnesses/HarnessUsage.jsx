import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cpu, ArrowUpRight, RefreshCw, Settings2, X } from "lucide-react";
import { HarnessLogo, harnessBrand } from "./HarnessLogo.jsx";
import { usageIsStale } from "../../shared/harness-usage.mjs";
import "./harness-usage.css";

const time = (value) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function UsageAccounts({ usage }) {
  const [copyStatus, setCopyStatus] = useState("");
  return (
    <>
      {usage.error && (
        <p className="harness-usage-error" role="alert">
          {usage.error}
        </p>
      )}
      {!usage.report && (
        <p role="status" className="harness-usage-note">
          {usage.loading
            ? "Reading account limits…"
            : "Open Harnesses to read account limits."}
        </p>
      )}
      {usage.report?.accounts.map((account) => (
        <article
          key={account.id}
          className="harness-account"
          style={{
            "--harness-color": harnessBrand(account.id)?.color || "#ddd",
          }}
        >
          <header>
            <span className="harness-account-logo">
              <HarnessLogo id={account.id} />
            </span>
            <div className="harness-account-name">
              <strong>{account.name}</strong>
              <small>
                {account.plan ||
                  (account.billing === "api"
                    ? "API billing"
                    : account.billing === "provider"
                      ? "Provider account"
                      : account.billing === "local"
                        ? "Local command"
                        : "Subscription")}
              </small>
            </div>
            <span className="harness-account-summary">
              {account.windows.length ? (
                <>
                  {usageIsStale(account) || usage.error ? "~" : ""}
                  {Math.round(account.windows[0].usedPercent)}
                  <small>% used</small>
                </>
              ) : (
                <span className="usage-unavailable">Unavailable</span>
              )}
            </span>
          </header>
          {account.windows.length > 0 && usageIsStale(account) && (
            <p className="harness-usage-note">
              Last reported · refresh to update
            </p>
          )}
          {account.windows.map((window) => (
            <div className="harness-window" key={window.id}>
              <div>
                <span>{window.label}</span>
                <span>
                  {window.usedPercent.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}
                  % used
                </span>
              </div>
              <div
                role="meter"
                aria-label={`${account.name} ${window.label} usage${usageIsStale(account) ? " (last reported)" : ""}`}
                aria-valuenow={window.usedPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="harness-usage-meter"
              >
                <span style={{ width: `${window.usedPercent}%` }} />
              </div>
            </div>
          ))}
          <details className="harness-account-details">
            <summary>
              {account.windows.length
                ? "Limits & reset times"
                : "Why unavailable"}
            </summary>
            {account.message && (
              <p className="harness-usage-note">{account.message}</p>
            )}
            {account.windows.map((window) => (
              <p key={window.id} className="harness-usage-note">
                {window.label} ·{" "}
                {window.resetAt
                  ? `resets ${time(window.resetAt)}`
                  : "No reset time reported"}
              </p>
            ))}
            {account.checkedAt && (
              <small className="harness-checked">
                {account.reportedAt ? "Reported" : "Checked"}{" "}
                {time(account.reportedAt || account.checkedAt)}
              </small>
            )}
          </details>
          {account.id === "claude-code" && !account.windows.length && (
            <details className="harness-usage-setup">
              <summary>Connect Claude usage</summary>
              <p>
                Add this status-line command to Claude’s settings. If you
                already have a custom status line, use the bridge’s{" "}
                <code>--usage-only</code> option inside it. Reports arrive after
                a Claude response.
              </p>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      JSON.stringify(account.setup, null, 2),
                    );
                    setCopyStatus("Claude setup copied");
                  } catch {
                    setCopyStatus(
                      "Copy failed. Select the configuration below.",
                    );
                  }
                }}
              >
                Copy setup
              </button>
              <pre>{JSON.stringify(account.setup, null, 2)}</pre>
              <span role="status">{copyStatus}</span>
              <a
                className="harness-usage-link"
                href="https://code.claude.com/docs/en/statusline"
                target="_blank"
                rel="noreferrer"
              >
                Claude status-line settings <ArrowUpRight size={12} />
              </a>
            </details>
          )}
        </article>
      ))}
    </>
  );
}

export function HarnessUsage({ usage, onSettings, onOpen, hidden = false }) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const button = useRef(null);
  const panel = useRef(null);
  const closeTimer = useRef(null);
  const suppressFocus = useRef(false);
  const close = () => {
    clearTimeout(closeTimer.current);
    pinned.current = false;
    setOpen(false);
  };
  const show = () => {
    clearTimeout(closeTimer.current);
    if (!open) {
      setOpen(true);
      onOpen?.();
      usage.load();
    }
  };
  const leave = () => {
    if (!pinned.current && !panel.current?.contains(document.activeElement))
      closeTimer.current = setTimeout(() => setOpen(false), 200);
  };
  useEffect(() => {
    if (hidden) close();
  }, [hidden]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event) => {
      if (event.key === "Escape") {
        close();
        suppressFocus.current = true;
        button.current?.focus();
        suppressFocus.current = false;
      } else if (
        event.type === "pointerdown" &&
        !panel.current?.contains(event.target) &&
        !button.current?.contains(event.target)
      )
        close();
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", dismiss);
    const interval = setInterval(() => {
      if (!document.hidden) usage.load();
    }, 60000);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", dismiss);
      clearInterval(interval);
    };
  }, [open, usage.load]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  return (
    <>
      <button
        ref={button}
        className={`icon-button harness-usage-trigger ${open ? "active" : ""}`}
        aria-label="Harnesses · subscription usage"
        aria-expanded={open}
        aria-controls="harness-usage-panel"
        title="Harnesses · subscription usage"
        onPointerEnter={show}
        onPointerLeave={leave}
        onFocus={() => {
          if (!suppressFocus.current) show();
        }}
        onKeyDown={(event) => {
          if (
            open &&
            (event.key === "ArrowDown" ||
              (event.key === "Tab" && !event.shiftKey))
          ) {
            event.preventDefault();
            panel.current?.querySelector("button:not(:disabled)")?.focus();
          }
        }}
        onClick={() => {
          if (pinned.current) close();
          else {
            pinned.current = true;
            show();
          }
        }}
        onBlur={(event) => {
          if (!panel.current?.contains(event.relatedTarget)) leave();
        }}
      >
        <Cpu size={21} />
      </button>
      {open &&
        !hidden &&
        createPortal(
          <section
            ref={panel}
            id="harness-usage-panel"
            className="harness-usage-popover"
            aria-label="Harness subscription usage"
            onPointerEnter={() => clearTimeout(closeTimer.current)}
            onPointerLeave={leave}
            onFocus={() => clearTimeout(closeTimer.current)}
            onBlur={(event) => {
              if (
                !panel.current?.contains(event.relatedTarget) &&
                event.relatedTarget !== button.current
              )
                leave();
            }}
          >
            <header className="harness-usage-heading">
              <div>
                <strong>Harnesses</strong>
              </div>
              <button
                aria-label="Refresh harness usage"
                disabled={usage.loading}
                onClick={() => usage.load(true)}
              >
                <RefreshCw
                  size={15}
                  className={usage.loading ? "spinning" : ""}
                />
              </button>
              <button aria-label="Close harness usage" onClick={close}>
                <X size={16} />
              </button>
            </header>
            <div className="harness-usage-accounts">
              <UsageAccounts usage={usage} />
            </div>
            <footer>
              <button
                onClick={() => {
                  close();
                  onSettings();
                }}
              >
                <Settings2 size={14} /> Manage providers
              </button>
            </footer>
          </section>,
          document.body,
        )}
    </>
  );
}
