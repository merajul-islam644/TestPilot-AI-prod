// Registry for the ACTIVE plain editor instance. The tab strip's
// undo/redo buttons live far away from EditorHost (which owns the
// Monaco instance), so the host registers its editor here on mount and
// the strip fires undo/redo at whatever model is on screen -- no prop
// drilling through Workbench, and no re-render needed (a click reads
// the registry at call time).

import type { OnMount } from "@monaco-editor/react";

type StandaloneEditor = Parameters<OnMount>[0];

let activeEditor: StandaloneEditor | null = null;

export function setActiveEditor(editor: StandaloneEditor | null): void {
  activeEditor = editor;
}

export function undoActive(): void {
  activeEditor?.trigger("editor-tabs", "undo", null);
}

export function redoActive(): void {
  activeEditor?.trigger("editor-tabs", "redo", null);
}
