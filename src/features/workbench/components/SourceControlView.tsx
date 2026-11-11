// Source Control sidebar view -- the workbench's Git layer, laid out
// like VS Code's SCM pane, powered by LOCAL git on the open folder's
// clone (no GitHub API, no tokens): a branch picker that switches the
// open clone, a commit box on TOP (message + Ctrl+Enter), a STAGED
// CHANGES / CHANGES pair with per-file stage (+) / unstage (−) /
// discard on hover, stash and merge-conflict sections, and the branch's
// commit history. Only staged files go into a commit (`git commit --
// paths`); pushing and pulling are separate actions, like VS Code.
//
// Authentication is the machine's own git credential helper — exactly
// how desktop VS Code talks to remotes — so nothing secret ever enters
// the app. Every op runs on the runner against the real clone.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Minus,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { BranchPicker } from "./BranchPicker";
import { formatRelative } from "../../../lib/format";
import { localFolder } from "../../../lib/workspace/localFolder";
import type { GitStashRow } from "../../../lib/workspace/localFolder";
import { fileIconElement } from "../icons/fileIcon";

/** One row of the local branch's history (`git log`). */
type LocalCommit = { sha: string; subject: string; author: string; date: string };

export function SourceControlView({ dirtyPaths, busy, root, gitBranch, gitTick, onOpenDiff, onRevert, onSaveAll, onPull, onPush, onCommit, onCheckout, onCreateBranch, onToggleSidebar }: {
  dirtyPaths: Set<string>;
  /** Saving, opening a folder or a git op in flight -- disables the actions. */
  busy: boolean;
  /** The workspace folder on disk — the git clone SCM works on. */
  root: string | null;
  /** The clone's current branch (null = not a git repository). */
  gitBranch: string | null;
  /** Bumped after each successful git mutation — re-reads branches and
   *  history even when the branch itself didn't change (commit/pull/push). */
  gitTick: number;
  /** VS Code SCM behaviour: clicking a change opens it as a diff
   *  editor (baseline ↔ current edits), not a plain editor. */
  onOpenDiff: (path: string) => void;
  onRevert: (path: string) => void;
  onSaveAll: () => void;
  /** git pull / git push on the open clone (the hook toasts results). */
  onPull: () => Promise<void>;
  onPush: () => Promise<void>;
  /** Commit the staged files; true when the commit landed. */
  onCommit: (paths: string[], message: string) => Promise<boolean>;
  /** Switch the clone's branch; the workspace reloads afterwards. */
  onCheckout: (name: string) => Promise<void>;
  /** Create a local branch off HEAD and switch; true when created. */
  onCreateBranch: (name: string) => Promise<boolean>;
  onToggleSidebar: () => void;
}) {
  const [message, setMessage] = useState("");
  /** The index, VS Code style: rows here are the next commit. */
  const [staged, setStaged] = useState<Set<string>>(() => new Set());

  const [branches, setBranches] = useState<string[]>([]);
  const [branchesNote, setBranchesNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);

  const [history, setHistory] = useState<LocalCommit[]>([]);
  const [historyNote, setHistoryNote] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [openStaged, setOpenStaged] = useState(true);
  const [openChanges, setOpenChanges] = useState(true);
  const [openBranch, setOpenBranch] = useState(true);
  const [openHistory, setOpenHistory] = useState(true);
  const [confirmingDiscardAll, setConfirmingDiscardAll] = useState(false);

  // Local-clone git: stash rows + merge-conflict paths, served by the
  // runner's /api/git against the REAL clone the workspace lives in.
  // An old runner (no endpoint) or a non-clone folder leaves the
  // sections hidden, never erroring.
  const [stashes, setStashes] = useState<GitStashRow[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [localGitBusy, setLocalGitBusy] = useState(false);
  const [openStash, setOpenStash] = useState(true);
  const refreshLocalGit = useCallback(async (currentRoot: string | null) => {
    if (!currentRoot) {
      setStashes([]);
      setConflicts([]);
      return;
    }
    try {
      const [stashRes, statusRes] = await Promise.all([
        localFolder.runGit({ root: currentRoot, op: "stash-list" }),
        localFolder.runGit({ root: currentRoot, op: "status" })
      ]);
      setStashes(stashRes.stdout.split("\n").filter(Boolean).map((line) => {
        const tab = line.indexOf("\t");
        return { ref: tab > 0 ? line.slice(0, tab) : "", subject: tab > 0 ? line.slice(tab + 1) : line };
      }).filter((row) => row.ref));
      // Porcelain XY codes: any unmerged pair means a live merge conflict.
      const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
      setConflicts(statusRes.stdout.split("\n").filter((line) => UNMERGED.has(line.slice(0, 2))).map((line) => line.slice(3)));
    } catch {
      setStashes([]);
      setConflicts([]);
    }
  }, []);
  useEffect(() => {
    void refreshLocalGit(root);
  }, [root, refreshLocalGit]);

  /** Local branches of the open clone, for the switcher. */
  const refreshBranches = useCallback(async (currentRoot: string | null) => {
    if (!currentRoot) {
      setBranches([]);
      return;
    }
    try {
      const res = await localFolder.runGit({ root: currentRoot, op: "branch-list" });
      if (res.code !== 0) {
        setBranches([]);
        setBranchesNote(((res.stderr || res.stdout).trim() || "git branch failed").slice(0, 160));
        return;
      }
      // git prints local branches first, then origin/* — the picker keeps
      // that order. "origin" and "origin/HEAD" are pseudo-refs, not branches.
      setBranches(res.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
        .filter((line) => line !== "origin" && !line.startsWith("origin/HEAD")));
      setBranchesNote("");
    } catch (error) {
      setBranches([]);
      setBranchesNote(error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => {
    void refreshBranches(root);
  }, [root, gitBranch, gitTick, refreshBranches]);

  /** Recent commits of the HEAD branch, straight from `git log`. */
  const refreshHistory = useCallback(async (currentRoot: string | null) => {
    if (!currentRoot) {
      setHistory([]);
      return;
    }
    setLoadingHistory(true);
    setHistoryNote("");
    try {
      const res = await localFolder.runGit({ root: currentRoot, op: "log" });
      if (res.code !== 0) {
        setHistory([]);
        setHistoryNote(((res.stderr || res.stdout).trim() || "git log failed").slice(0, 160));
        return;
      }
      setHistory(res.stdout.split("\n").filter(Boolean).map((line) => {
        const [sha, subject, author, date] = line.split("\t");
        return { sha: sha ?? "", subject: subject ?? "", author: author ?? "", date: date ?? "" };
      }).filter((commit) => commit.sha));
    } catch (error) {
      setHistory([]);
      setHistoryNote(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingHistory(false);
    }
  }, []);
  useEffect(() => {
    void refreshHistory(root);
  }, [root, gitBranch, gitTick, refreshHistory]);

  /** Park every dirty file in the stash (git stash push -- paths) — the
   *  working tree drops back to HEAD, like VS Code's stash. */
  const stashAll = useCallback(async () => {
    const paths = [...dirtyPaths].sort();
    if (!root || paths.length === 0) return;
    setLocalGitBusy(true);
    try {
      const res = await localFolder.runGit({ root, op: "stash-push", message: "Workbench stash", paths });
      if (res.code !== 0) throw new Error(res.stderr.trim() || "git stash push failed");
      toast.success("Stashed", { description: `${paths.length} file(s) parked — working tree back to HEAD. Reopen tabs to see the clean state.` });
      await refreshLocalGit(root);
    } catch (error) {
      toast.error("Stash failed", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setLocalGitBusy(false);
    }
  }, [dirtyPaths, root, refreshLocalGit]);

  /** Bring a stash back (git stash pop). A conflict keeps the stash and
   *  surfaces the files in the conflict banner instead of failing silent. */
  const stashPop = useCallback(async (index: number) => {
    if (!root) return;
    setLocalGitBusy(true);
    try {
      const res = await localFolder.runGit({ root, op: "stash-pop", index });
      if (res.code !== 0) {
        toast.error("Pop hit conflicts", { description: (res.stderr || res.stdout).trim().slice(0, 200) });
        await refreshLocalGit(root);
        return;
      }
      toast.success("Stash applied", { description: "Popped back into the working tree. Reopen tabs to see the restored content." });
      await refreshLocalGit(root);
    } finally {
      setLocalGitBusy(false);
    }
  }, [root, refreshLocalGit]);

  const stashDrop = useCallback(async (index: number) => {
    if (!root) return;
    setLocalGitBusy(true);
    try {
      const res = await localFolder.runGit({ root, op: "stash-drop", index });
      if (res.code !== 0) throw new Error(res.stderr.trim() || "git stash drop failed");
      toast.success("Stash dropped");
      await refreshLocalGit(root);
    } catch (error) {
      toast.error("Drop failed", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setLocalGitBusy(false);
    }
  }, [root, refreshLocalGit]);

  const dirty = useMemo(() => [...dirtyPaths].sort(), [dirtyPaths]);
  const stagedPaths = useMemo(() => dirty.filter((path) => staged.has(path)), [dirty, staged]);
  const unstagedPaths = useMemo(() => dirty.filter((path) => !staged.has(path)), [dirty, staged]);

  /** Empty string = commit is allowed; otherwise the reason it is not. */
  const commitBlocker = !root
    ? "Open a folder first — Source Control works on the open folder's clone"
    : !gitBranch
      ? "This folder is not a git repository"
      : stagedPaths.length === 0
        ? "Stage changes first — hover a file and press + (or stage all)"
        : !message.trim()
          ? "Write a commit message first"
          : busy
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

  function refreshAll() {
    void refreshBranches(root);
    void refreshHistory(root);
    void refreshLocalGit(root);
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

  async function doCommit() {
    if (!gitBranch || commitBlocker || busy) return;
    const ok = await onCommit(stagedPaths, message);
    if (ok) {
      setMessage("");
      setStaged(new Set());
    }
  }

  async function onCreateLocal() {
    const name = newBranch.trim();
    if (!name || creatingBranch) return;
    const ok = await onCreateBranch(name);
    if (ok) {
      setCreating(false);
      setNewBranch("");
    }
  }

  function commitWhen(info: LocalCommit): string {
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
          <button aria-label="Pull (git pull)" className="wb-icon-btn" disabled={!gitBranch || busy} onClick={() => void onPull()} title="Pull (git pull)" type="button">
            <ArrowDownToLine size={14} />
          </button>
          <button aria-label="Push (git push)" className="wb-icon-btn" disabled={!gitBranch || busy} onClick={() => void onPush()} title="Push (git push)" type="button">
            <ArrowUp size={14} />
          </button>
          <button aria-label="Refresh branches and history" className="wb-icon-btn" disabled={!root || busy} onClick={refreshAll} title="Refresh branches & history" type="button">
            <RefreshCw size={14} />
          </button>
          <button aria-label="Hide sidebar" className="wb-icon-btn" onClick={onToggleSidebar} title="Hide sidebar (Ctrl+B)" type="button">
            <PanelLeftClose size={14} />
          </button>
        </span>
      </div>
      <div className="wb-scm-body">
        {!root ? (
          <p className="wb-scm-empty">
            Open a folder (Explorer → Open Folder) to use Source Control — like VS Code, it works on the open folder's git clone.
          </p>
        ) : !gitBranch ? (
          <p className="wb-scm-empty">
            This folder is not a git repository — pull, push, commit and branches work on a git clone opened via Open Folder.
          </p>
        ) : null}

        <div className="wb-scm-commit">
          <textarea
            className="wb-scm-message"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !commitBlocker && !busy) {
                event.preventDefault();
                void doCommit();
              }
            }}
            placeholder="Message (Ctrl+Enter to commit)"
            rows={2}
            spellCheck={false}
            value={message}
          />
          <button
            className="wb-scm-btn primary"
            disabled={Boolean(commitBlocker) || busy}
            onClick={() => void doCommit()}
            title={commitBlocker || undefined}
            type="button"
          >
            <Check size={14} />
            {busy ? "Working…" : `Commit${stagedPaths.length > 0 ? ` (${stagedPaths.length})` : ""}`}
          </button>
        </div>

        {gitBranch ? (
          <section className="wb-scm-section">
            <div
              className="wb-scm-heading wb-scm-collapsible"
              onClick={() => setOpenBranch((v) => !v)}
              onKeyDown={(event) => {
                collapsibleKey(event);
                if (event.key === "Enter" || event.key === " ") setOpenBranch((v) => !v);
              }}
              role="button"
              tabIndex={0}
            >
              <span className="wb-scm-chev">{openBranch ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              <GitBranch size={13} />
              Branch <span className="wb-scm-count">{gitBranch}</span>
              <span className="wb-scm-heading-actions" onClick={(event) => event.stopPropagation()}>
                <button aria-label="New branch" className="wb-icon-btn" disabled={busy || creating} onClick={() => setCreating(true)} title="Create a branch and switch to it" type="button">
                  <Plus size={13} />
                </button>
                <button aria-label="Reload branch list" className="wb-icon-btn" disabled={busy} onClick={() => void refreshBranches(root)} title="Reload branch list" type="button">
                  <RefreshCw size={13} />
                </button>
              </span>
            </div>
            {openBranch ? (
              <>
                {creating ? (
                  <div className="wb-scm-branch-create">
                    <input
                      className="wb-scm-input"
                      onChange={(event) => setNewBranch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && newBranch.trim()) void onCreateLocal();
                      }}
                      placeholder="new-branch-name"
                      spellCheck={false}
                      value={newBranch}
                    />
                    <button className="wb-scm-btn wb-scm-btn-inline" disabled={creatingBranch || !newBranch.trim()} onClick={() => void onCreateLocal()} type="button">
                      {creatingBranch ? "Creating…" : "Create"}
                    </button>
                    <button aria-label="Cancel new branch" className="wb-icon-btn" onClick={() => { setCreating(false); setNewBranch(""); }} title="Cancel" type="button">
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="wb-scm-branch-row">
                    <BranchPicker
                      branches={branches}
                      disabled={busy || creating}
                      onChange={(name) => void onCheckout(name)}
                      value={gitBranch}
                    />
                  </div>
                )}
                {branchesNote ? <p className="wb-scm-note">{branchesNote}</p> : null}
              </>
            ) : null}
          </section>
        ) : null}

        {conflicts.length > 0 ? (
          <section className="wb-scm-section wb-scm-conflicts" role="alert">
            <div className="wb-scm-heading">
              <AlertTriangle size={13} />
              Merge conflicts <span className="wb-scm-count">{conflicts.length}</span>
            </div>
            <ul className="wb-scm-list">
              {conflicts.map((path) => (
                <li className="wb-scm-row" key={path}>
                  <button className="wb-scm-file" onClick={() => onOpenDiff(path)} title={`${path} — open diff`} type="button">
                    <span className="wb-tree-icon">{fileIconElement(path)}</span>
                    <span className="wb-scm-name">{path}</span>
                  </button>
                  <span className="wb-scm-status" title="Conflicted">!</span>
                </li>
              ))}
            </ul>
            <p className="wb-scm-empty">
              Resolve the conflict markers in the editor (or <span className="mono">git checkout --ours/--theirs</span> in the terminal), then stage the files. Stash pop conflicts keep the stash until resolved.
            </p>
          </section>
        ) : null}

        {root && (stashes.length > 0 || dirtyPaths.size > 0) ? (
          <section className="wb-scm-section">
            <div
              className="wb-scm-heading wb-scm-collapsible"
              onClick={() => setOpenStash((v) => !v)}
              onKeyDown={(event) => {
                collapsibleKey(event);
                if (event.key === "Enter" || event.key === " ") setOpenStash((v) => !v);
              }}
              role="button"
              tabIndex={0}
            >
              <span className="wb-scm-chev">{openStash ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              Stashes <span className="wb-scm-count">{stashes.length}</span>
              <span className="wb-scm-heading-actions" onClick={(event) => event.stopPropagation()}>
                <button aria-label="Stash all changes" className="wb-icon-btn" disabled={localGitBusy || busy || dirty.length === 0} onClick={() => void stashAll()} title="Park all changes in the stash (working tree back to HEAD)" type="button">
                  <Archive size={13} />
                </button>
                <button aria-label="Refresh stashes" className="wb-icon-btn" disabled={localGitBusy} onClick={() => void refreshLocalGit(root)} title="Refresh stash list" type="button">
                  <RefreshCw size={13} />
                </button>
              </span>
            </div>
            {openStash ? (
              stashes.length === 0 ? (
                <p className="wb-scm-empty">No stashes. The stash button parks your uncommitted changes and cleans the tree.</p>
              ) : (
                <ul className="wb-scm-list">
                  {stashes.map((row, index) => (
                    <li className="wb-scm-row" key={row.ref}>
                      <span className="wb-scm-file" title={row.subject}>
                        <span className="wb-tree-icon"><Archive size={13} /></span>
                        <span className="wb-scm-name">{row.subject}</span>
                      </span>
                      <span className="wb-scm-row-actions">
                        <button aria-label={`Pop ${row.ref}`} className="wb-icon-btn" disabled={localGitBusy || busy} onClick={() => void stashPop(index)} title="Pop this stash back into the working tree" type="button">
                          <ArchiveRestore size={13} />
                        </button>
                        <button aria-label={`Drop ${row.ref}`} className="wb-icon-btn" disabled={localGitBusy} onClick={() => void stashDrop(index)} title="Drop this stash" type="button">
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>
        ) : null}

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

        {gitBranch ? (
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
                <button aria-label="Reload commits" className="wb-icon-btn" disabled={loadingHistory} onClick={() => void refreshHistory(root)} title="Reload commits" type="button">
                  <RefreshCw className={loadingHistory ? "wb-scm-spin" : undefined} size={13} />
                </button>
              </span>
            </div>
            {openHistory ? (
              history.length === 0 ? (
                <p className="wb-scm-empty">{historyNote || "No commits on this branch yet."}</p>
              ) : (
                <ul className="wb-scm-history">
                  {history.map((commit) => (
                    <li key={commit.sha}>
                      <span className="wb-scm-commit-row" title={`${commit.subject}${commit.author ? `\n${commit.author}` : ""}`}>
                        <span className="wb-scm-commit-msg">{commit.subject || commit.sha.slice(0, 7)}</span>
                        <span className="wb-scm-commit-meta">
                          {commit.sha.slice(0, 7)}
                          {commit.author ? ` · ${commit.author}` : ""}
                          {commitWhen(commit) ? ` · ${commitWhen(commit)}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>
        ) : null}
      </div>

      {confirmingDiscardAll ? (
        <ConfirmDialog
          confirmLabel="Discard"
          message={`This reverts ${unstagedPaths.length} file${unstagedPaths.length === 1 ? "" : "s"} to their baseline — the version as loaded, pulled, or last committed. Edits since then are lost.`}
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
