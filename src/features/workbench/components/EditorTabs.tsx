// Editor tab strip: one tab per open file, VS Code style. The active
// tab merges into the editor surface (no bottom border on it), dirty
// files carry the amber dot, and tabs close via the X or middle-click.

import { RotateCw, X } from "lucide-react";
import { basenameOf } from "../model/treeModel";
import { fileIconElement } from "../icons/fileIcon";

export function EditorTabs({ paths, activePath, dirtyPaths, saving, onSelect, onClose }: {
  paths: string[];
  activePath: string;
  dirtyPaths: Set<string>;
  saving: boolean;
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
    </div>
  );
}
