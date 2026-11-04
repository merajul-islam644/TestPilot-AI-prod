// Monaco host for the workbench: one editor instance that swaps
// per-path models (via `path`), tracks the app's manual/auto theme,
// and reports cursor position for the status bar.
//
// When `diff` is set (a file opened from the Source Control changes
// list), it renders Monaco's DiffEditor instead -- saved-on-disk
// content on the left, the live edits on the right, editable there
// exactly like VS Code's SCM diff. The "Open File" button leaves the
// diff back to the plain editor.

import { useEffect, useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { X } from "lucide-react";
import { useT } from "../../../lib/i18n/LocalizationProvider";
import { languageOf } from "../model/treeModel";

/** Track the app's manual/auto theme so the editor matches the shell. */
function useMonacoTheme(): "vs" | "vs-dark" {
  const read = (): "vs" | "vs-dark" => {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit) return explicit === "dark" ? "vs-dark" : "vs";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "vs-dark" : "vs";
  };
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(read());
    media.addEventListener("change", onChange);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onChange);
    };
  }, []);
  return theme;
}

const EDITOR_OPTIONS = {
  automaticLayout: true,
  fontSize: 13,
  fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  minimap: { enabled: true, maxColumn: 70, renderCharacters: false },
  padding: { top: 10, bottom: 10 },
  renderLineHighlight: "all" as const,
  scrollBeyondLastLine: false,
  tabSize: 2
};

export function EditorHost({ path, value, originalValue, diff, loading, onExitDiff, onChange, onCursor }: {
  path: string;
  value: string;
  /** Saved-on-disk content; the left side of the diff view. */
  originalValue?: string;
  /** Render as a diff editor (SCM click) instead of a plain editor. */
  diff?: boolean;
  /** Content still streaming from disk (lazy load) — editor is read-only. */
  loading?: boolean;
  /** Close the diff view: the tab stays open as a plain editor with the
   *  edits intact (the "seen the changes, back to the file" path). */
  onExitDiff?: () => void;
  onChange: (content: string) => void;
  onCursor: (position: { line: number; col: number }) => void;
}) {
  const { t } = useT();
  const monacoTheme = useMonacoTheme();

  return (
    <div className="wb-editor">
      {diff ? (
        <>
          <div className="wb-diff-bar">
            <span className="wb-diff-label">
              <span className="wb-diff-side">Saved on disk</span>
              <span className="wb-diff-arrow">↔</span>
              <span className="wb-diff-side">Your edits</span>
            </span>
            <span className="wb-diff-actions">
              <button
                aria-label="Close diff"
                className="wb-diff-open"
                onClick={onExitDiff}
                title="Close diff — the file stays open with your edits"
                type="button"
              >
                <X size={13} />
                Close
              </button>
            </span>
          </div>
          <div className="wb-diff-host">
            <DiffEditor
              height="100%"
              language={path ? languageOf(path) : "javascript"}
              loading={<span className="muted">{t("common.loading")}</span>}
              options={{
                ...EDITOR_OPTIONS,
                originalEditable: false,
                renderOverviewRuler: false
              }}
              original={originalValue ?? ""}
              theme={monacoTheme}
              modified={value}
              onMount={(diffEditor) => {
                // onMount hands us the IStandaloneDiffEditor; the panes the
                // user actually types in and reads the cursor from are its
                // *modified* editor. Content changes are wired by hand --
                // DiffEditor has no onChange prop.
                const modifiedPane = diffEditor.getModifiedEditor();
                modifiedPane.onDidChangeCursorPosition((event) => {
                  onCursor({ line: event.position.lineNumber, col: event.position.column });
                });
                modifiedPane.onDidChangeModelContent(() => onChange(modifiedPane.getValue()));
              }}
            />
          </div>
        </>
      ) : (
        <Editor
          defaultLanguage="javascript"
          height="100%"
          language={path ? languageOf(path) : "javascript"}
          loading={<span className="muted">{t("common.loading")}</span>}
          onMount={(editor) => {
            editor.onDidChangeCursorPosition((event) => {
              onCursor({ line: event.position.lineNumber, col: event.position.column });
            });
          }}
          options={{ ...EDITOR_OPTIONS, readOnly: loading || undefined }}
          path={path || "draft"}
          theme={monacoTheme}
          value={value}
          onChange={(next) => onChange(next ?? "")}
        />
      )}
      {loading ? (
        <div className="wb-editor-loading">
          <span className="muted">{t("common.loading")}</span>
        </div>
      ) : null}
    </div>
  );
}
