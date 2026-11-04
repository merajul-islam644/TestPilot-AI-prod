// One row of the explorer tree -- folder or file. The chevron column
// is shared by both kinds (files render a spacer) so a file's icon
// always lines up with its parent folder's icon, like VS Code.

import { ChevronDown, ChevronRight, FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import type { TreeNode } from "../model/treeModel";
import { fileIconElement, folderIconElement } from "../icons/fileIcon";

export function TreeRow({ node, depth, expanded, activePath, dirtyPaths, runnablePaths, onNewFileIn, onNewFolderIn, onOpenFile, onRenameRow, onRequestDelete, onToggleDir }: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  activePath: string;
  dirtyPaths: Set<string>;
  runnablePaths: Set<string>;
  onNewFileIn: (folder: string) => void;
  onNewFolderIn: (folder: string) => void;
  onOpenFile: (path: string) => void;
  onRenameRow: (path: string) => void;
  onRequestDelete: (path: string, isFolder?: boolean) => void;
  onToggleDir: (path: string) => void;
}) {
  const children = node.children;
  if (children !== undefined) {
    const open = expanded.has(node.path);
    return (
      <>
        <button className={`wb-tree-row${open ? " open" : ""}`} onClick={() => onToggleDir(node.path)} style={{ paddingLeft: 6 + depth * 12 }} type="button">
          <span className="wb-tree-chevron">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          <span className="wb-tree-icon">{folderIconElement(node.name, open)}</span>
          <span className="wb-tree-name">{node.name}</span>
          {/* Hover actions: new file / new folder inside, delete the folder. Spans
              (not buttons): the row itself is a <button>, nesting is invalid HTML. */}
          <span className="wb-tree-acts">
            <span
              aria-label={`New file in ${node.name}`}
              className="wb-tree-act"
              onClick={(event) => {
                event.stopPropagation();
                onNewFileIn(node.path);
              }}
              role="button"
              title="New file in this folder"
            >
              <FilePlus size={12} />
            </span>
            <span
              aria-label={`New folder in ${node.name}`}
              className="wb-tree-act"
              onClick={(event) => {
                event.stopPropagation();
                onNewFolderIn(node.path);
              }}
              role="button"
              title="New folder inside this folder"
            >
              <FolderPlus size={12} />
            </span>
            <span
              aria-label={`Rename folder ${node.name}`}
              className="wb-tree-act"
              onClick={(event) => {
                event.stopPropagation();
                onRenameRow(node.path);
              }}
              role="button"
              title="Rename folder (moves every file inside)"
            >
              <Pencil size={12} />
            </span>
            <span
              aria-label={`Delete folder ${node.name}`}
              className="wb-tree-act danger"
              onClick={(event) => {
                event.stopPropagation();
                onRequestDelete(node.path, true);
              }}
              role="button"
              title="Delete folder (removes every file inside)"
            >
              <Trash2 size={12} />
            </span>
          </span>
        </button>
        {open ? children.map((child) => (
          <TreeRow
            activePath={activePath}
            depth={depth + 1}
            dirtyPaths={dirtyPaths}
            expanded={expanded}
            key={child.path}
            node={child}
            onNewFileIn={onNewFileIn}
            onNewFolderIn={onNewFolderIn}
            onOpenFile={onOpenFile}
            onRenameRow={onRenameRow}
            onRequestDelete={onRequestDelete}
            onToggleDir={onToggleDir}
            runnablePaths={runnablePaths}
          />
        )) : null}
      </>
    );
  }
  return (
    <button
      className={`wb-tree-row${node.path === activePath ? " active" : ""}`}
      onClick={() => onOpenFile(node.path)}
      style={{ paddingLeft: 6 + depth * 12 }}
      type="button"
    >
      <span className="wb-tree-chevron" />
      <span className="wb-tree-icon">{fileIconElement(node.path)}</span>
      <span className="wb-tree-name">{node.name}</span>
      {runnablePaths.has(node.path) ? <span className="wb-run-badge" title="Runnable spec" /> : null}
      {dirtyPaths.has(node.path) ? <span className="wb-dirty-dot" title="Unsaved changes" /> : null}
      <span className="wb-tree-acts">
        <span
          aria-label={`Rename ${node.name}`}
          className="wb-tree-act"
          onClick={(event) => {
            event.stopPropagation();
            onRenameRow(node.path);
          }}
          role="button"
          title="Rename file"
        >
          <Pencil size={12} />
        </span>
        <span
          aria-label={`Delete ${node.name}`}
          className="wb-tree-act danger"
          onClick={(event) => {
            event.stopPropagation();
            onRequestDelete(node.path);
          }}
          role="button"
          title="Delete file"
        >
          <Trash2 size={12} />
        </span>
      </span>
    </button>
  );
}
