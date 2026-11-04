// Source Control sidebar view -- the workbench's Git layer, laid out
// like VS Code's SCM pane: a commit box on TOP (message + Ctrl+Enter),
// a STAGED CHANGES / CHANGES pair with per-file stage (+) / unstage (−)
// / discard on hover, a GitHub card that pulls repositories and picks
// or creates branches, and the branch's commit history. Only staged
// files go into a commit; a successful push moves those files' SCM
// baselines so the rows clear out like VS Code's after commit.
//
// The pull stages through the same confirm dialog as a folder import
// (identical guards, identical caps); the push talks to the Git data
// API. The personal access token lives in sessionStorage only; the
// repo + branch live in localStorage so the status bar can show the
// current branch too (see scmContext.ts).

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Minus,
  PanelLeftClose,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Undo2,
  X
} from "lucide-react";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { Select } from "../../../shared/ui/select";
import { formatRelative } from "../../../lib/format";
import {
  createBranch,
  listBranches,
  listCommits,
  parseRepoInput,
  pullRepo,
  pushChanges,
  readToken,
  whoAmI,
  writeToken
} from "../lib/github";
import type { CommitInfo, PullReport, PushReport } from "../lib/github";
import { onScmChange, readScmContext, writeScmContext } from "../lib/scmContext";
import type { ImportReport } from "../../../lib/workspace/importFiles";
import { fileIconElement } from "../icons/fileIcon";

/** Sentinel Select value for the "type a branch name" escape hatch. */
const TYPE_MANUAL = "__type-manually__";

export function SourceControlView({ dirtyPaths, contentOf, busy, onOpenDiff, onRevert, onSaveAll, onMarkCommitted, onStagePull, onToggleSidebar }: {
  dirtyPaths: Set<string>;
  contentOf: (path: string) => string;
  /** Saving or importing -- disables the destructive buttons. */
  busy: boolean;
  /** VS Code SCM behaviour: clicking a change opens it as a diff
   *  editor (baseline ↔ current edits), not a plain editor. */
  onOpenDiff: (path: string) => void;
  onRevert: (path: string) => void;
  onSaveAll: () => void;
  /** A push succeeded: move each committed file's SCM baseline to the
   *  pushed content so the rows clear out like VS Code's after commit. */
  onMarkCommitted: (files: { path: string; content: string }[]) => void;
  /** Hand a pulled repo to the import-confirm flow (stage, then apply). */
  onStagePull: (report: ImportReport) => void;
  onToggleSidebar: () => void;
}) {
  const [repoInput, setRepoInput] = useState(() => readScmContext().repoInput);
  const [branch, setBranch] = useState(() => readScmContext().branch);
  const [token, setToken] = useState(() => readToken());
  const [message, setMessage] = useState("");
  /** The index, VS Code style: rows here are the next commit. */
  const [staged, setStaged] = useState<Set<string>>(() => new Set());

  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pullError, setPullError] = useState("");
  const [pushError, setPushError] = useState("");
  const [lastPush, setLastPush] = useState<PushReport | null>(null);

  const [branches, setBranches] = useState<string[]>([]);
  const [branchNote, setBranchNote] = useState("");
  const [branchMode, setBranchMode] = useState<"pick" | "type">("type");
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);

  const [tokenVisible, setTokenVisible] = useState(false);
  const [tokenUser, setTokenUser] = useState("");
  const [tokenNote, setTokenNote] = useState("");

  const [history, setHistory] = useState<CommitInfo[]>([]);
  const [historyNote, setHistoryNote] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [openStaged, setOpenStaged] = useState(true);
  const [openChanges, setOpenChanges] = useState(true);
  const [openGithub, setOpenGithub] = useState(true);
  const [openHistory, setOpenHistory] = useState(true);
  const [confirmingDiscardAll, setConfirmingDiscardAll] = useState(false);

  const repo = parseRepoInput(repoInput);
  const dirty = useMemo(() => [...dirtyPaths].sort(), [dirtyPaths]);
  const stagedPaths = useMemo(() => dirty.filter((path) => staged.has(path)), [dirty, staged]);
  const unstagedPaths = useMemo(() => dirty.filter((path) => !staged.has(path)), [dirty, staged]);
  const tokenOk = token.trim().length > 0;

  /** Empty string = commit is allowed; otherwise the reason it is not. */
  const commitBlocker = !repo
    ? "Add a repository (owner/name) first"
    : !tokenOk
      ? "A personal access token is required to push"
      : stagedPaths.length === 0
        ? "Stage changes first — hover a file and press + (or stage all)"
        : !message.trim()
          ? "Write a commit message first"
          : busy || pulling
            ? "Wait for the current operation to finish"
            : "";

  // Files that leave the dirty set (saved / discarded / deleted) drop
  // out of the index too, so it never holds stale paths.
  useEffect(() => {
    setStaged((prev) => {
      const next = new Set([...prev].filter((path) => dirtyPaths.has(path)));
      return next.size === prev.size ? prev : next;
    });
  }, [dirtyPaths]);

  // Debounced token check: the "Signed in as @login" chip, like VS
  // Code's account badge. Runs 700ms after the last keystroke.
  useEffect(() => {
    const candidate = token.trim();
    if (!candidate) {
      setTokenUser("");
      setTokenNote("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      whoAmI(candidate)
        .then((login) => {
          if (!cancelled) { setTokenUser(login); setTokenNote(""); }
        })
        .catch((error) => {
          if (!cancelled) {
            setTokenUser("");
            setTokenNote(error instanceof Error ? error.message : String(error));
          }
        });
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token]);

  const refreshBranches = useCallback(async (currentRepo: string, currentToken: string) => {
    if (!parseRepoInput(currentRepo)) return;
    setLoadingBranches(true);
    setBranchNote("");
    try {
      const names = await listBranches({ repoInput: currentRepo, token: currentToken });
      setBranches(names);
      setBranchMode("pick");
    } catch (error) {
      setBranches([]);
      setBranchMode("type");
      setBranchNote(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingBranches(false);
    }
  }, []);

  const refreshHistory = useCallback(async (currentRepo: string, currentBranch: string, currentToken: string) => {
    if (!parseRepoInput(currentRepo)) return;
    setLoadingHistory(true);
    setHistoryNote("");
    try {
      const commits = await listCommits({ repoInput: currentRepo, branch: currentBranch, token: currentToken });
      setHistory(commits);
      if (commits.length === 0) setHistoryNote("No commits on this branch yet.");
    } catch (error) {
      setHistory([]);
      setHistoryNote(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Restore the remembered repo/branch and load what they can offer.
  useEffect(() => {
    const saved = readScmContext();
    if (parseRepoInput(saved.repoInput)) {
      void refreshBranches(saved.repoInput, readToken());
      void refreshHistory(saved.repoInput, saved.branch, readToken());
    }
  }, [refreshBranches, refreshHistory]);

  // The status bar shows the same context; keep the fields in sync if
  // another surface ever writes it.
  useEffect(() => onScmChange(() => {
    const current = readScmContext();
    setRepoInput(current.repoInput);
    setBranch(current.branch);
  }), []);

  function onRepoChange(value: string) {
    setRepoInput(value);
    writeScmContext({ repoInput: value });
  }

  function onBranchChange(value: string) {
    setBranch(value);
    writeScmContext({ branch: value });
  }

  function onTokenChange(value: string) {
    setToken(value);
    writeToken(value);
  }

  function onBranchPick(value: string) {
    if (value === TYPE_MANUAL) {
      setBranchMode("type");
      return;
    }
    onBranchChange(value);
  }

  function refreshAll() {
    void refreshBranches(repoInput, token);
    void refreshHistory(repoInput, branch, token);
  }

  function openOnGitHub() {
    if (!repo) return;
    const suffix = branch.trim() ? `/tree/${encodeURIComponent(branch.trim())}` : "";
    window.open(`https://github.com/${repo.owner}/${repo.repo}${suffix}`, "_blank", "noopener");
  }

  function stage(paths: string[]) {
    setStaged((prev) => {
      const next = new Set(prev);
      for (const path of paths) next.add(path);
      return next;
    });
  }

  function unstage(paths: string[]) {
    setStaged((prev) => {
      const next = new Set(prev);
      for (const path of paths) next.delete(path);
      return next;
    });
  }

  async function onCommit() {
    if (!repo || commitBlocker || pushing) return;
    setPushing(true);
    setPushError("");
    try {
      const files = stagedPaths.map((path) => ({ path, content: contentOf(path) }));
      const report = await pushChanges({ repoInput, branch, token, message, files });
      setLastPush(report);
      setMessage("");
      setStaged(new Set());
      // The committed content is now GitHub's HEAD: move the SCM
      // baselines there so the rows clear out like VS Code's changes
      // list after a commit (auto-saved edits keep flowing meanwhile).
      onMarkCommitted(files);
      toast.success("Pushed to GitHub", {
        description: `${report.sha.slice(0, 7)} → ${report.branch} · ${report.pushed.length} file(s)`,
        action: {
          label: "View commit",
          onClick: () => window.open(report.commitUrl, "_blank", "noopener")
        }
      });
      void refreshHistory(repoInput, report.branch, token);
    } catch (error) {
      setPushError(error instanceof Error ? error.message : String(error));
    } finally {
      setPushing(false);
    }
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

  async function onCreateBranch() {
    if (!repo || creatingBranch) return;
    const name = newBranch.trim();
    if (!name) return;
    setCreatingBranch(true);
    setBranchNote("");
    try {
      await createBranch({ repoInput, token, name, from: branch });
      toast.success(`Branch “${name}” created`, {
        description: `Based on ${branch.trim() || "the default branch"} — your next commit lands here.`
      });
      onBranchChange(name);
      setBranches((prev) => (prev.includes(name) ? prev : [name, ...prev]));
      setBranchMode("pick");
      setCreating(false);
      setNewBranch("");
      void refreshHistory(repoInput, name, token);
    } catch (error) {
      setBranchNote(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingBranch(false);
    }
  }

  const branchItems = useMemo(() => {
    const current = branch.trim();
    const items = branches.map((name) => ({ value: name, label: name }));
    if (current && !branches.includes(current)) items.unshift({ value: current, label: current });
    items.push({ value: TYPE_MANUAL, label: "Type a branch name…" });
    return items;
  }, [branches, branch]);

  function commitWhen(info: CommitInfo): string {
    const ts = Date.parse(info.date);
    return Number.isFinite(ts) ? formatRelative(ts) : "";
  }

  function collapsibleKey(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
    }
  }

  return (
    <div className="wb-view">
      <div className="wb-view-head">
        <span className="wb-view-title">Source Control</span>
        <span className="wb-view-actions">
          <button aria-label="Refresh branches and history" className="wb-icon-btn" disabled={!repo || pulling || pushing} onClick={refreshAll} title="Refresh branches & history" type="button">
            <RefreshCw size={14} />
          </button>
          <button aria-label={`Pull ${branch.trim() || "default branch"}`} className="wb-icon-btn" disabled={!repo || pulling || busy} onClick={() => void onPull()} title={`Pull ${branch.trim() || "default branch"}`} type="button">
            <ArrowDownToLine size={14} />
          </button>
          <button aria-label="Open on GitHub" className="wb-icon-btn" disabled={!repo} onClick={openOnGitHub} title="Open on GitHub" type="button">
            <ExternalLink size={14} />
          </button>
          <button aria-label="Hide sidebar" className="wb-icon-btn" onClick={onToggleSidebar} title="Hide sidebar (Ctrl+B)" type="button">
            <PanelLeftClose size={14} />
          </button>
        </span>
      </div>
      <div className="wb-scm-body">
        <div className="wb-scm-commit">
          <textarea
            className="wb-scm-message"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !commitBlocker && !pushing) {
                event.preventDefault();
                void onCommit();
              }
            }}
            placeholder="Message (Ctrl+Enter to commit & push)"
            rows={2}
            spellCheck={false}
            value={message}
          />
          <button
            className="wb-scm-btn primary"
            disabled={Boolean(commitBlocker) || pushing}
            onClick={() => void onCommit()}
            title={commitBlocker || undefined}
            type="button"
          >
            <Check size={14} />
            {pushing ? "Pushing…" : `Commit & Push${stagedPaths.length > 0 ? ` (${stagedPaths.length})` : ""}`}
          </button>
          {pushError ? <p className="wb-scm-error">{pushError}</p> : null}
          {lastPush ? (
            <p className="wb-scm-result">
              Pushed {lastPush.pushed.length} file(s) to {lastPush.branch} —{" "}
              <a href={lastPush.commitUrl} rel="noreferrer" target="_blank">{lastPush.sha.slice(0, 7)}</a>
            </p>
          ) : null}
        </div>

        {stagedPaths.length > 0 ? (
          <section className="wb-scm-section">
            <div
              className="wb-scm-heading wb-scm-collapsible"
              onClick={() => setOpenStaged((v) => !v)}
              onKeyDown={(event) => {
                collapsibleKey(event);
                if (event.key === "Enter" || event.key === " ") setOpenStaged((v) => !v);
              }}
              role="button"
              tabIndex={0}
            >
              <span className="wb-scm-chev">{openStaged ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              Staged Changes <span className="wb-scm-count">{stagedPaths.length}</span>
              <span className="wb-scm-heading-actions" onClick={(event) => event.stopPropagation()}>
                <button aria-label="Unstage all" className="wb-icon-btn" disabled={busy} onClick={() => unstage(stagedPaths)} title="Unstage all changes" type="button">
                  <Minus size={13} />
                </button>
              </span>
            </div>
            {openStaged ? (
              <ul className="wb-scm-list">
                {stagedPaths.map((path) => (
                  <li className="wb-scm-row" key={path}>
                    <button className="wb-scm-file" onClick={() => onOpenDiff(path)} title={`${path} — open diff (baseline ↔ edited)`} type="button">
                      <span className="wb-tree-icon">{fileIconElement(path)}</span>
                      <span className="wb-scm-name">{path}</span>
                    </button>
                    <span className="wb-scm-status" title="Modified">M</span>
                    <span className="wb-scm-row-actions">
                      <button aria-label={`Unstage ${path}`} className="wb-icon-btn" disabled={busy} onClick={() => unstage([path])} title="Unstage this change (−)" type="button">
                        <Minus size={13} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {unstagedPaths.length > 0 || dirty.length === 0 ? (
          <section className="wb-scm-section">
            <div
              className="wb-scm-heading wb-scm-collapsible"
              onClick={() => setOpenChanges((v) => !v)}
              onKeyDown={(event) => {
                collapsibleKey(event);
                if (event.key === "Enter" || event.key === " ") setOpenChanges((v) => !v);
              }}
              role="button"
              tabIndex={0}
            >
              <span className="wb-scm-chev">{openChanges ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              Changes <span className="wb-scm-count">{unstagedPaths.length}</span>
              <span className="wb-scm-heading-actions" onClick={(event) => event.stopPropagation()}>
                <button aria-label="Stage all" className="wb-icon-btn" disabled={busy || unstagedPaths.length === 0} onClick={() => stage(unstagedPaths)} title="Stage all changes" type="button">
                  <Plus size={13} />
                </button>
                <button aria-label="Save all changed files" className="wb-icon-btn" disabled={busy || dirty.length === 0} onClick={onSaveAll} title="Save all changed files" type="button">
                  <Save size={13} />
                </button>
                <button aria-label="Discard all changes" className="wb-icon-btn" disabled={busy || unstagedPaths.length === 0} onClick={() => setConfirmingDiscardAll(true)} title="Discard all changes" type="button">
                  <Undo2 size={13} />
                </button>
              </span>
            </div>
            {openChanges ? (
              unstagedPaths.length === 0 ? (
                <p className="wb-scm-empty">No changes. Edit a file and it shows up here, like VS Code's SCM list.</p>
              ) : (
                <ul className="wb-scm-list">
                  {unstagedPaths.map((path) => (
                    <li className="wb-scm-row" key={path}>
                      <button className="wb-scm-file" onClick={() => onOpenDiff(path)} title={`${path} — open diff (baseline ↔ edited)`} type="button">
                        <span className="wb-tree-icon">{fileIconElement(path)}</span>
                        <span className="wb-scm-name">{path}</span>
                      </button>
                      <span className="wb-scm-status" title="Modified">M</span>
                      <span className="wb-scm-row-actions">
                        <button aria-label={`Discard changes in ${path}`} className="wb-icon-btn" disabled={busy} onClick={() => onRevert(path)} title="Discard changes" type="button">
                          <Undo2 size={13} />
                        </button>
                        <button aria-label={`Stage ${path}`} className="wb-icon-btn" disabled={busy} onClick={() => stage([path])} title="Stage this change (+)" type="button">
                          <Plus size={13} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>
        ) : null}

        <section className="wb-scm-section">
          <div
            className="wb-scm-heading wb-scm-collapsible"
            onClick={() => setOpenGithub((v) => !v)}
            onKeyDown={(event) => {
              collapsibleKey(event);
              if (event.key === "Enter" || event.key === " ") setOpenGithub((v) => !v);
            }}
            role="button"
            tabIndex={0}
          >
            <span className="wb-scm-chev">{openGithub ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
            GitHub
            <span className="wb-scm-heading-actions" onClick={(event) => event.stopPropagation()}>
              <button aria-label="Reload branch list" className="wb-icon-btn" disabled={!repo || loadingBranches} onClick={() => void refreshBranches(repoInput, token)} title="Reload branch list" type="button">
                <RefreshCw className={loadingBranches ? "wb-scm-spin" : undefined} size={13} />
              </button>
            </span>
          </div>
          {openGithub ? (
            <>
              <label className="wb-scm-field">
                <span>Repository</span>
                <input
                  className="wb-scm-input"
                  onBlur={() => {
                    if (repo) void refreshBranches(repoInput, token);
                  }}
                  onChange={(event) => onRepoChange(event.target.value)}
                  placeholder="owner/repo or a github.com URL"
                  spellCheck={false}
                  value={repoInput}
                />
              </label>
              <div className="wb-scm-field">
                <span>Branch <em className="wb-scm-opt">(empty = default)</em></span>
                {creating ? (
                  <div className="wb-scm-branch-create">
                    <input
                      className="wb-scm-input"
                      onChange={(event) => setNewBranch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && newBranch.trim()) void onCreateBranch();
                      }}
                      placeholder="new-branch-name"
                      spellCheck={false}
                      value={newBranch}
                    />
                    <button className="wb-scm-btn wb-scm-btn-inline" disabled={creatingBranch || !newBranch.trim()} onClick={() => void onCreateBranch()} type="button">
                      {creatingBranch ? "Creating…" : "Create"}
                    </button>
                    <button aria-label="Cancel new branch" className="wb-icon-btn" onClick={() => { setCreating(false); setNewBranch(""); }} title="Cancel" type="button">
                      <X size={13} />
                    </button>
                  </div>
                ) : branchMode === "pick" && branches.length > 0 ? (
                  <div className="wb-scm-branch-row">
                    <Select
                      ariaLabel="Branch"
                      className="wb-scm-select"
                      items={branchItems}
                      onChange={onBranchPick}
                      size="sm"
                      title="Branch"
                      value={branch.trim()}
                    />
                    <button aria-label="Type a branch name" className="wb-icon-btn" onClick={() => setBranchMode("type")} title="Type a branch name" type="button">
                      <PenLine size={13} />
                    </button>
                    <button aria-label="New branch" className="wb-icon-btn" disabled={!repo || !tokenOk} onClick={() => setCreating(true)} title={tokenOk ? "New branch…" : "Creating a branch needs a token"} type="button">
                      <Plus size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="wb-scm-branch-row">
                    <input
                      className="wb-scm-input"
                      onChange={(event) => onBranchChange(event.target.value)}
                      placeholder="main"
                      spellCheck={false}
                      value={branch}
                    />
                    {branches.length > 0 ? (
                      <button aria-label="Pick from the branch list" className="wb-icon-btn" onClick={() => setBranchMode("pick")} title="Pick from the branch list" type="button">
                        <ChevronDown size={13} />
                      </button>
                    ) : null}
                    <button aria-label="New branch" className="wb-icon-btn" disabled={!repo || !tokenOk} onClick={() => setCreating(true)} title={tokenOk ? "New branch…" : "Creating a branch needs a token"} type="button">
                      <Plus size={13} />
                    </button>
                  </div>
                )}
                {branchNote ? <p className="wb-scm-note">{branchNote}</p> : null}
              </div>
              <label className="wb-scm-field">
                <span>Personal access token <em className="wb-scm-opt">(pulls work without one — pushes need it)</em></span>
                <span className="wb-scm-token">
                  <input
                    autoComplete="off"
                    className="wb-scm-input"
                    onChange={(event) => onTokenChange(event.target.value)}
                    placeholder="ghp_…"
                    spellCheck={false}
                    type={tokenVisible ? "text" : "password"}
                    value={token}
                  />
                  <button aria-label={tokenVisible ? "Hide token" : "Show token"} className="wb-icon-btn" onClick={() => setTokenVisible((v) => !v)} title={tokenVisible ? "Hide token" : "Show token"} type="button">
                    {tokenVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </span>
                {tokenUser ? (
                  <span className="wb-scm-verified">
                    <Check size={12} />
                    Signed in as {tokenUser}
                  </span>
                ) : null}
                {tokenNote ? <span className="wb-scm-error">{tokenNote}</span> : null}
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
            </>
          ) : null}
        </section>

        <section className="wb-scm-section">
          <div
            className="wb-scm-heading wb-scm-collapsible"
            onClick={() => setOpenHistory((v) => !v)}
            onKeyDown={(event) => {
              collapsibleKey(event);
              if (event.key === "Enter" || event.key === " ") setOpenHistory((v) => !v);
            }}
            role="button"
            tabIndex={0}
          >
            <span className="wb-scm-chev">{openHistory ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
            History {history.length > 0 ? <span className="wb-scm-count">{history.length}</span> : null}
            <span className="wb-scm-heading-actions" onClick={(event) => event.stopPropagation()}>
              <button aria-label="Reload commits" className="wb-icon-btn" disabled={!repo || loadingHistory} onClick={() => void refreshHistory(repoInput, branch, token)} title="Reload commits" type="button">
                <RefreshCw className={loadingHistory ? "wb-scm-spin" : undefined} size={13} />
              </button>
            </span>
          </div>
          {openHistory ? (
            history.length === 0 ? (
              <p className="wb-scm-empty">
                {historyNote || (repo ? "No commits loaded — press the refresh arrow." : "Add a repository to see its commits.")}
              </p>
            ) : (
              <ul className="wb-scm-history">
                {history.map((commit) => (
                  <li key={commit.sha}>
                    <a
                      className="wb-scm-commit-row"
                      href={commit.url}
                      rel="noreferrer"
                      target="_blank"
                      title={`${commit.message}${commit.author ? `\n${commit.author}` : ""} — open on GitHub`}
                    >
                      <span className="wb-scm-commit-msg">{commit.message || commit.sha.slice(0, 7)}</span>
                      <span className="wb-scm-commit-meta">
                        {commit.sha.slice(0, 7)}
                        {commit.author ? ` · ${commit.author}` : ""}
                        {commitWhen(commit) ? ` · ${commitWhen(commit)}` : ""}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      </div>

      {confirmingDiscardAll ? (
        <ConfirmDialog
          confirmLabel="Discard"
          message={`This reverts ${unstagedPaths.length} file${unstagedPaths.length === 1 ? "" : "s"} to their baseline — the version as loaded, pulled, or last pushed. Edits since then are lost.`}
          onCancel={() => setConfirmingDiscardAll(false)}
          onConfirm={() => {
            setConfirmingDiscardAll(false);
            unstagedPaths.forEach((path) => onRevert(path));
          }}
          title="Discard all changes?"
        />
      ) : null}
    </div>
  );
}
