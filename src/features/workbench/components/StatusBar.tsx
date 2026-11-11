// Status bar pinned to the workbench floor. LEFT: runner health, the run
// target. RIGHT: the current git branch of the OPEN clone (VS Code style
// -- click opens Source Control), the open folder, workspace size,
// language, cursor.

import { GitBranch } from "lucide-react";
import { useT } from "../../../lib/i18n/LocalizationProvider";

export function StatusBar({ runnerOnline, runnerUrl, baseURL, root, filesCount, runnableCount, language, cursor, gitBranch, scmChanges, onOpenScm }: {
  runnerOnline: boolean | undefined;
  runnerUrl: string;
  baseURL: string;
  /** The open workspace folder on disk, or null for the starter draft. */
  root: string | null;
  filesCount: number;
  runnableCount: number;
  language: string;
  cursor: { line: number; col: number } | null;
  /** The open clone's current branch (null = not a git repository). */
  gitBranch: string | null;
  /** Unsaved/changed files, shown as a count on the branch chip. */
  scmChanges: number;
  /** Clicking the branch chip opens the Source Control view. */
  onOpenScm: () => void;
}) {
  const { t } = useT();
  const rootName = root ? root.split(/[\\/]/).filter(Boolean).pop() ?? root : null;
  return (
    <footer aria-label="Status bar" className="wb-status" role="status">
      <span className="wb-status-left">
        {runnerOnline !== undefined ? (
          <span
            className="wb-status-item"
            title={runnerOnline ? runnerUrl : "Optional local helper — only the integrated terminal needs it. This workspace reads and writes files through the browser."}
          >
            <span className={`health-dot ${runnerOnline ? "ok" : ""}`} />
            {runnerOnline ? t("tests.runnerOnline") : t("tests.runnerOff")}
          </span>
        ) : null}
        <span className="wb-status-item" title={t("tests.baseURL")}>
          <span className="mono wb-status-url">{baseURL}</span>
        </span>
      </span>
      <span className="wb-status-right">
        {gitBranch ? (
          <button
            className="wb-status-item wb-status-git"
            onClick={onOpenScm}
            title={`${gitBranch} — open Source Control`}
            type="button"
          >
            <GitBranch size={12} />
            {gitBranch}
            {scmChanges > 0 ? <span className="wb-status-git-count">{scmChanges}</span> : null}
          </button>
        ) : null}
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
