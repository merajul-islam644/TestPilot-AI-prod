// Explorer sidebar view: the workspace file tree with per-type icons.
// Folder rows toggle expansion and carry hover actions (new file, new
// folder, delete); file rows open an editor tab and delete on hover.
// New file / new folder both land in one inline input at the top of
// the tree, pre-filled with the target folder path when launched from
// a row. The pane header carries new-file, open-folder, collapse-all
// and the sidebar hide button. With no folder open, the empty state
// IS the open-folder CTA — one click opens the native folder dialog.

import { useEffect, useMemo, useState } from "react";
import { FileInput, FilePlus, FolderOpen, FolderPlus, PanelLeftClose } from "lucide-react";
import type { ImportProgress } from "../../../lib/blocks/data";
import { withRootNode, type TreeNode } from "../model/treeModel";
import { TreeRow } from "./TreeRow";

type Adding = { kind: "file" | "folder" | "rename"; folder: string | null; original: string | null };

export function ExplorerView({ tree, activePath, dirtyPaths, expanded, opening, importProgress, newFileSignal, root, runnablePaths, onNewFile, onNewFolder, onOpenFile, onRename, onRequestDelete, onToggleDir, onToggleSidebar, onImport, onOpenFileFromDisk }: {
  tree: TreeNode[];
  activePath: string;
  dirtyPaths: Set<string>;
  expanded: Set<string>;
  /** True while a folder is being opened (tree walk + first reads). */
  opening: boolean;
  /** Live progress for folder open / pull — drives the progress block above the tree. */
  importProgress: ImportProgress | null;
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
  /** Open the native OS folder dialog. */
  onImport: () => void;
  /** Open the native OS file dialog — the file's folder becomes the
   *  workspace and the file opens. */
  onOpenFileFromDisk: () => void;
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

  function progressLabel(progress: ImportProgress): string {
    switch (progress.phase) {
      case "clearing": return "Opening folder…";
      case "reading": return `Reading ${progress.done}/${progress.total}`;
      case "writing": return `Writing ${progress.done}/${progress.total}`;
    }
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
        {importProgress ? (
          <div className="wb-import-progress" role="status">
            <span className="wb-import-progress-label">{progressLabel(importProgress)}</span>
            <span className="wb-import-progress-track" aria-hidden="true">
              <span
                className="wb-import-progress-fill"
                style={{
                  width: importProgress.phase === "clearing" || importProgress.total === 0
                    ? "100%"
                    : `${Math.round((importProgress.done / importProgress.total) * 100)}%`
                }}
              />
            </span>
          </div>
        ) : null}
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
        {!root
          ? <button className="wb-tree-empty muted wb-tree-empty-cta" disabled={opening} onClick={onImport} type="button">
              Open a folder from your machine to browse and edit its files here — edits save to disk as you go.
            </button>
          : (
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
