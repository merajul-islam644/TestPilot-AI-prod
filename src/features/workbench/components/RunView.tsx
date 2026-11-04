// Run sidebar view: the workbench's equivalent of VS Code's Run and
// Debug pane. Base URL (the run configuration) + the primary Run
// action + the shape of the last run, plus runner liveness.

import { Play, RotateCw } from "lucide-react";
import { formatMs } from "../../../lib/format";
import { useT } from "../../../lib/i18n/LocalizationProvider";
import type { PlaywrightRunOutcome } from "../../../lib/demo/store";

export function RunView({ baseURL, onBaseURLChange, onRun, running, runnableCount, filesCount, runnerOnline, outcome, errorText, runnerUrl }: {
  baseURL: string;
  onBaseURLChange: (value: string) => void;
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
        <button className="primary-button wb-run-btn" disabled={running || runnableCount === 0} onClick={onRun} type="button">
          {running ? <RotateCw size={15} className="wb-spin" /> : <Play size={15} />}
          {running ? t("tests.running") : t("tests.run")}
        </button>
        <p className="wb-run-meta muted">
          {runnableCount} runnable spec{runnableCount === 1 ? "" : "s"} · {filesCount} file{filesCount === 1 ? "" : "s"}
        </p>
        <p className="wb-run-meta muted">
          <span className={`health-dot ${runnerOnline ? "ok" : ""}`} /> {runnerOnline === false ? t("tests.runnerOffline") : t("tests.runnerOnline")} <span className="mono">{runnerUrl}</span>
        </p>

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
