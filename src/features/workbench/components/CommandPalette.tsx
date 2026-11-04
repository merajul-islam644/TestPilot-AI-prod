// One palette, two modes -- exactly VS Code's split:
//   • "commands" (Ctrl+Shift+P): workbench actions, ranked by match
//   • "files"    (Ctrl+P): every workspace path, basename matches first
// Keyboard-first: arrows move, Enter runs, Escape closes. Click works
// too because the mouse is not a crime.

import { useEffect, useMemo, useRef, useState } from "react";
import { fileIconElement } from "../icons/fileIcon";
import { basenameOf } from "../model/treeModel";

export type WorkbenchCommand = { id: string; label: string; run: () => void };

export function CommandPalette({ mode, commands, paths, onClose, onOpenFile }: {
  mode: "commands" | "files";
  commands: WorkbenchCommand[];
  paths: string[];
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [query, setQuery] = useState(mode === "files" ? "" : ">");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const isFiles = mode === "files";
  const needle = query.replace(/^>\s*/, "").trim().toLowerCase();

  const commandHits = useMemo(
    () => (needle === "" ? commands : commands.filter((command) => command.label.toLowerCase().includes(needle))),
    [commands, needle]
  );
  const fileHits = useMemo(() => {
    if (needle === "") return paths;
    const scored = paths
      .map((path) => {
        const base = basenameOf(path).toLowerCase();
        const full = path.toLowerCase();
        const score = base.startsWith(needle) ? 0 : base.includes(needle) ? 1 : full.includes(needle) ? 2 : -1;
        return { path, score };
      })
      .filter((entry) => entry.score >= 0);
    scored.sort((a, b) => a.score - b.score || a.path.length - b.path.length);
    return scored.map((entry) => entry.path);
  }, [paths, needle]);

  const items: { key: string; label: string; hint?: string; icon?: React.ReactNode; run: () => void }[] = isFiles
    ? fileHits.slice(0, 12).map((path) => ({
        key: path,
        label: basenameOf(path),
        hint: path,
        icon: fileIconElement(path),
        run: () => onOpenFile(path)
      }))
    : commandHits.slice(0, 12).map((command) => ({ key: command.id, label: command.label, run: command.run }));

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [index]);

  function commit(item: (typeof items)[number] | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  return (
    <div className="wb-palette-overlay" onMouseDown={onClose}>
      <div
        className="wb-palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isFiles ? "Go to file" : "Command palette"}
      >
        <input
          autoFocus
          className="wb-palette-input"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((value) => Math.min(value + 1, items.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              commit(items[index]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder={isFiles ? "Go to file…" : "Type a command…"}
          spellCheck={false}
          value={query}
        />
        <div className="wb-palette-list" ref={listRef}>
          {items.length === 0 ? (
            <p className="wb-palette-empty muted">No matching {isFiles ? "files" : "commands"}.</p>
          ) : (
            items.map((item, itemIndex) => (
              <button
                className={`wb-palette-item${itemIndex === index ? " active" : ""}`}
                data-active={itemIndex === index}
                key={item.key}
                onClick={() => commit(item)}
                type="button"
              >
                {item.icon ? <span className="wb-tree-icon">{item.icon}</span> : null}
                <span className="wb-palette-label">{item.label}</span>
                {item.hint ? <span className="wb-palette-hint">{item.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
