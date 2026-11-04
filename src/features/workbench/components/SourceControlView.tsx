// Source Control sidebar view -- the workbench's Git layer, mirroring
// VS Code's SCM pane: a Changes list of every dirty file (open /
// discard / save-all) and a GitHub card that pulls a repository into
// the workspace and pushes the changed files back as one commit.
//
// The pull stages through the same confirm dialog as a folder import
// (identical guards, identical caps); the push talks to the Git data
// API. The personal access token lives in sessionStorage only.

import { useState } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, PanelLeftClose, Save, Undo2 } from "lucide-react";
import { parseRepoInput, pullRepo, pushChanges, readToken, writeToken } from "../lib/github";
import type { PullReport, PushReport } from "../lib/github";
import type { ImportReport } from "../../../lib/workspace/importFiles";
import { fileIconElement } from "../icons/fileIcon";

export function SourceControlView({ dirtyPaths, contentOf, busy, onOpenDiff, onRevert, onSaveAll, onStagePull, onToggleSidebar }: {
  dirtyPaths: Set<string>;
  contentOf: (path: string) => string;
  /** Saving or importing -- disables the destructive buttons. */
  busy: boolean;
  /** VS Code SCM behaviour: clicking a change opens it as a diff
   *  editor (saved-on-disk ↔ current edits), not a plain editor. */
  onOpenDiff: (path: string) => void;
  onRevert: (path: string) => void;
  onSaveAll: () => void;
  /** Hand a pulled repo to the import-confirm flow (stage, then apply). */
  onStagePull: (report: ImportReport) => void;
  onToggleSidebar: () => void;
}) {
  const [repoInput, setRepoInput] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState(() => readToken());
  const [message, setMessage] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pullError, setPullError] = useState("");
  const [pushError, setPushError] = useState("");
  const [lastPush, setLastPush] = useState<PushReport | null>(null);

  const repo = parseRepoInput(repoInput);
  const dirty = [...dirtyPaths].sort();
  const pushDisabled = !repo || !token.trim() || dirty.length === 0 || !message.trim() || pulling || pushing || busy;

  function onTokenChange(value: string) {
    setToken(value);
    writeToken(value);
  }

  async function onPull() {
    if (!repo || pulling) return;
    setPulling(true);
    setPullError("");
    try {
      const pull: PullReport = await pullRepo({ repoInput, branch, token });
      if (pull.files.length === 0) {
        toast.info("Nothing to import", {
          description: `${pull.repo.owner}/${pull.repo.repo}@${pull.branch} — every file was skipped by the workspace guards`
        });
      } else {
        onStagePull({
          rootFolder: `${pull.repo.owner}/${pull.repo.repo}`,
          files: pull.files,
          skipped: pull.skipped
        });
      }
      if (pull.rateCapped) {
        toast.info("Anonymous pull stopped at 50 files", { description: "Add a token above for the full repository." });
      }
      if (pull.truncatedTree) {
        toast.info("GitHub truncated this repository's file tree", { description: "The pull is partial; a narrower branch may help." });
      }
    } catch (error) {
      setPullError(error instanceof Error ? error.message : String(error));
    } finally {
      setPulling(false);
    }
  }

  async function onPush() {
    if (!repo || pushDisabled) return;
    setPushing(true);
    setPushError("");
    try {
      const files = dirty.map((path) => ({ path, content: contentOf(path) }));
      const report = await pushChanges({ repoInput, branch, token, message, files });
      setLastPush(report);
      setMessage("");
      toast.success("Pushed to GitHub", {
        description: `${report.sha.slice(0, 7)} → ${report.branch} · ${report.pushed.length} file(s)`,
        action: {
          label: "View commit",
          onClick: () => window.open(report.commitUrl, "_blank", "noopener")
        }
      });
    } catch (error) {
      setPushError(error instanceof Error ? error.message : String(error));
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="wb-view">
      <div className="wb-view-head">
        <span className="wb-view-title">Source Control</span>
        <span className="wb-view-actions">
          <button aria-label="Save all changed files" className="wb-icon-btn" disabled={busy || dirty.length === 0} onClick={onSaveAll} title="Save all changed files" type="button">
            <Save size={14} />
          </button>
          <button aria-label="Hide sidebar" className="wb-icon-btn" onClick={onToggleSidebar} title="Hide sidebar (Ctrl+B)" type="button">
            <PanelLeftClose size={14} />
          </button>
        </span>
      </div>
      <div className="wb-scm-body">
        <section className="wb-scm-section">
          <h3 className="wb-scm-heading">Changes <span className="wb-scm-count">{dirty.length}</span></h3>
          {dirty.length === 0 ? (
            <p className="wb-scm-empty">No changes. Edit a file and it shows up here, like VS Code's SCM list.</p>
          ) : (
            <ul className="wb-scm-list">
              {dirty.map((path) => (
                <li className="wb-scm-row" key={path}>
                  <button className="wb-scm-file" onClick={() => onOpenDiff(path)} title={`${path} — open diff (saved ↔ edited)`} type="button">
                    <span className="wb-tree-icon">{fileIconElement(path)}</span>
                    <span className="wb-scm-name">{path}</span>
                  </button>
                  <button aria-label={`Discard changes in ${path}`} className="wb-icon-btn" disabled={busy} onClick={() => onRevert(path)} title="Discard changes" type="button">
                    <Undo2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="wb-scm-section">
          <h3 className="wb-scm-heading">GitHub</h3>
          <label className="wb-scm-field">
            <span>Repository</span>
            <input
              className="wb-scm-input"
              onChange={(event) => setRepoInput(event.target.value)}
              placeholder="owner/repo or a github.com URL"
              spellCheck={false}
              value={repoInput}
            />
          </label>
          <label className="wb-scm-field">
            <span>Branch <em className="wb-scm-opt">(empty = default)</em></span>
            <input
              className="wb-scm-input"
              onChange={(event) => setBranch(event.target.value)}
              placeholder="main"
              spellCheck={false}
              value={branch}
            />
          </label>
          <label className="wb-scm-field">
            <span>Personal access token <em className="wb-scm-opt">(optional)</em></span>
            <input
              autoComplete="off"
              className="wb-scm-input"
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder="ghp_… — private repos and pushing need one"
              spellCheck={false}
              type="password"
              value={token}
            />
          </label>
          <p className="wb-scm-hint">
            The token stays in this tab's session storage — never saved to the workspace,
            never sent anywhere except api.github.com.
          </p>
          <button className="wb-scm-btn" disabled={!repo || pulling || busy} onClick={() => void onPull()} type="button">
            <ArrowDownToLine size={13} />
            {pulling ? "Pulling…" : `Pull ${branch.trim() || "default branch"}`}
          </button>
          {pullError ? <p className="wb-scm-error">{pullError}</p> : null}

          <label className="wb-scm-field">
            <span>Commit message</span>
            <input
              className="wb-scm-input"
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What changed?"
              value={message}
            />
          </label>
          <button className="wb-scm-btn primary" disabled={pushDisabled} onClick={() => void onPush()} type="button">
            <ArrowUpFromLine size={13} />
            {pushing ? "Pushing…" : `Commit & Push${dirty.length > 0 ? ` ${dirty.length} file(s)` : ""}`}
          </button>
          {pushError ? <p className="wb-scm-error">{pushError}</p> : null}
          {lastPush ? (
            <p className="wb-scm-result">
              Pushed {lastPush.pushed.length} file(s) to {lastPush.branch} —{" "}
              <a href={lastPush.commitUrl} rel="noreferrer" target="_blank">{lastPush.sha.slice(0, 7)}</a>
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
