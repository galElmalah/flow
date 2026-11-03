import React from "react";
import { Loader2, Pause, Play, Square, RotateCcw } from "lucide-react";
import { IconButton } from "./IconButton.jsx";
import { cls } from "../studio/ui.mjs";
export function RunStatus({
  activity,
  busy,
  recordedFor,
  stage,
  onInspect,
  onAction,
}) {
  return (
    <>
      {activity.runId && (
        <div
          className={cls("workflow-activity", busy && "is-running")}
          role="status"
          aria-label="Workflow run status"
          data-status={activity.status}
        >
          {busy ? (
            <Loader2 size={14} className="spin" />
          ) : activity.status === "paused" ? (
            <Pause size={14} />
          ) : (
            <span className="status-dot" />
          )}
          <button
            className="activity-detail"
            onClick={() => {
              onInspect(activity.runId);
            }}
          >
            <strong>
              {activity.label}
              {recordedFor && (
                <small className="activity-origin"> · {recordedFor}</small>
              )}
              {activity.liveRuns > 1 ? ` · ${activity.liveRuns} runs` : ""}
            </strong>
            <span>
              {activity.counts.completed}/{activity.total} complete
              {activity.counts.running > 0 &&
                ` · ${activity.counts.running} active`}
              {activity.counts.queued > 0 &&
                ` · ${activity.counts.queued} queued`}
              {activity.counts.cancelled > 0 &&
                ` · ${activity.counts.cancelled} cancelled`}
              {activity.counts.interrupted > 0 &&
                ` · ${activity.counts.interrupted} interrupted`}
              {activity.counts.retrying > 0 &&
                ` · ${activity.counts.retrying} retrying`}
              {activity.counts.failed + activity.counts.blocked > 0 &&
                ` · ${activity.counts.failed + activity.counts.blocked} failed / blocked`}
            </span>
            {activity.total > 0 && (
              <>
                <span className="activity-progress-label">
                  {activity.percent}% processed · {activity.finished}/
                  {activity.total} jobs finished
                </span>
                <span
                  className="activity-progress"
                  role="progressbar"
                  aria-label="Workflow jobs processed"
                  aria-valuemin={0}
                  aria-valuemax={activity.total}
                  aria-valuenow={activity.finished}
                  aria-valuetext={`${activity.finished} of ${activity.total} jobs finished; ${activity.counts.completed} completed successfully`}
                >
                  <i style={{ width: `${activity.percent}%` }} />
                </span>
              </>
            )}
            {stage && (
              <span className="activity-stage" title={stage}>
                {stage}
              </span>
            )}
          </button>
          {activity.liveRuns === 1 && (
            <>
              <IconButton
                label={
                  activity.status === "paused"
                    ? "Resume workflow run"
                    : "Pause workflow run"
                }
                onClick={() =>
                  onAction(
                    activity.runId,
                    activity.status === "paused" ? "resume" : "pause",
                  )
                }
              >
                {activity.status === "paused" ? (
                  <Play size={14} />
                ) : (
                  <Pause size={14} />
                )}
              </IconButton>
              <IconButton
                label="Cancel workflow run"
                onClick={() => onAction(activity.runId, "cancel")}
              >
                <Square size={12} />
              </IconButton>
            </>
          )}
          {["failed", "interrupted", "cancelled"].includes(activity.status) && (
            <IconButton
              label="Retry unfinished workflow jobs"
              onClick={() => onAction(activity.runId, "retry")}
            >
              <RotateCcw size={14} />
            </IconButton>
          )}
        </div>
      )}
    </>
  );
}
