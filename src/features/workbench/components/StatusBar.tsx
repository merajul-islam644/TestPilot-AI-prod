// Status bar pinned to the workbench floor. LEFT: runner health, the run
// target and live folder/pull progress. RIGHT: the open folder, workspace
// size, language, cursor.

import { useT } from "../../../lib/i18n/LocalizationProvider";
import type { ImportProgress } from "../../../lib/blocks/data";

export function StatusBar({ runnerOnline, runnerUrl, baseURL, root, filesCount, runnableCount, language, cursor, importProgress }: {
  runnerOnline: boolean | undefined;
  runnerUrl: string;
  baseURL: string;
  /** The open workspace folder on disk, or null for the starter draft. */
  root: string | null;
  filesCount: number;
  runnableCount: number;
  language: string;
  cursor: { line: number; col: number } | null;
  importProgress: ImportProgress | null;
}) {
  const { t } = useT();
  const progressLabel = importProgress
    ? importProgress.phase === "clearing"
      ? "Opening folder…"
      : importProgress.phase === "reading"
        ? `Reading ${importProgress.done}/${importProgress.total}`
        : `Writing ${importProgress.done}/${importProgress.total}`
    : null;
  const rootName = root ? root.split(/[\\/]/).filter(Boolean).pop() ?? root : null;
  return (
    <footer aria-label="Status bar" className="wb-status" role="status">
      <span className="wb-status-left">
        <span className="wb-status-item" title={runnerUrl}>
          <span className={`health-dot ${runnerOnline ? "ok" : ""}`} />
          {runnerOnline === false ? t("tests.runnerOffline") : t("tests.runnerOnline")}
        </span>
        <span className="wb-status-item" title={t("tests.baseURL")}>
          <span className="mono wb-status-url">{baseURL}</span>
        </span>
        {progressLabel ? (
          <span className="wb-status-item wb-status-import" title="Working — keep this tab open">
            {progressLabel}
          </span>
        ) : null}
      </span>
      <span className="wb-status-right">
        {rootName ? (
          <span className="wb-status-item wb-status-root mono" title={root ?? undefined}>
            <span className="health-dot ok" />
            {rootName}
          </span>
        ) : null}
        <span className="wb-status-item">{filesCount} files</span>
        <span className="wb-status-item">{runnableCount} specs</span>
        {language !== "plaintext" ? <span className="wb-status-item wb-status-lang">{language}</span> : null}
        {cursor ? (
          <span className="wb-status-item mono">Ln {cursor.line}, Col {cursor.col}</span>
        ) : null}
      </span>
    </footer>
  );
}
