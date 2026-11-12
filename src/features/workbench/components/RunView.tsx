// Run sidebar view: the workbench's equivalent of VS Code's Run and
// Debug pane. Base URL (the run configuration) + the primary Run
// action + the shape of the last run, plus runner liveness.

import { Play, RotateCw, Square } from "lucide-react";
import { formatMs } from "../../../lib/format";
import { useT } from "../../../lib/i18n/LocalizationProvider";
import type { PlaywrightRunOutcome } from "../../../lib/demo/store";

export function RunView({ baseURL, onBaseURLChange, onCancel, onRun, running, runnableCount, filesCount, runnerOnline, outcome, errorText, runnerUrl }: {
  baseURL: string;
  onBaseURLChange: (value: string) => void;
  /** Stop the in-flight run — kills the runner's Playwright child. */
  onCancel: () => void;
  onRun: () => void;
  running: boolean;
  runnableCount: number;
  filesCount: number;
  runnerOnline: boolean | undefined;
  outcome: PlaywrightRunOutcome | undefined;
  errorText: string | undefined;
  runnerUrl: string;
}) {
  const { t } = useT();
  return (
    <div className="wb-view">
      <div className="wb-view-head">
        <span className="wb-view-title">Run</span>
      </div>
      <div className="wb-run-body">
        {/* Configuration card: what to run against + the primary action in
            ONE bordered unit — the eye lands on the run controls first,
            and the loose stack of texts becomes a single visible block. */}
        <div className="wb-run-config">
          <p className="wb-run-subtitle">Run the Playwright specs in this workspace against:</p>
          <label className="form-field wb-run-url">
            <span>{t("tests.baseURL")}</span>
            <input
              onChange={(event) => onBaseURLChange(event.target.value)}
              placeholder={t("tests.baseURLPlaceholder")}
              spellCheck={false}
              value={baseURL}
            />
          </label>
          {running ? (
            /* While a suite executes the primary action becomes the stop
               button — a disabled "Running…" label gave the user no way out
               of a slow (tens-of-minutes) run. */
            <button className="danger-button wb-run-btn" onClick={onCancel} type="button">
              <Square size={15} /> {t("run.cancel")}
            </button>
          ) : (
            <button className="primary-button wb-run-btn" disabled={runnableCount === 0} onClick={onRun} type="button">
              <Play size={15} /> {t("tests.run")}
            </button>
          )}
        </div>

        {/* The workspace's shape as count tiles — the numbers were buried in
            a muted sentence before; now they read at a glance like the
            metric tiles elsewhere in the app. */}
        <div className="wb-run-stats">
          <div className="wb-run-stat">
            <div className="wb-run-stat-num">{runnableCount}</div>
            <div className="wb-run-stat-label">runnable spec{runnableCount === 1 ? "" : "s"}</div>
          </div>
          <div className="wb-run-stat">
            <div className="wb-run-stat-num">{filesCount}</div>
            <div className="wb-run-stat-label">file{filesCount === 1 ? "" : "s"}</div>
          </div>
        </div>

        {/* Runner liveness as its own status row — dot + state + the URL it
            answers on, instead of a muted inline line that scrolled past. */}
        {runnerOnline !== undefined ? (
          <div className="wb-run-status">
            <span className={`health-dot ${runnerOnline ? "ok" : ""}`} />
            <div className="wb-run-status-text">
              <span>{runnerOnline ? t("tests.runnerOnline") : t("tests.runnerOff")}</span>
              <span className="mono wb-run-status-url">{runnerUrl}</span>
            </div>
          </div>
        ) : null}

        {running ? (
          <p className="wb-run-meta muted"><RotateCw size={13} className="wb-spin" style={{ verticalAlign: -2 }} /> {t("tests.running")}</p>
        ) : null}

        {outcome ? (
          <div className="wb-run-result">
            <p className="wb-run-result-title">{t("tests.results")}</p>
            <div className="wb-run-chips">
              <span className="badge badge-passed">{outcome.run.passed} {t("status.passed")}</span>
              {outcome.run.failed > 0 ? <span className="badge badge-failed">{outcome.run.failed} {t("status.failed")}</span> : null}
              {outcome.run.total - outcome.run.passed - outcome.run.failed > 0 ? (
                <span className="badge badge-neutral">{outcome.run.total - outcome.run.passed - outcome.run.failed} {t("status.skipped")}</span>
              ) : null}
            </div>
            <p className="wb-run-meta muted">{t("common.duration")}: {formatMs(outcome.run.durationSec * 1000)}</p>
          </div>
        ) : null}

        {errorText ? (
          <p className="wb-run-error">{errorText.length > 200 ? `${errorText.slice(0, 200)}…` : errorText}</p>
        ) : null}
      </div>
    </div>
  );
}
