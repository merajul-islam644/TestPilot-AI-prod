// Editor tab strip: one tab per open file, VS Code style. The active
// tab merges into the editor surface (no bottom border on it), dirty
// files carry the amber dot, and tabs close via the X or middle-click.
// The strip's RIGHT end carries the editor title actions: the active
// file's auto-save status (green "Saved" tick / red "Save failed") and
// undo/redo buttons that drive the live Monaco model (editorActions).

import { Check, LoaderCircle, Redo2, RotateCw, TriangleAlert, Undo2, X } from "lucide-react";
import { basenameOf } from "../model/treeModel";
import { fileIconElement } from "../icons/fileIcon";
import { redoActive, undoActive } from "../lib/editorActions";

export function EditorTabs({ paths, activePath, dirtyPaths, saving, saveState, onSelect, onClose }: {
  paths: string[];
  activePath: string;
  dirtyPaths: Set<string>;
  saving: boolean;
  /** The active file's auto-save status, shown at the strip's right end. */
  saveState?: "pending" | "saving" | "saved" | "error";
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  return (
    <div className="wb-tabs" role="tablist">
      {paths.map((path) => {
        const isActive = path === activePath;
        const isDirty = dirtyPaths.has(path);
        return (
          <div
            aria-selected={isActive}
            className={`wb-tab${isActive ? " active" : ""}`}
            key={path}
            onClick={() => onSelect(path)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(path);
              }
            }}
            onMouseDown={(event) => {
              // Middle-click closes the tab (VS Code behaviour).
              if (event.button === 1) {
                event.preventDefault();
                onClose(path);
              }
            }}
            role="tab"
            title={path}
          >
            <span className="wb-tree-icon">{fileIconElement(path)}</span>
            <span className="wb-tab-name">{basenameOf(path)}</span>
            {isDirty && isActive && saving ? (
              <RotateCw className="wb-spin" size={11} />
            ) : isDirty ? (
              <span className="wb-dirty-dot" />
            ) : null}
            <button
              aria-label={`Close ${basenameOf(path)}`}
              className="wb-tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onClose(path);
              }}
              title="Close"
              type="button"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <span className="wb-tabs-actions">
        <span className={`wb-editor-save${saveState ? ` is-${saveState}` : ""}`}>
          {saveState === "pending" ? (
            <>
              <LoaderCircle className="wb-spin" size={12} />
              Unsaved
            </>
          ) : saveState === "saving" ? (
            <>
              <LoaderCircle className="wb-spin" size={12} />
              Saving…
            </>
          ) : saveState === "saved" ? (
            <>
              <Check size={12} />
              Saved
            </>
          ) : saveState === "error" ? (
            <>
              <TriangleAlert size={12} />
              Save failed
            </>
          ) : null}
        </span>
        <button
          aria-label="Undo"
          className="wb-icon-btn"
          onClick={undoActive}
          title="Undo (Ctrl+Z)"
          type="button"
        >
          <Undo2 size={14} />
        </button>
        <button
          aria-label="Redo"
          className="wb-icon-btn"
          onClick={redoActive}
          title="Redo (Ctrl+Y)"
          type="button"
        >
          <Redo2 size={14} />
        </button>
      </span>
    </div>
  );
}
