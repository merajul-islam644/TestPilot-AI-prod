// All workspace DATA behaviour for the Tests-tab workbench: opening a
// local folder as the workspace (VS Code-style), editing and saving its
// files in place on disk, pulling repos into it, and running the suite
// through the local runner.
//
// The workspace model follows the Lattice workbench exactly: the folder
// the user picked IS the workspace — every read/write goes to the real
// file on disk through the runner's /api/workbench routes. There is no
// stored copy anywhere, so nothing a refresh or a flaky backend can lose.
//
// This hook deliberately knows nothing about the workbench chrome (tabs,
// sidebar, palette) -- Workbench.tsx owns that split. Feedback that is
// about the data (open summary, save confirmation, run failures) toasts
// from here so every caller gets the same messages.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { runPlaywrightTests } from "../../../lib/demo/store";
import type { PlaywrightRunOutcome, WorkspaceFile } from "../../../lib/demo/store";
import * as cloud from "../../../lib/blocks/data";
import { useT } from "../../../lib/i18n/LocalizationProvider";
import { pingRunner, RUNNER_MAX_FILES, runnerUrl } from "../../../lib/runner/client";
import { localFolder } from "../../../lib/workspace/localFolder";
import {
  CODE_FILE_EXTENSIONS,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_TOTAL_BYTES,
  isRunnableSpecPath,
  pathSkipReason
} from "../../../lib/workspace/importFiles";
import type { ImportReport } from "../../../lib/workspace/importFiles";
import type { Project } from "../../../lib/demo/data";

export const DEFAULT_BASE_URL = "https://example.com";

// The picked folder is remembered per project (Lattice persists its
// workspace root the same way) so a refresh reopens the same workspace.
const FOLDER_ROOT_PREFIX = "wb-folder-root.v1:";
const FOLDER_SETTINGS_PREFIX = "wb-folder-settings.v1:";

function readSavedRoot(projectId: string): string | null {
  try {
    const raw = localStorage.getItem(FOLDER_ROOT_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { root?: unknown };
    return typeof parsed.root === "string" && parsed.root.length > 0 ? parsed.root : null;
  } catch {
    return null;
  }
}

function writeSavedRoot(projectId: string, root: string | null): void {
  try {
    if (root) localStorage.setItem(FOLDER_ROOT_PREFIX + projectId, JSON.stringify({ root, at: Date.now() }));
    else localStorage.removeItem(FOLDER_ROOT_PREFIX + projectId);
  } catch {
    /* private mode / quota — remembering the folder is best-effort */
  }
}

function readSavedSettings(projectId: string): { baseURL: string | null } {
  try {
    const raw = localStorage.getItem(FOLDER_SETTINGS_PREFIX + projectId);
    if (!raw) return { baseURL: null };
    const parsed = JSON.parse(raw) as { baseURL?: unknown };
    return { baseURL: typeof parsed.baseURL === "string" && parsed.baseURL ? parsed.baseURL : null };
  } catch {
    return { baseURL: null };
  }
}

function writeSavedSettings(projectId: string, baseURL: string): void {
  try {
    localStorage.setItem(FOLDER_SETTINGS_PREFIX + projectId, JSON.stringify({ baseURL, at: Date.now() }));
  } catch {
    /* best-effort only */
  }
}

export function useTestWorkspace(project: Project) {
  const { t } = useT();

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [savedContents, setSavedContents] = useState<Record<string, string>>({});
  const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);
  const [savedBaseURL, setSavedBaseURL] = useState(DEFAULT_BASE_URL);
  /** The picked folder — the workspace itself. Null = starter draft. */
  const [root, setRoot] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** True while a folder is being opened (tree walk + first reads). */
  const [opening, setOpening] = useState(false);
  /** Live progress for opening a folder / applying a pull, surfaced in
   *  the explorer and the status bar (null when idle). */
  const [importProgress, setImportProgress] = useState<cloud.ImportProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [pendingImport, setPendingImport] = useState<ImportReport | undefined>(undefined);
  /** File or folder awaiting delete confirmation (explorer row). */
  const [pendingDelete, setPendingDelete] = useState<{ path: string; isFolder: boolean; count: number } | undefined>(undefined);
  const [runnerOnline, setRunnerOnline] = useState<boolean | undefined>(undefined);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<PlaywrightRunOutcome | undefined>(undefined);
  /** Bumped on every (re)load, folder open and pull so the chrome can reset its tabs. */
  const [revision, setRevision] = useState(0);
  /** Runner log lines for the panel's Output tab (chronological). */
  const [outputLines, setOutputLines] = useState<string[]>([]);
  /** Path of the last created file -- the chrome expands its parents and opens it. */
  const [createdPath, setCreatedPath] = useState<string | undefined>(undefined);
  /** Old→new path map of the last rename -- the chrome retargets tabs. */
  const [renameMap, setRenameMap] = useState<Record<string, string>>({});
  const [renameTick, setRenameTick] = useState(0);

  // Open the remembered folder (if any) or land on the empty workspace
  // (Lattice's "Open a folder to start editing" state). A folder that
  // vanished from disk clears the memory rather than pretending files
  // exist (Lattice's `exists: false` contract).
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    const saved = readSavedRoot(project.id);
    const settings = readSavedSettings(project.id);
    const url = settings.baseURL || DEFAULT_BASE_URL;
    setBaseURL(url);
    setSavedBaseURL(url);
    if (saved) {
      void loadFolder(saved, { announce: false }).then((ok) => {
        if (cancelled) return;
        if (!ok) {
          writeSavedRoot(project.id, null);
          startEmptyWorkspace();
        }
      });
    } else {
      startEmptyWorkspace();
    }
    function startEmptyWorkspace() {
      setRoot(null);
      setFiles([]);
      setSavedContents({});
      setLoaded(true);
      setRevision((value) => value + 1);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFolder reads project via closure; one run per project
  }, [project.id]);

  // Liveness chip: cheap probe, refreshed whenever a run finishes.
  useEffect(() => {
    let cancelled = false;
    void pingRunner().then((online) => {
      if (!cancelled) setRunnerOnline(online);
    });
    return () => {
      cancelled = true;
    };
  }, [running]);

  const dirtyPaths = useMemo(
    () => new Set(files.filter((file) => file.content !== savedContents[file.path]).map((file) => file.path)),
    [files, savedContents]
  );
  const runnableCount = useMemo(() => files.filter((file) => isRunnableSpecPath(file.path)).length, [files]);

  /** Append a timestamped line to the panel's Output tab. */
  function appendOutput(line: string): void {
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setOutputLines((prev) => [...prev, `[${time}] ${line}`]);
  }
  function clearOutput(): void {
    setOutputLines([]);
  }

  const contentOf = (path: string) => files.find((file) => file.path === path)?.content ?? "";
  /** The last saved (disk) content of a path — the "original" side of the
   *  SCM diff view. A path never saved this session diffs against "". */
  const savedContentOf = (path: string) => savedContents[path] ?? "";

  const setContent = (path: string, content: string) => {
    setFiles((prev) => prev.map((file) => (file.path === path ? { ...file, content } : file)));
  };

  // ── Open folder ─────────────────────────────────────────────────
  // The Lattice flow: walk the real folder, read the text files into
  // the editor, remember the root. Binaries, secret-shaped files and
  // build-output dirs never enter the editor (the same guards the old
  // importer applied); files beyond the size budget stay on disk,
  // just unread here.

  /**
   * Open `rootPath` as this project's workspace. Resolves false when the
   * folder is missing/unreadable — the caller must not keep it as root.
   */
  async function loadFolder(rootPath: string, opts: { announce: boolean }): Promise<boolean> {
    setOpening(true);
    setImportProgress({ phase: "clearing", done: 0, total: 0 });
    try {
      const { tree, exists } = await localFolder.listTree({ root: rootPath });
      if (!exists) {
        if (opts.announce) toast.error("Folder not found", { description: rootPath });
        return false;
      }
      // Flatten + filter with the workspace guards (binaries, secrets,
      // build output). The server already hides node_modules/.git.
      const paths: string[] = [];
      const walk = (nodes: Awaited<ReturnType<typeof localFolder.listTree>>["tree"]) => {
        for (const node of nodes) {
          if (node.kind === "dir") walk(node.children ?? []);
          else paths.push(node.path);
        }
      };
      walk(tree);
      const candidates = paths.filter((path) => pathSkipReason(path) === null);
      setImportProgress({ phase: "reading", done: 0, total: candidates.length });

      const contents = new Map<string, string>();
      let totalBytes = 0;
      let skipped = 0;
      // Small pool so the tree paints while reads stream in.
      const CONCURRENCY = 4;
      let cursor = 0;
      async function worker() {
        while (cursor < candidates.length) {
          const path = candidates[cursor++];
          if (path === undefined) break;
          try {
            const content = await localFolder.readUserFile({ root: rootPath, path });
            if (content === null) continue; // deleted between walk and read
            if (content.length > IMPORT_MAX_FILE_BYTES || totalBytes + content.length > IMPORT_MAX_TOTAL_BYTES) {
              skipped += 1;
              continue;
            }
            totalBytes += content.length;
            contents.set(path, content);
          } catch (error) {
            skipped += 1;
            console.warn("[TestPilot] Folder read failed:", path, error);
          }
          setImportProgress({ phase: "reading", done: contents.size + skipped, total: candidates.length });
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));

      const nextFiles = [...contents.entries()].map(([path, content]) => ({ path, content }));
      setRoot(rootPath);
      writeSavedRoot(project.id, rootPath);
      setFiles(nextFiles);
      setSavedContents(Object.fromEntries(nextFiles.map((file) => [file.path, file.content])));
      setLoaded(true);
      setRevision((value) => value + 1);
      if (opts.announce) {
        const name = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath;
        toast.success(`Opened ${name}`, {
          description: nextFiles.length > 0
            ? `${nextFiles.length} file${nextFiles.length === 1 ? "" : "s"} on disk${skipped > 0 ? ` · ${skipped} skipped (binary/secret/large)` : ""}`
            : "Empty folder — create a spec with the + button"
        });
      }
      return true;
    } catch (error) {
      console.warn("[TestPilot] Folder open failed:", error);
      if (opts.announce) {
        toast.error(t("toast.syncFailed"), {
          description: error instanceof Error ? error.message.slice(0, 200) : "The folder could not be opened."
        });
      }
      return false;
    } finally {
      setOpening(false);
      setImportProgress(null);
    }
  }

  /** Native OS folder dialog → open. The only way in — pick a folder,
   *  it opens. Cancel is a no-op. */
  async function openFolder(): Promise<void> {
    if (opening) return;
    try {
      const result = await localFolder.pickFolder();
      if ("path" in result) {
        await loadFolder(result.path, { announce: true });
      } else if (result.reason !== "cancelled") {
        toast.error("Native folder dialog unavailable", {
          description: "This machine's OS could not show a folder picker."
        });
      }
    } catch (error) {
      console.warn("[TestPilot] Folder picker failed:", error);
      toast.error("Folder picker failed", {
        description: "Is the local runner running? Start it from runner/ (npm start)."
      });
    }
  }

  /** Close the folder: back to the empty workspace (files stay on disk). */
  function closeFolder(): void {
    writeSavedRoot(project.id, null);
    setRoot(null);
    setFiles([]);
    setSavedContents({});
    setRevision((value) => value + 1);
    toast.success("Folder closed");
  }

  // ── File CRUD — every mutation lands on disk first ──────────────

  /** Persist one file (plus a pending base-URL change), optionally toasting. */
  async function persistFile(path: string, notify: boolean): Promise<void> {
    if (!root) return;
    setSaving(true);
    try {
      await localFolder.writeUserFile({ root, path, content: contentOf(path) });
      setSavedContents((prev) => ({ ...prev, [path]: contentOf(path) }));
      if (baseURL !== savedBaseURL) {
        writeSavedSettings(project.id, baseURL);
        setSavedBaseURL(baseURL);
      }
      if (notify) toast.success(t("toast.specSaved"), { description: path });
    } catch (error) {
      console.warn("[TestPilot] File save failed:", error);
      toast.error(t("toast.syncFailed"), {
        description: `${path} — ${error instanceof Error ? error.message.slice(0, 140) : "disk write failed"}`
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveFile(path: string): Promise<void> {
    if (!path) return;
    await persistFile(path, true);
  }

  /** Save every dirty file with one summary toast. */
  async function saveAll(): Promise<void> {
    const targets = [...dirtyPaths];
    if (targets.length === 0) return;
    for (const path of targets) await persistFile(path, false);
    toast.success(t("toast.specSaved"), {
      description: targets.length === 1 ? targets[0] : `${targets.length} files`
    });
  }

  /** Create a file at an arbitrary nested path and write it to disk. */
  async function createFile(path: string, content = ""): Promise<boolean> {
    if (!root) {
      toast.error("Open a folder first", { description: "The + button writes into the open workspace folder." });
      return false;
    }
    const clean = path.trim().replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\+/g, "/").replace(/\/{2,}/g, "/");
    if (!clean || clean.endsWith("/")) {
      toast.error("Enter a file name, e.g. specs/login.spec.mjs");
      return false;
    }
    if (clean.includes("\\") || /(^|\/)\.\.?(\/|$)/.test(clean)) {
      toast.error("Paths use forward slashes and may not contain .. segments");
      return false;
    }
    if (files.some((file) => file.path === clean)) {
      toast.error("A file with this path already exists", { description: clean });
      return false;
    }
    setSaving(true);
    try {
      await localFolder.writeUserFile({ root, path: clean, content });
      setFiles((prev) => [...prev, { path: clean, content }]);
      setSavedContents((prev) => ({ ...prev, [clean]: content }));
      setCreatedPath(clean);
      return true;
    } catch (error) {
      console.warn("[TestPilot] File create failed:", error);
      toast.error(t("toast.syncFailed"), { description: clean });
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Discard local edits: restore the disk content, or drop a never-saved file. */
  function revertFile(path: string): void {
    const saved = savedContents[path];
    if (saved === undefined) {
      setFiles((prev) => prev.filter((file) => file.path !== path));
      return;
    }
    setContent(path, saved);
  }

  /**
   * Create a folder. Folders are derived from file paths in the tree
   * model, so an empty folder is pinned with a .gitkeep placeholder --
   * the same convention real repositories use (a real dir is created on
   * disk too, so both views agree).
   */
  async function createFolder(path: string): Promise<boolean> {
    if (!root) {
      toast.error("Open a folder first", { description: "Folders are created inside the open workspace folder." });
      return false;
    }
    const clean = path.trim().replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\+/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    if (!clean) {
      toast.error("Enter a folder name");
      return false;
    }
    const created = await createFile(`${clean}/.gitkeep`, "");
    if (created) {
      try {
        await localFolder.mkdirUserPath({ root, path: clean });
      } catch {
        /* writeUserFile already created the parents; mkdir is a formality */
      }
      toast.info("Folder created", {
        description: `${clean}/ — kept with a .gitkeep placeholder (folders follow their files)`
      });
    }
    return created;
  }

  /**
   * Rename a file or a whole folder — ONE disk operation (the runner's
   * rename moves directories atomically), then the local state flips so
   * the chrome retargets tabs through renameTick/renameMap.
   */
  async function renamePath(from: string, to: string): Promise<boolean> {
    if (!root) return false;
    const clean = to.trim().replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\+/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    if (!clean || clean.endsWith("/")) {
      toast.error("Enter a new name or path");
      return false;
    }
    if (clean.includes("\\") || /(^|\/)\.\.?(\/|$)/.test(clean)) {
      toast.error("Paths use forward slashes and may not contain .. segments");
      return false;
    }
    if (clean === from) return true;
    const isFolder = !files.some((file) => file.path === from);
    const victims = isFolder
      ? files.filter((file) => file.path.startsWith(`${from}/`))
      : files.filter((file) => file.path === from);
    if (victims.length === 0) return false;
    if (isFolder && clean.startsWith(`${from}/`)) {
      toast.error("A folder cannot be moved inside itself");
      return false;
    }
    const renames = new Map(victims.map((file) => [
      file.path,
      isFolder ? `${clean}${file.path.slice(from.length)}` : clean
    ]));
    // A destination path may not collide with a file that stays put.
    const renameTargets = new Set(renames.values());
    if (files.some((file) => renameTargets.has(file.path) && !renames.has(file.path))) {
      toast.error("A file with the new name already exists", { description: clean });
      return false;
    }
    setSaving(true);
    try {
      await localFolder.renameUserPath({ root, oldPath: from, newPath: clean });
      setFiles((prev) => prev.map((file) => {
        const newPath = renames.get(file.path);
        return newPath ? { path: newPath, content: file.content } : file;
      }));
      setSavedContents((prev) => {
        const next = { ...prev };
        for (const [oldPath, newPath] of renames) {
          const file = victims.find((entry) => entry.path === oldPath);
          delete next[oldPath];
          if (file) next[newPath] = file.content;
        }
        return next;
      });
      setRenameMap(Object.fromEntries(renames));
      setRenameTick((v) => v + 1);
      toast.success(isFolder ? "Folder renamed" : "Renamed", {
        description: isFolder
          ? `${from} → ${clean} (${victims.length} file${victims.length === 1 ? "" : "s"})`
          : `${from} → ${clean}`
      });
      return true;
    } catch (error) {
      console.warn("[TestPilot] Rename failed:", error);
      toast.error("Rename failed", {
        description: error instanceof Error ? error.message.slice(0, 160) : "The move was refused on disk."
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function requestDelete(path: string, isFolder = false): void {
    const count = isFolder
      ? files.filter((file) => file.path === path || file.path.startsWith(`${path}/`)).length
      : 1;
    setPendingDelete({ path, isFolder, count });
  }

  /** Confirmed delete: remove from disk (recursive for folders), then drop locally. */
  async function confirmDelete(): Promise<void> {
    const target = pendingDelete;
    setPendingDelete(undefined);
    if (!target || !root) return;
    const victimCount = target.isFolder
      ? files.filter((file) => file.path === target.path || file.path.startsWith(`${target.path}/`)).length
      : 1;
    try {
      await localFolder.deleteUserPath({ root, path: target.path });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        console.warn("[TestPilot] Delete failed:", error);
        toast.error("Delete failed", { description: message.slice(0, 160) });
        return;
      }
      // Already gone (another editor/git) — treat as success.
    }
    const victimPaths = new Set(
      target.isFolder
        ? files.filter((file) => file.path === target.path || file.path.startsWith(`${target.path}/`)).map((file) => file.path)
        : [target.path]
    );
    setFiles((prev) => prev.filter((file) => !victimPaths.has(file.path)));
    setSavedContents((prev) => {
      const next = { ...prev };
      for (const path of victimPaths) delete next[path];
      return next;
    });
    toast.success(target.isFolder ? "Folder deleted" : "File deleted", {
      description: target.isFolder
        ? `${target.path} (${victimCount} file${victimCount === 1 ? "" : "s"})`
        : target.path
    });
  }

  // ── Pull (Source Control) — writes the pulled files INTO the open folder ──

  /** Persist a staged pull report into the open folder on disk. Progress
   *  streams to importProgress (the explorer/status bar UI is shared). */
  async function applyImport(): Promise<void> {
    const report = pendingImport;
    setPendingImport(undefined);
    if (!report) return;
    if (!root) {
      toast.error("Open a folder first", { description: "Pulled files are written into the open workspace folder." });
      return;
    }
    setImportProgress({ phase: "writing", done: 0, total: report.files.length });
    try {
      const written = new Map<string, string>();
      for (const file of report.files) {
        await localFolder.writeUserFile({ root, path: file.path, content: file.content });
        written.set(file.path, file.content);
        setImportProgress({ phase: "writing", done: written.size, total: report.files.length });
      }
      setFiles((prev) => {
        const merged = [...prev];
        for (const [path, content] of written) {
          const existing = merged.findIndex((entry) => entry.path === path);
          if (existing >= 0) merged[existing] = { path, content };
          else merged.push({ path, content });
        }
        return merged;
      });
      setSavedContents((prev) => ({ ...prev, ...Object.fromEntries(written) }));
      setRevision((value) => value + 1);
      const skippedLine =
        report.skipped.binaries + report.skipped.large + report.skipped.secrets + report.skipped.cap > 0
          ? t("tests.importSkipped")
              .replace("{binaries}", String(report.skipped.binaries))
              .replace("{large}", String(report.skipped.large))
              .replace("{secrets}", String(report.skipped.secrets))
              .replace("{cap}", String(report.skipped.cap))
          : report.rootFolder ? `${report.rootFolder}/` : "";
      toast.success(t("tests.importDone"), { description: `${report.files.length} files written to disk${skippedLine ? ` · ${skippedLine}` : ""}` });
    } catch (error) {
      console.warn("[TestPilot] Pull write failed:", error);
      toast.error(t("tests.importFailed"));
    } finally {
      setImportProgress(null);
    }
  }

  /** Stage a report from any source (GitHub pull) for the confirm dialog. */
  function stageImport(report: ImportReport): void {
    setPendingImport(report);
  }

  async function run(): Promise<void> {
    setErrorText(undefined);
    setOutcome(undefined);
    setRunning(true);
    appendOutput(`Run started — ${wsRunnableCount()} runnable spec(s) · base URL ${baseURL} · runner ${runnerUrl()}`);
    try {
      // What runs is what is on disk: flush every dirty file (and the
      // base URL) first so the executed run matches the editor state.
      for (const path of dirtyPaths) {
        if (root) await localFolder.writeUserFile({ root, path, content: contentOf(path) });
        setSavedContents((prev) => ({ ...prev, [path]: contentOf(path) }));
      }
      if (dirtyPaths.size > 0) appendOutput(`Saved ${dirtyPaths.size} unsaved file(s) before running`);
      if (baseURL !== savedBaseURL) {
        writeSavedSettings(project.id, baseURL);
        setSavedBaseURL(baseURL);
      }

      const runnable = files.filter((file) => isRunnableSpecPath(file.path));
      if (runnable.length === 0) {
        appendOutput("✖ No runnable specs in the workspace");
        toast.error(t("tests.noSpecs"));
        return;
      }
      if (runnable.length > RUNNER_MAX_FILES) {
        appendOutput(`⚠ More than ${RUNNER_MAX_FILES} specs — only the first ${RUNNER_MAX_FILES} run`);
        toast.info(t("tests.tooManySpecs").replace("{max}", String(RUNNER_MAX_FILES)));
      }
      const selected = runnable.slice(0, RUNNER_MAX_FILES);
      // Specs share the file budget with the code files they import: the
      // runner needs the helpers on disk to resolve relative imports.
      const helperBudget = Math.max(0, RUNNER_MAX_FILES - selected.length);
      const helpers = files
        .filter((file) => !isRunnableSpecPath(file.path) && CODE_FILE_EXTENSIONS.test(file.path) && file.content.length > 0)
        .slice(0, helperBudget);
      appendOutput(`Dispatched to runner — ${selected.length} spec(s) + ${helpers.length} helper file(s)`);
      const result = await runPlaywrightTests({
        projectId: project.id,
        baseURL,
        files: [...selected, ...helpers].map((file) => ({ name: file.path, content: file.content }))
      });
      appendOutput(`✔ Run finished — ${result.run.passed} passed · ${result.run.failed} failed · ${result.run.total} total · ${result.run.durationSec}s`);
      setOutcome(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendOutput(`✖ Run failed — ${message}`);
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  function wsRunnableCount(): number {
    return files.filter((file) => isRunnableSpecPath(file.path)).length;
  }

  return {
    files,
    loaded,
    loadedWithoutFiles: loaded && files.length === 0,
    root,
    opening,
    revision,
    dirtyPaths,
    runnableCount,
    baseURL,
    setBaseURL,
    savedBaseURL,
    saving,
    running,
    importProgress,
    pendingImport,
    runnerOnline,
    errorText,
    outcome,
    outputLines,
    clearOutput,
    contentOf,
    savedContentOf,
    setContent,
    openFolder,
    closeFolder,
    saveFile,
    saveAll,
    createFile,
    createFolder,
    createdPath,
    renamePath,
    renameMap,
    renameTick,
    revertFile,
    requestDelete,
    dismissDelete: () => setPendingDelete(undefined),
    confirmDelete,
    pendingDelete,
    stageImport,
    applyImport,
    dismissImport: () => setPendingImport(undefined),
    run,
    runnerUrl: runnerUrl()
  };
}
