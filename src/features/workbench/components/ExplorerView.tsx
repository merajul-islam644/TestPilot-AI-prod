// Explorer sidebar view: the workspace file tree with per-type icons.
// Folder rows toggle expansion and carry hover actions (new file, new
// folder, delete); file rows open an editor tab and delete on hover.
// New file / new folder both land in one inline input at the top of
// the tree, pre-filled with the target folder path when launched from
// a row. The pane header carries new-file, open-folder, collapse-all
// and the sidebar hide button. With no folder open, the empty state
// IS the open-folder CTA — one click opens the native folder dialog.

import { useEffect, useMemo, useState } from "react";
import { FileInput, FilePlus, FolderOpen, FolderPlus, PanelLeftClose, RefreshCw } from "lucide-react";
import { withRootNode, type TreeNode } from "../model/treeModel";
import { TreeRow } from "./TreeRow";

type Adding = { kind: "file" | "folder" | "rename"; folder: string | null; original: string | null };

export function ExplorerView({ tree, activePath, dirtyPaths, expanded, fsaReconnect, opening, newFileSignal, root, runnablePaths, onNewFile, onNewFolder, onOpenFile, onReconnectFsa, onRename, onRequestDelete, onToggleDir, onToggleSidebar, onImport, onOpenFileFromDisk }: {
  tree: TreeNode[];
  activePath: string;
  dirtyPaths: Set<string>;
  expanded: Set<string>;
  /** A saved browser-handle workspace waiting for its permission to be
   *  re-granted — shows a reconnect banner above the tree (empty state).
   *  The click that presses the banner is the gesture the browser needs. */
  fsaReconnect?: { name: string } | null;
  /** True while a folder is being opened (tree walk + first reads). */
  opening: boolean;
  /** Bumped by "File: New File" (palette) to open the inline input. */
  newFileSignal: number;
  /** The open workspace folder on disk, or null when nothing is open. */
  root: string | null;
  runnablePaths: Set<string>;
  onNewFile: (path: string) => Promise<boolean>;
  onNewFolder: (path: string) => Promise<boolean>;
  onOpenFile: (path: string) => void;
  /** Persisted rename of a file or folder (with its contents). */
  onRename: (from: string, to: string) => Promise<boolean>;
  onRequestDelete: (path: string, isFolder?: boolean) => void;
  onToggleDir: (path: string) => void;
  onToggleSidebar: () => void;
  /** Open the workspace folder dialog (browser picker or native OS). */
  onImport: () => void;
  /** Open the file dialog — the file's folder becomes the workspace
   *  and the file opens. */
  onOpenFileFromDisk: () => void;
  /** Re-grant the saved browser-handle workspace's permission (must be
   *  called from a click — that click IS the permission gesture). */
  onReconnectFsa?: () => void;
}) {
  const [adding, setAdding] = useState<Adding | null>(null);
  const [draft, setDraft] = useState("");

  // The open folder itself as the top row — the codebase's identity,
  // the way VS Code pins the workspace root above every file. The root
  // row is forced open via the "" path it carries.
  const rootTree = withRootNode(tree, root);
  const expandedWithRoot = useMemo(() => {
    const set = new Set(expanded);
    if (root) set.add("");
    return set;
  }, [expanded, root]);

  function startAdding(kind: Adding["kind"], folder: string | null) {
    setAdding({ kind, folder, original: null });
    setDraft(folder ? `${folder}/` : "");
  }

  function startRenaming(original: string) {
    setAdding({ kind: "rename", folder: null, original });
    setDraft(original);
  }

  // The palette's New File command lands here via the signal counter.
  useEffect(() => {
    if (newFileSignal > 0) startAdding("file", null);
  }, [newFileSignal]);

  // Enter commits, Escape cancels, clicking away cancels. The `adding`
  // guard keeps the blur (which Enter itself triggers) from cancelling.
  async function finish(submit: boolean) {
    if (!adding) return;
    const { kind, original } = adding;
    setAdding(null);
    if (!submit) return;
    const path = draft;
    setDraft("");
    if (kind === "rename" && original) await onRename(original, path);
    else if (kind === "folder") await onNewFolder(path);
    else await onNewFile(path);
  }

  return (
    <div className="wb-view">
      <div className="wb-view-head">
        <span className="wb-view-title">Explorer</span>
        <span className="wb-view-actions">
          <button aria-label="New folder" className="wb-icon-btn" onClick={() => startAdding("folder", null)} title="New folder" type="button">
            <FolderPlus size={14} />
          </button>
          <button aria-label="New file" className="wb-icon-btn" onClick={() => startAdding("file", null)} title="New file" type="button">
            <FilePlus size={14} />
          </button>
          <button aria-label="Open folder from disk" className="wb-icon-btn" disabled={opening} onClick={onImport} title="Open folder from disk" type="button">
            <FolderOpen size={14} />
          </button>
          <button aria-label="Open a file from disk" className="wb-icon-btn" disabled={opening} onClick={onOpenFileFromDisk} title="Open a file from disk" type="button">
            <FileInput size={14} />
          </button>
          <button aria-label="Hide sidebar" className="wb-icon-btn" onClick={onToggleSidebar} title="Hide sidebar (Ctrl+B)" type="button">
            <PanelLeftClose size={14} />
          </button>
        </span>
      </div>
      <div className="wb-tree">
        {adding ? (
          <div className="wb-tree-newfile">
            <input
              aria-label={adding.kind === "rename" ? "Rename to" : adding.kind === "folder" ? "New folder path" : "New file path"}
              autoFocus
              className="wb-tree-newfile-input"
              onBlur={() => void finish(false)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void finish(true);
                else if (event.key === "Escape") setAdding(null);
              }}
              placeholder={
                adding.kind === "rename"
                  ? "New name or full path — contents move with it"
                  : adding.kind === "folder"
                    ? "folder/name — empty folders get a .gitkeep"
                    : "path/to/file.spec.mjs"
              }
              spellCheck={false}
              value={draft}
            />
          </div>
        ) : null}
        {fsaReconnect ? (
          // Prominent on purpose: this is the "your workspace is one click
          // away" state after a sign-out/reload, not a quiet empty prompt.
          <button
            className="wb-tree-reconnect"
            onClick={onReconnectFsa}
            title="The browser needs one click to re-grant access to this folder"
            type="button"
          >
            <RefreshCw className="wb-tree-reconnect-icon" size={16} />
            <span className="wb-tree-reconnect-text">
              <strong>Reconnect “{fsaReconnect.name}”</strong>
              The workspace is saved — one click re-grants folder access
              after a sign-out or reload, and your open files come back.
            </span>
          </button>
        ) : null}
        {!root && !fsaReconnect ? (
          // The no-folder empty state: a centered welcome card — icon,
          // one-line pitch, the primary action, a single-file alternative
          // and the palette path for keyboard users.
          <div className="wb-tree-empty-state">
            <FolderOpen className="wb-tree-empty-icon" size={24} />
            <p className="wb-tree-empty-title">No workspace open</p>
            <p className="wb-tree-empty-body">
              Open a folder from your machine — its files stay on your
              disk and edits save as you type.
            </p>
            <button className="wb-empty-open" disabled={opening} onClick={onImport} type="button">
              <FolderOpen size={13} />
              Open Folder
            </button>
            <button className="wb-empty-secondary" disabled={opening} onClick={onOpenFileFromDisk} type="button">
              <FileInput size={12} />
              or open a single file
            </button>
            <p className="wb-tree-empty-hint">Ctrl+Shift+P → “Workspace: Open Folder (disk)”</p>
          </div>
        ) : (
            <>
              {rootTree.map((node) => (
                <TreeRow
                  activePath={activePath}
                  depth={0}
                  dirtyPaths={dirtyPaths}
                  expanded={expandedWithRoot}
                  isRoot
                  key={node.path || "__root__"}
                  node={node}
                  onNewFileIn={(folder) => startAdding("file", folder || null)}
                  onNewFolderIn={(folder) => startAdding("folder", folder || null)}
                  onOpenFile={onOpenFile}
                  onRenameRow={startRenaming}
                  onRequestDelete={onRequestDelete}
                  onToggleDir={onToggleDir}
                  runnablePaths={runnablePaths}
                />
              ))}
              {tree.length === 0 ? <p className="wb-tree-empty muted">This folder is empty. Create a spec with the + button above, or pull a repo from Source Control.</p> : null}
            </>
          )}
      </div>
    </div>
  );
}
