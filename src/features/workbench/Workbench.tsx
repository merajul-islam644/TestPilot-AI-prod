// The Tests-tab workbench -- a VS Code-style shell hosting the
// Playwright workspace: activity bar + sidebar (Explorer / Search /
// Source Control / Run), tabbed Monaco editor, bottom panel (Output /
// Test Results), status bar and a dual-mode command palette.
//
// Composition rules that keep this file thin:
//   • workspace data behaviour lives in useTestWorkspace,
//   • chrome/UI state lives in workbenchStore,
//   • pure helpers live in model/treeModel.
// This component only wires the three together plus keyboard shortcuts.

import { useEffect, useMemo, useState } from "react";
import { PanelLeft } from "lucide-react";
import { ActivityBar } from "./components/ActivityBar";
import { ExplorerView } from "./components/ExplorerView";
import { SearchView } from "./components/SearchView";
import { SourceControlView } from "./components/SourceControlView";
import { RunView } from "./components/RunView";
import { EditorTabs } from "./components/EditorTabs";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { EditorHost } from "./components/EditorHost";
import { SidebarSash } from "./components/SidebarSash";
import { BottomPanel } from "./components/BottomPanel";
import { CommandPalette, type WorkbenchCommand } from "./components/CommandPalette";
import { StatusBar } from "./components/StatusBar";
import { useTestWorkspace } from "./data/useTestWorkspace";
import { workbenchStore, useWorkbench } from "./state/workbenchStore";
import type { SidebarView } from "./state/workbenchStore";
import { basenameOf, buildTree, defaultExpanded, languageOf } from "./model/treeModel";
import { isRunnableSpecPath } from "../../lib/workspace/importFiles";
import type { Project } from "../../lib/demo/data";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useT } from "../../lib/i18n/LocalizationProvider";
import "./workbench.css";

const WATERMARK_ROWS: [string, string][] = [
  ["Show All Commands", "Ctrl + Shift + P"],
  ["Go to File", "Ctrl + P"],
  ["Save File", "Ctrl + S"],
  ["Toggle Terminal", "Ctrl + `"],
  ["Toggle Sidebar", "Ctrl + B"],
  ["Toggle Panel", "Ctrl + J"]
];

export function Workbench({ project }: { project: Project }) {
  const { t } = useT();
  const ws = useTestWorkspace(project);

  const sidebarView = useWorkbench((s) => s.sidebarView);
  const sidebarVisible = useWorkbench((s) => s.sidebarVisible);
  const sidebarWidth = useWorkbench((s) => s.sidebarWidth);
  const panelVisible = useWorkbench((s) => s.panelVisible);
  const panelTab = useWorkbench((s) => s.panelTab);
  const panelMaximized = useWorkbench((s) => s.panelMaximized);
  const openTabs = useWorkbench((s) => s.openTabs);
  const activePath = useWorkbench((s) => s.activePath);
  const diffTabs = useWorkbench((s) => s.diffTabs);
  const expandedPaths = useWorkbench((s) => s.expanded);
  const paletteMode = useWorkbench((s) => s.palette);

  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);
  /** Bumped to pop the explorer's inline new-file input from the palette. */
  const [newFileSignal, setNewFileSignal] = useState(0);

  const paths = useMemo(() => ws.files.map((file) => file.path), [ws.files]);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const expanded = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const runnablePaths = useMemo(() => new Set(ws.files.filter((file) => isRunnableSpecPath(file.path)).map((file) => file.path)), [ws.files]);
  const language = activePath ? languageOf(activePath) : "plaintext";

  // Bind the store to this project first: it preloads the saved editor
  // session (open tabs / active file / expanded folders) from
  // localStorage so a refresh reopens exactly what was open.
  useEffect(() => {
    workbenchStore.bindProject(project.id);
  }, [project.id]);

  // A new workspace SESSION (initial load or import): restore the saved
  // session when it matches this file set, else open the first runnable
  // spec in a fresh tab. Keyed on revision, not files -- ordinary edits
  // must never reset the user's tabs.
  useEffect(() => {
    if (!ws.loaded) return;
    const paths = ws.files.map((file) => file.path);
    if (workbenchStore.consumeFreshSession() || !workbenchStore.restorePersistedSession(paths)) {
      const first = ws.files.find((file) => isRunnableSpecPath(file.path)) ?? ws.files[0];
      workbenchStore.resetSession(first?.path ?? "", defaultExpanded(paths));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ws.files is read fresh at revision bumps
  }, [ws.loaded, ws.revision]);

  // A freshly created file should be visible immediately: expand its
  // parent folders, then open it.
  useEffect(() => {
    if (!ws.createdPath) return;
    const segments = ws.createdPath.split("/");
    const parents: string[] = [];
    for (let i = 1; i < segments.length; i++) parents.push(segments.slice(0, i).join("/"));
    if (parents.length > 0) workbenchStore.setExpanded([...workbenchStore.getState().expanded, ...parents]);
    workbenchStore.openTab(ws.createdPath);
  }, [ws.createdPath]);

  // A rename moves tabs, the active editor and folder expansion with it.
  useEffect(() => {
    if (ws.renameTick > 0) workbenchStore.renamePaths(ws.renameMap);
  }, [ws.renameTick, ws.renameMap]);

  // After a run, surface the results; on a runner failure, the output.
  useEffect(() => {
    if (ws.outcome) workbenchStore.showPanel("results");
  }, [ws.outcome]);
  useEffect(() => {
    if (ws.errorText) workbenchStore.showPanel("output");
  }, [ws.errorText]);

  // Files that vanished (deleted / replaced) must not leave ghost tabs.
  useEffect(() => {
    if (!ws.loaded) return;
    workbenchStore.prune(paths);
  }, [ws.loaded, paths]);

  // VS Code behaviour: once a diffed file's edits are saved (or reverted),
  // there is nothing left to compare -- collapse the diff back to the
  // plain editor instead of showing two identical panes.
  const activeIsDiff = activePath !== "" && diffTabs.includes(activePath);
  useEffect(() => {
    if (activeIsDiff && activePath && !ws.dirtyPaths.has(activePath)) workbenchStore.exitDiff(activePath);
  }, [activeIsDiff, activePath, ws.dirtyPaths]);

  // Keyboard layer: VS Code's core chords. Capture phase so they beat
  // the browser (Ctrl+S) and Monaco's own keymap.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) {
        if (event.key === "Escape") workbenchStore.closePalette();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (activePath && ws.dirtyPaths.has(activePath)) void ws.saveFile(activePath);
      } else if (key === "p" && event.shiftKey) {
        event.preventDefault();
        workbenchStore.openPalette("commands");
      } else if (key === "p") {
        event.preventDefault();
        workbenchStore.openPalette("files");
      } else if (key === "b") {
        event.preventDefault();
        workbenchStore.toggleSidebar();
      } else if (key === "j") {
        event.preventDefault();
        workbenchStore.togglePanel();
      } else if (key === "`") {
        // VS Code's Ctrl+`: focus/toggle the terminal panel tab.
        event.preventDefault();
        const current = workbenchStore.getState();
        if (current.panelVisible && current.panelTab === "terminal") workbenchStore.togglePanel();
        else workbenchStore.showPanel("terminal");
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activePath, ws]);

  const commands: WorkbenchCommand[] = useMemo(() => [
    { id: "wb.run", label: `Tests: ${t("tests.run")} All Specs`, run: () => { workbenchStore.setSidebarView("run"); void ws.run(); } },
    { id: "wb.save", label: `File: ${t("tests.save")}`, run: () => { if (activePath) void ws.saveFile(activePath); } },
    { id: "wb.saveAll", label: "File: Save All", run: () => void ws.saveAll() },
    { id: "wb.newFile", label: "File: New File", run: () => { workbenchStore.setSidebarView("explorer"); setNewFileSignal((v) => v + 1); } },
    { id: "wb.import", label: "Workspace: Open Folder (disk)", run: () => { workbenchStore.setSidebarView("explorer"); void ws.openFolder(); } },
    { id: "wb.gitPull", label: "Git: Pull from GitHub", run: () => workbenchStore.setSidebarView("scm") },
    { id: "wb.gitPush", label: "Git: Commit & Push", run: () => workbenchStore.setSidebarView("scm") },
    { id: "wb.explorer", label: "View: Explorer", run: () => workbenchStore.setSidebarView("explorer") },
    { id: "wb.search", label: "View: Search", run: () => workbenchStore.setSidebarView("search") },
    { id: "wb.scm", label: "View: Source Control", run: () => workbenchStore.setSidebarView("scm") },
    { id: "wb.runView", label: "View: Run", run: () => workbenchStore.setSidebarView("run") },
    { id: "wb.sidebar", label: "View: Toggle Sidebar", run: () => workbenchStore.toggleSidebar() },
    { id: "wb.panel", label: "View: Toggle Panel", run: () => workbenchStore.togglePanel() },
    { id: "wb.output", label: "Panel: Show Output", run: () => workbenchStore.showPanel("output") },
    { id: "wb.results", label: "Panel: Show Test Results", run: () => workbenchStore.showPanel("results") },
    { id: "wb.terminal", label: "Panel: Show Terminal", run: () => workbenchStore.showPanel("terminal") }
  ], [t, ws, activePath]);

  return (
    <div className="wb-root">
      {/* The sidebar is hidden (Ctrl+B / hide button): keep a visible way back. */}
      {!sidebarVisible ? (
        <button aria-label="Show sidebar" className="wb-sidebar-restore" onClick={() => workbenchStore.toggleSidebar()} title="Show sidebar (Ctrl+B)" type="button">
          <PanelLeft size={15} />
        </button>
      ) : null}
      <div className="wb-frame">
        <ActivityBar
          active={sidebarView}
          changesCount={ws.dirtyPaths.size}
          onSelect={(view: SidebarView) => workbenchStore.setSidebarView(view)}
          visible={sidebarVisible}
        />

        {sidebarVisible ? (
          <aside className="wb-sidebar" style={{ width: sidebarWidth }}>
            {sidebarView === "explorer" ? (
              <ExplorerView
                activePath={activePath}
                dirtyPaths={ws.dirtyPaths}
                expanded={expanded}
                importProgress={ws.importProgress}
                newFileSignal={newFileSignal}
                onImport={() => void ws.openFolder()}
                onNewFile={async (path) => {
                  const created = await ws.createFile(path);
                  return created;
                }}
                onNewFolder={(path) => ws.createFolder(path)}
                onOpenFile={(path) => workbenchStore.openTab(path)}
                onRename={(from, to) => ws.renamePath(from, to)}
                onRequestDelete={ws.requestDelete}
                onToggleDir={(path) => workbenchStore.toggleDir(path)}
                onToggleSidebar={() => workbenchStore.toggleSidebar()}
                opening={ws.opening}
                root={ws.root}
                runnablePaths={runnablePaths}
                tree={tree}
              />
            ) : null}
            {sidebarView === "search" ? (
              <SearchView files={ws.files} onOpenFile={(path) => workbenchStore.openTab(path)} />
            ) : null}
            {sidebarView === "scm" ? (
              <SourceControlView
                busy={ws.saving || ws.opening}
                contentOf={ws.contentOf}
                dirtyPaths={ws.dirtyPaths}
                onOpenDiff={(path) => workbenchStore.openDiff(path)}
                onRevert={ws.revertFile}
                onSaveAll={() => void ws.saveAll()}
                onStagePull={ws.stageImport}
                onToggleSidebar={() => workbenchStore.toggleSidebar()}
              />
            ) : null}
            {sidebarView === "run" ? (
              <RunView
                baseURL={ws.baseURL}
                errorText={ws.errorText}
                filesCount={ws.files.length}
                onBaseURLChange={ws.setBaseURL}
                onRun={() => void ws.run()}
                outcome={ws.outcome}
                runnableCount={ws.runnableCount}
                runnerOnline={ws.runnerOnline}
                runnerUrl={ws.runnerUrl}
                running={ws.running}
              />
            ) : null}
            <SidebarSash />
          </aside>
        ) : null}

        <main className="wb-main">
          {openTabs.length > 0 ? (
            <EditorTabs
              activePath={activePath}
              dirtyPaths={ws.dirtyPaths}
              onClose={(path) => workbenchStore.closeTab(path)}
              onSelect={(path) => workbenchStore.setActivePath(path)}
              paths={openTabs}
              saving={ws.saving}
            />
          ) : null}
          {activePath ? <Breadcrumbs path={activePath} /> : null}
          {activePath ? (
            <EditorHost
              diff={activeIsDiff}
              originalValue={ws.savedContentOf(activePath)}
              onExitDiff={() => workbenchStore.exitDiff(activePath)}
              onChange={(content) => ws.setContent(activePath, content)}
              onCursor={setCursor}
              path={activePath}
              value={ws.contentOf(activePath)}
            />
          ) : (
            <div className="wb-watermark">
              <p className="wb-watermark-title">{basenameOf(project.name)} — TestPilot Workbench</p>
              <div className="wb-watermark-rows">
                {WATERMARK_ROWS.map(([label, keys]) => (
                  <div className="wb-watermark-row" key={label}>
                    <span>{label}</span>
                    <span className="wb-watermark-keys">{keys}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        {panelVisible ? (
          <BottomPanel
            maximized={panelMaximized}
            onClearOutput={ws.clearOutput}
            onClose={() => workbenchStore.togglePanel()}
            onTabChange={(tab) => workbenchStore.setPanelTab(tab)}
            onToggleMaximize={() => workbenchStore.togglePanelMaximize()}
            outcome={ws.outcome}
            outputLines={ws.outputLines}
            projectId={project.id}
            runnerOnline={ws.runnerOnline}
            runnerUrl={ws.runnerUrl}
            tab={panelTab}
          />
        ) : null}
      </div>

      <StatusBar
        baseURL={ws.baseURL}
        cursor={activePath ? cursor : null}
        filesCount={ws.files.length}
        importProgress={ws.importProgress}
        language={language}
        runnableCount={ws.runnableCount}
        runnerOnline={ws.runnerOnline}
        runnerUrl={ws.runnerUrl}
        root={ws.root}
      />

      {paletteMode ? (
        <CommandPalette
          commands={commands}
          mode={paletteMode}
          onClose={() => workbenchStore.closePalette()}
          onOpenFile={(path) => workbenchStore.openTab(path)}
          paths={paths}
        />
      ) : null}

      {ws.pendingDelete ? (
        <ConfirmDialog
          confirmLabel="Delete"
          message={
            ws.pendingDelete.isFolder
              ? `This deletes the folder and its ${ws.pendingDelete.count} file${ws.pendingDelete.count === 1 ? "" : "s"} from disk — unsaved edits are lost too.`
              : "This deletes the file from disk — unsaved edits are lost too."
          }
          onCancel={() => ws.dismissDelete()}
          onConfirm={() => void ws.confirmDelete()}
          title={`Delete ${ws.pendingDelete.path}?`}
        />
      ) : null}

      {ws.pendingImport ? (
        <ConfirmDialog
          confirmLabel={t("tests.importConfirmAction")}
          message={t("tests.importConfirmBody").replace("{count}", String(ws.pendingImport.files.length))}
          onCancel={() => ws.dismissImport()}
          onConfirm={() => {
            // Pulled files land in the open folder — the saved session's
            // paths may be new, so reset to defaults instead of restoring.
            workbenchStore.beginFreshSession();
            void ws.applyImport();
          }}
          title={t("tests.importConfirmTitle")}
        />
      ) : null}
    </div>
  );
}
