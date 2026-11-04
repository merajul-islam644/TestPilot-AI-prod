// All workspace DATA behaviour for the Tests-tab workbench: opening a
// local folder as the workspace (VS Code-style), editing and saving its
// files in place on disk, pulling repos into it, and running the suite
// through the local runner.
//
// The workspace model follows the Lattice workbench exactly: the folder
// the user picked IS the workspace — every read/write goes to the real
// file on disk. There is no stored copy anywhere, so nothing a refresh
// or a flaky backend can lose.
//
// Two transports answer behind one seam (createWorkspaceIo in
// lib/workspace/fsaWorkspace.ts):
//   • FSA (File System Access API) — the browser talks to the disk
//     itself; works on any https origin (dev + deployed) with no local
//     runner. Chrome/Edge only; the handle persists in IndexedDB and a
//     saved workspace may need a click to re-grant permission
//     (fsaReconnect → reconnectFsaWorkspace).
//   • Runner — the local Node process' /api/workbench routes (absolute
//     paths, native OS dialogs); the fallback where FSA is missing.
//
// Content is LAZY (Lattice parity, and why a refresh no longer feels
// like a re-import): a folder open loads the tree PATHS only — the one
// cheap list call — and each file's text is fetched when its tab opens.
// Content search runs server-side (/api/workbench/search) for the same
// reason. Unopened files are by definition unedited, so the SCM changes
// list, save-all and run-flush keep their exact eager-model semantics.
//
// This hook deliberately knows nothing about the workbench chrome (tabs,
// sidebar, palette) -- Workbench.tsx owns that split. Feedback that is
// about the data (open summary, save confirmation, run failures) toasts
// from here so every caller gets the same messages.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { runPlaywrightTests } from "../../../lib/demo/store";
import type { PlaywrightRunOutcome } from "../../../lib/demo/store";
import * as cloud from "../../../lib/blocks/data";
import { useT } from "../../../lib/i18n/LocalizationProvider";
import { pingRunner, RUNNER_MAX_FILES, runnerUrl } from "../../../lib/runner/client";
import { localFolder } from "../../../lib/workspace/localFolder";
import type { SearchResponse } from "../../../lib/workspace/localFolder";
import {
  clearRootHandle,
  createWorkspaceIo,
  ensureFsaPermission,
  fsaSupported,
  listFsaTree,
  loadRootHandle,
  pickDirectory,
  pickFileWithFolder,
  queryFsaPermission,
  resolveWorkspaceRoot,
  saveRootHandle
} from "../../../lib/workspace/fsaWorkspace";
import type { FsDirHandle } from "../../../lib/workspace/fsaWorkspace";
import {
  CODE_FILE_EXTENSIONS,
  IMPORT_MAX_FILE_BYTES,
  isRunnableSpecPath,
  pathSkipReason
} from "../../../lib/workspace/importFiles";
import type { ImportReport } from "../../../lib/workspace/importFiles";
import type { Project } from "../../../lib/demo/data";

export const DEFAULT_BASE_URL = "https://example.com";

/**
 * Per-file cap for opening a file in the editor. The bulk-import budget
 * (IMPORT_MAX_FILE_BYTES) governed reading EVERY file; lazily we only
 * need to protect Monaco from pathological single files. The runner
 * still enforces its own per-file cap at run time.
 */
const EDITOR_MAX_FILE_BYTES = 2_000_000;

// The picked folder is remembered per project (Lattice persists its
// workspace root the same way) so a refresh reopens the same workspace.
// FSA workspaces also persist their handle in IndexedDB — the localStorage
// row only carries the folder NAME + which transport owns it.
const FOLDER_ROOT_PREFIX = "wb-folder-root.v1:";
const FOLDER_SETTINGS_PREFIX = "wb-folder-settings.v1:";

type SavedRoot = { root: string; mode: "fsa" | "runner" };

function readSavedRoot(projectId: string): SavedRoot | null {
  try {
    const raw = localStorage.getItem(FOLDER_ROOT_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { root?: unknown; mode?: unknown };
    if (typeof parsed.root !== "string" || parsed.root.length === 0) return null;
    return { root: parsed.root, mode: parsed.mode === "fsa" ? "fsa" : "runner" };
  } catch {
    return null;
  }
}
export { readSavedRoot };

function writeSavedRoot(projectId: string, saved: SavedRoot | null): void {
  try {
    if (saved) localStorage.setItem(FOLDER_ROOT_PREFIX + projectId, JSON.stringify({ ...saved, at: Date.now() }));
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

  /** Workspace file paths (tree leaves that passed the guards). */
  const [paths, setPaths] = useState<string[]>([]);
  /** Content of LOADED files only — a tab has been opened for it. */
  const [contents, setContents] = useState<Record<string, string>>({});
  const [savedContents, setSavedContents] = useState<Record<string, string>>({});
  /** The SCM baseline (VS Code's git HEAD): the content as it was when
   *  loaded from disk, pulled from GitHub, or last pushed. Auto-save
   *  updates the DISK copy, never this — so the Source Control changes
   *  list keeps showing edits until they are committed or discarded. */
  const [gitBaselines, setGitBaselines] = useState<Record<string, string>>({});
  /** Debounced auto-save: one timer per file, 800ms after the last
   *  keystroke the file lands on disk by itself (VS Code's
   *  files.autoSave=afterDelay). */
  const autosaveTimersRef = useRef<Map<string, number>>(new Map());
  const AUTOSAVE_DELAY_MS = 800;
  /** Per-path save status for the editor toolbar: "pending" inside the
   *  auto-save debounce window, "saving" in flight, "saved" after a
   *  successful write, "error" when the disk refused the write. */
  const [saveStates, setSaveStates] = useState<Record<string, "pending" | "saving" | "saved" | "error">>({});
  const setSaveState = (path: string, state: "pending" | "saving" | "saved" | "error"): void => {
    setSaveStates((prev) => (prev[path] === state ? prev : { ...prev, [path]: state }));
  };
  /** Paths with a read in flight (mirrored to a ref for call-time checks). */
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const loadingRef = useRef<Set<string>>(new Set());
  const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);
  const [savedBaseURL, setSavedBaseURL] = useState(DEFAULT_BASE_URL);
  /** The picked folder — the workspace itself. Null = empty workspace.
   *  FSA mode: the folder's NAME (handles carry no absolute path).
   *  Runner mode: the absolute disk path (unchanged behaviour). */
  const [root, setRoot] = useState<string | null>(null);
  /** The FSA directory handle behind `root` when the workspace runs on
   *  the File System Access API (no local runner involved). Null = the
   *  runner transport owns this workspace. */
  const [fsaRoot, setFsaRoot] = useState<FsDirHandle | null>(null);
  /** A saved FSA workspace whose handle needs a click-granted permission
   *  (browsers won't allow requestPermission without a gesture). The
   *  explorer shows a reconnect banner for it. */
  const [fsaReconnect, setFsaReconnect] = useState<{ name: string } | null>(null);
  /** The transport seam: identical signatures, FSA or runner backend. */
  const io = useMemo(() => createWorkspaceIo(fsaRoot), [fsaRoot]);
  const [loaded, setLoaded] = useState(false);
  /** True while a folder is being opened (the tree list call). */
  const [opening, setOpening] = useState(false);
  /** Live progress for applying a pull, surfaced in the explorer and the
   *  status bar (null when idle). Folder opens no longer stream reads. */
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
    if (saved && saved.mode === "fsa") {
      // FSA restore: the handle lives in IndexedDB. Permission already
      // granted → reload silently; "prompt" → a click must grant it, so
      // surface the reconnect banner instead of pretending files exist.
      void (async () => {
        let handle: FsDirHandle | null = null;
        let storageFailed = false;
        try {
          handle = await loadRootHandle(project.id);
        } catch (error) {
          console.warn("[TestPilot] Workspace handle restore failed:", error);
          storageFailed = true;
        }
        if (cancelled) return;
        if (storageFailed) {
          // IndexedDB hiccup ≠ no workspace: KEEP the saved-root record
          // and show the reconnect banner — its click retries the read,
          // so a flaky storage layer costs one click, never the memory.
          const name = saved.root.split(/[\\/]/).pop() || saved.root;
          setFsaReconnect({ name });
          startEmptyWorkspace();
          return;
        }
        if (!handle) {
          writeSavedRoot(project.id, null);
          startEmptyWorkspace();
          return;
        }
        const permission = await queryFsaPermission(handle);
        if (cancelled) return;
        if (permission === "granted") {
          const ok = await loadFolder(handle.name, { announce: false }, handle);
          if (cancelled) return;
          if (!ok) {
            await clearRootHandle(project.id);
            writeSavedRoot(project.id, null);
            startEmptyWorkspace();
          }
        } else {
          setFsaReconnect({ name: handle.name });
          startEmptyWorkspace();
        }
      })();
    } else if (saved) {
      void loadFolder(saved.root, { announce: false }).then((ok) => {
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
      setPaths([]);
      clearAutosaves();
      setContents({});
      setSavedContents({});
      setGitBaselines({});
      setSaveStates({});
      setLoaded(true);
      setRevision((value) => value + 1);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFolder reads project via closure; one run per project
  }, [project.id]);

  // Liveness chip: a cheap probe on a steady 3s cadence — both ways.
  // While offline, the moment the user starts the "connect this
  // machine" agent the whole UI flips to connected without a reload;
  // while online, the moment the agent dies the badge and the terminal
  // flip back to offline instead of lying with a stale green dot.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const probe = () => {
      void pingRunner().then((online) => {
        if (cancelled) return;
        setRunnerOnline(online);
        timer = window.setTimeout(probe, 3_000);
      });
    };
    probe();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [running]);

  const dirtyPaths = useMemo(
    // Only loaded files can be dirty: an unopened file was never edited
    // in this session, so it equals its disk version by definition.
    () => new Set(paths.filter((path) => contents[path] !== undefined && contents[path] !== savedContents[path])),
    [paths, contents, savedContents]
  );
  /** VS Code's "Changes" list: files whose editor content differs from
   *  the SCM baseline (loaded / pulled / last-pushed state). Auto-save
   *  clears dirtyPaths, NOT this — committing or discarding does. */
  const gitDirtyPaths = useMemo(
    () => new Set(paths.filter((path) => {
      const content = contents[path];
      if (content === undefined) return false;
      const baseline = gitBaselines[path] ?? savedContents[path];
      return content !== baseline;
    })),
    [paths, contents, gitBaselines, savedContents]
  );
  /** The SCM baseline of a path — the "original" side of diff editors. */
  const gitContentOf = (path: string) => gitBaselines[path] ?? savedContents[path] ?? "";
  const runnableCount = useMemo(() => paths.filter((path) => isRunnableSpecPath(path)).length, [paths]);

  /** Append a timestamped line to the panel's Output tab. */
  function appendOutput(line: string): void {
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setOutputLines((prev) => [...prev, `[${time}] ${line}`]);
  }
  function clearOutput(): void {
    setOutputLines([]);
  }

  const contentOf = (path: string) => contents[path] ?? "";
  /** The last saved (disk) content of a path — the "original" side of the
   *  SCM diff view. A path never saved this session diffs against "". */
  const savedContentOf = (path: string) => savedContents[path] ?? "";
  const isLoaded = useCallback((path: string) => contents[path] !== undefined, [contents]);
  const isLoading = useCallback((path: string) => loadingPaths.has(path), [loadingPaths]);

  const setContent = (path: string, content: string) => {
    setContents((prev) => ({ ...prev, [path]: content }));
    scheduleAutosave(path);
  };

  // ── Auto-save (debounced) ─────────────────────────────────────────
  // The editor calls setContent on every keystroke; 800ms after the
  // last one the file writes itself to the workspace. Refs carry the
  // latest values into the timer callbacks, which close over stale
  // renders otherwise.

  const contentsRef = useRef<Record<string, string>>({});
  const savedRef = useRef<Record<string, string>>({});
  const rootRef = useRef<string | null>(null);
  useEffect(() => { contentsRef.current = contents; }, [contents]);
  useEffect(() => { savedRef.current = savedContents; }, [savedContents]);
  useEffect(() => { rootRef.current = root; }, [root]);

  function scheduleAutosave(path: string): void {
    if (!rootRef.current) return;
    setSaveState(path, "pending");
    const timers = autosaveTimersRef.current;
    const existing = timers.get(path);
    if (existing !== undefined) window.clearTimeout(existing);
    timers.set(path, window.setTimeout(() => {
      timers.delete(path);
      if (contentsRef.current[path] !== savedRef.current[path]) void persistFile(path, false);
    }, AUTOSAVE_DELAY_MS));
  }

  /** Cancel any pending auto-save for a path (an explicit save wins). */
  function cancelAutosave(path: string): void {
    const existing = autosaveTimersRef.current.get(path);
    if (existing !== undefined) {
      window.clearTimeout(existing);
      autosaveTimersRef.current.delete(path);
    }
  }

  function clearAutosaves(): void {
    for (const timer of autosaveTimersRef.current.values()) window.clearTimeout(timer);
    autosaveTimersRef.current.clear();
  }

  // Tab closing / refresh: fire the pending writes as best effort.
  useEffect(() => {
    const flush = () => {
      for (const path of [...autosaveTimersRef.current.keys()]) {
        autosaveTimersRef.current.delete(path);
        void persistFile(path, false);
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  // ── Lazy content loading (Lattice parity) ────────────────────────
  // Tabs fetch their own text: openTab → the chrome's effect calls
  // ensureLoaded, which reads the missing files once and records the
  // disk baseline for the dirty check. Returns the content it fetched
  // so async flows (run) can use it without re-reading stale state.

  const ensureLoaded = useCallback(async (targets: string[]): Promise<Record<string, string>> => {
    if (!root) return {};
    const missing = targets.filter((path) =>
      path.length > 0 && contents[path] === undefined && !loadingRef.current.has(path)
    );
    if (missing.length === 0) return {};
    const fetched: Record<string, string> = {};
    const refused: string[] = [];
    await Promise.all(missing.map(async (path) => {
      loadingRef.current.add(path);
      try {
        const content = await io.readUserFile({ root, path });
        if (content === null) {
          // Deleted out from under the editor (git/another editor):
          // drop the ghost path from the tree.
          setPaths((prev) => prev.filter((entry) => entry !== path));
          return;
        }
        if (content.length > EDITOR_MAX_FILE_BYTES) {
          refused.push(path);
          return;
        }
        fetched[path] = content;
        setContents((prev) => ({ ...prev, [path]: content }));
        setSavedContents((prev) => ({ ...prev, [path]: content }));
        setGitBaselines((prev) => ({ ...prev, [path]: content }));
      } catch (error) {
        console.warn("[TestPilot] File read failed:", path, error);
      } finally {
        loadingRef.current.delete(path);
      }
    }));
    setLoadingPaths(new Set(loadingRef.current));
    if (refused.length > 0) {
      toast.info("File too large to edit", {
        description: `${refused.length} file(s) over ${Math.round(EDITOR_MAX_FILE_BYTES / 1000)} KB stay on disk`
      });
    }
    return fetched;
  }, [root, contents, io]);

  /** Content search over the transport seam (runner: server-side scan;
   *  FSA: the same guarded scan against the handle tree). */
  const searchWorkspace = useCallback(async (query: string): Promise<SearchResponse> => {
    if (!root || query.trim().length < 2) return { results: [], truncated: false };
    return io.search({ root, query });
  }, [root, io]);

  // ── Open folder ─────────────────────────────────────────────────
  // The Lattice flow, lazy edition: walk the real folder's TREE only
  // (one list call) and remember the root. Binaries, secret-shaped
  // files and build-output dirs never enter the tree (the same guards
  // the old importer applied). No per-file reads happen here — tabs
  // fetch their own content, so a refresh is this one call.

  /**
   * Open `rootPath` as this project's workspace. Resolves false when the
   * folder is missing/unreadable — the caller must not keep it as root.
   * `fsaHandle` selects the FSA transport for THIS load (the memoized io
   * would still point at the previous backend this render — the handle
   * is the truth, so it rides along explicitly).
   */
  async function loadFolder(rootPath: string, opts: { announce: boolean }, fsaHandle: FsDirHandle | null = null): Promise<boolean> {
    setOpening(true);
    // A stale reveal (a file created before this open) must not leak
    // into the new session's default tab.
    setCreatedPath(undefined);
    try {
      const { tree, exists } = fsaHandle
        ? await listFsaTree(fsaHandle)
        : await io.listTree({ root: rootPath });
      if (!exists) {
        if (opts.announce) toast.error("Folder not found", { description: rootPath });
        return false;
      }
      // Flatten + filter with the workspace guards (binaries, secrets,
      // build output). The server already hides node_modules/.git.
      const found: string[] = [];
      const walk = (nodes: Awaited<ReturnType<typeof localFolder.listTree>>["tree"]) => {
        for (const node of nodes) {
          if (node.kind === "dir") walk(node.children ?? []);
          else found.push(node.path);
        }
      };
      walk(tree);
      const candidates = found.filter((path) => pathSkipReason(path) === null);

      setRoot(rootPath);
      // The workspace's transport is whoever loaded the tree — set both
      // here so open/reconnect/restore share one code path and a switch
      // between FSA and runner workspaces never leaves a stale backend.
      setFsaRoot(fsaHandle);
      setFsaReconnect(null);
      writeSavedRoot(project.id, { root: rootPath, mode: fsaHandle ? "fsa" : "runner" });
      setPaths(candidates);
      clearAutosaves();
      setContents({});
      setSavedContents({});
      setGitBaselines({});
      setSaveStates({});
      setLoaded(true);
      setRevision((value) => value + 1);
      if (opts.announce) {
        const name = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath;
        const skipped = found.length - candidates.length;
        toast.success(`Opened ${name}`, {
          description: candidates.length > 0
            ? `${candidates.length} file${candidates.length === 1 ? "" : "s"} on disk${skipped > 0 ? ` · ${skipped} skipped (binary/secret)` : ""}`
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

  /** Folder dialog → open. Lattice parity: when the local agent is
   *  reachable, "Open Folder" IS the native OS dialog — the pick is a
   *  real disk folder, so the editor edits files in place AND the
   *  terminal can spawn at the folder's true path (a browser FSA pick
   *  never learns the real path, so its workspace's terminal has to
   *  start at the app root). The browser picker remains as the fallback
   *  for machines without the agent, and as the automatic fallback when
   *  the agent dies mid-open or has no GUI. Cancel is a no-op.
   *  Workspace rule: the pick must BE (or contain) an e2e/playwright
   *  folder — resolveRoot/resolveWorkspaceRoot decide; a folder with
   *  neither is refused with an error and NOTHING opens. */
  async function openFolder(): Promise<void> {
    if (opening) return;
    if (runnerOnline !== false) {
      try {
        const result = await localFolder.pickFolder();
        if ("path" in result) {
          const inner = await localFolder.resolveRoot(result.path);
          if (!inner) {
            const leaf = result.path.split(/[\\/]/).filter(Boolean).pop() ?? result.path;
            toast.error("Not an e2e/playwright workspace", {
              description: `“${leaf}” has no e2e or playwright folder inside it — open that folder itself, or one that contains one. Nothing was opened.`
            });
            return;
          }
          await loadFolder(inner, { announce: true });
          return;
        }
        if (result.reason === "cancelled") return;
        // no_gui / spawn_failed → the OS dialog can't show; try the
        // browser picker below before giving up.
      } catch {
        /* agent unreachable (probe lag / died mid-open) → browser picker */
      }
    }
    if (fsaSupported()) {
      try {
        const picked = await pickDirectory();
        if (!picked) return; // user cancelled
        const resolved = await resolveWorkspaceRoot(picked);
        if (!resolved) {
          toast.error("Not an e2e/playwright workspace", {
            description: `“${picked.name}” has no e2e or playwright folder inside it — open that folder itself, or one that contains one. Nothing was opened.`
          });
          return;
        }
        const dir = resolved.root;
        await saveRootHandle(project.id, dir);
        if (resolved.innerPath) {
          // Resolved from inside a bigger pick: announce WHICH folder
          // became the workspace (loadFolder stays quiet so this is one
          // toast, not two).
          const ok = await loadFolder(dir.name, { announce: false }, dir);
          if (!ok) {
            await clearRootHandle(project.id);
            return;
          }
          toast.success(`Opened the “${dir.name}” workspace`, {
            description: `Found inside “${picked.name}” at ${resolved.innerPath} — only that folder and its contents are open.`
          });
          return;
        }
        const ok = await loadFolder(dir.name, { announce: true }, dir);
        if (!ok) await clearRootHandle(project.id);
      } catch (error) {
        console.warn("[TestPilot] FSA folder pick failed:", error);
        toast.error("Folder picker failed", {
          description: error instanceof Error ? error.message.slice(0, 160) : "The browser refused the directory picker."
        });
      }
      return;
    }
    // Neither transport can show a picker: no agent, and this browser
    // has no File System Access API either.
    toast.error("Folder open unavailable", {
      description: "Start the local server first (the terminal tab's Start server button), or use a browser with the folder picker."
    });
  }

  /** File dialog → the file's folder becomes the workspace and the file
   *  itself opens. FSA edition: the file picker, then the directory
   *  picker anchored inside the file's folder (the API exposes no parent
   *  handle). The same import guards apply — a binary/secret-shaped pick
   *  is refused with the reason before any folder load starts. */
  async function openFileFromDisk(): Promise<void> {
    if (opening) return;
    if (fsaSupported()) {
      try {
        const picked = await pickFileWithFolder();
        if (!picked) return; // user cancelled either dialog
        const reason = pathSkipReason(picked.file.name);
        if (reason) {
          toast.error("This file type cannot be opened", {
            description: `${picked.file.name} — filtered (${reason})`
          });
          return;
        }
        await saveRootHandle(project.id, picked.dir);
        const ok = await loadFolder(picked.dir.name, { announce: true }, picked.dir);
        if (!ok) {
          await clearRootHandle(project.id);
          return;
        }
        // Same reveal a fresh-created file gets: the chrome expands the
        // file's parents and opens its tab.
        setCreatedPath(picked.file.name);
      } catch (error) {
        console.warn("[TestPilot] FSA file pick failed:", error);
        toast.error("File picker failed", {
          description: error instanceof Error ? error.message.slice(0, 160) : "The browser refused the file picker."
        });
      }
      return;
    }
    try {
      const result = await localFolder.pickFile();
      if (!("path" in result)) {
        if (result.reason !== "cancelled") {
          toast.error("Native file dialog unavailable", {
            description: "This machine's OS could not show a file picker."
          });
        }
        return;
      }
      const reason = pathSkipReason(result.rel ?? "");
      if (reason) {
        toast.error("This file type cannot be opened", {
          description: `${result.rel} — filtered (${reason})`
        });
        return;
      }
      const ok = await loadFolder(result.folder ?? "", { announce: true });
      // Same reveal a fresh-created file gets: the chrome expands the
      // file's parents and opens its tab.
      if (ok) setCreatedPath(result.rel);
    } catch (error) {
      console.warn("[TestPilot] File picker failed:", error);
      toast.error("File picker failed", {
        description: "Is the local runner running? Start it from runner/ (npm start)."
      });
    }
  }

  /** The saved FSA workspace needs its permission re-granted — the
   *  explorer's reconnect banner calls this from a real click gesture. */
  async function reconnectFsaWorkspace(): Promise<void> {
    const pending = fsaReconnect;
    if (!pending) return;
    let handle: FsDirHandle | null = null;
    try {
      handle = await loadRootHandle(project.id);
    } catch {
      // Storage hiccuped again — keep the banner up for another try.
      toast.error("Could not read the saved workspace", {
        description: "The browser's storage hiccupped — click Reconnect once more."
      });
      return;
    }
    if (!handle) {
      // The saved workspace points at a handle the browser no longer
      // stores — forget it, but SAY so instead of failing silently.
      setFsaReconnect(null);
      writeSavedRoot(project.id, null);
      toast.error("Workspace could not be restored", {
        description: `The browser no longer stores “${pending.name}” — open the folder again from the Explorer.`
      });
      return;
    }
    const granted = await ensureFsaPermission(handle);
    if (!granted) {
      toast.error("Permission denied", {
        description: `The browser kept “${handle.name}” locked — pick the folder again to open it.`
      });
      return;
    }
    const ok = await loadFolder(handle.name, { announce: true }, handle);
    if (!ok) {
      await clearRootHandle(project.id);
      writeSavedRoot(project.id, null);
      setFsaReconnect(null);
    }
  }

  /** Close the folder: back to the empty workspace (files stay on disk). */
  function closeFolder(): void {
    writeSavedRoot(project.id, null);
    void clearRootHandle(project.id);
    setRoot(null);
    setFsaRoot(null);
    setFsaReconnect(null);
    setPaths([]);
    clearAutosaves();
    setContents({});
    setSavedContents({});
    setGitBaselines({});
    setSaveStates({});
    setRevision((value) => value + 1);
    toast.success("Folder closed");
  }

  // ── File CRUD — every mutation lands on disk first ──────────────

  /** Persist one file (plus a pending base-URL change), optionally
   *  toasting. `overrideContent` pins WHAT to write — used by revert,
   *  which must not read the not-yet-synced contents ref mid-dispatch
   *  (a stale read used to re-write the pre-discard edits to disk). */
  async function persistFile(path: string, notify: boolean, overrideContent?: string): Promise<void> {
    if (!root) return;
    cancelAutosave(path);
    setSaveState(path, "saving");
    setSaving(true);
    try {
      const content = overrideContent ?? contentsRef.current[path] ?? "";
      await io.writeUserFile({ root, path, content });
      setSavedContents((prev) => ({ ...prev, [path]: content }));
      setSaveState(path, "saved");
      if (baseURL !== savedBaseURL) {
        writeSavedSettings(project.id, baseURL);
        setSavedBaseURL(baseURL);
      }
      if (notify) toast.success(t("toast.specSaved"), { description: path });
    } catch (error) {
      console.warn("[TestPilot] File save failed:", error);
      setSaveState(path, "error");
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

  /** Create a file at an arbitrary nested path and write it to disk.
   *  A created file is loaded by construction (content known). */
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
    if (paths.includes(clean)) {
      toast.error("A file with this path already exists", { description: clean });
      return false;
    }
    setSaving(true);
    try {
      await io.writeUserFile({ root, path: clean, content });
      setPaths((prev) => [...prev, clean]);
      setContents((prev) => ({ ...prev, [clean]: content }));
      setSavedContents((prev) => ({ ...prev, [clean]: content }));
      setGitBaselines((prev) => ({ ...prev, [clean]: content }));
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

  /** Discard SCM changes: restore the baseline content (as loaded /
   *  pulled / last pushed) to the editor AND disk. With auto-save on, the
   *  disk copy already carries the edits, so the baseline — not the saved
   *  copy — is the only meaningful "original". A file with no baseline
   *  at all (created this session, never written) is dropped entirely. */
  function revertFile(path: string): void {
    const knownBaseline = gitBaselines[path];
    if (knownBaseline === undefined && savedContents[path] === undefined) {
      cancelAutosave(path);
      setPaths((prev) => prev.filter((entry) => entry !== path));
      setContents((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      setSaveStates((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      return;
    }
    const baseline = gitContentOf(path);
    setContent(path, baseline);
    void persistFile(path, false, baseline);
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
        await io.mkdirUserPath({ root, path: clean });
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
   * the chrome retargets tabs through renameTick/renameMap. Loaded
   * contents move with their paths; unloaded paths just retarget.
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
    const isFolder = !paths.includes(from);
    const victims = isFolder
      ? paths.filter((path) => path.startsWith(`${from}/`))
      : paths.filter((path) => path === from);
    if (victims.length === 0) return false;
    if (isFolder && clean.startsWith(`${from}/`)) {
      toast.error("A folder cannot be moved inside itself");
      return false;
    }
    const renames = new Map(victims.map((path) => [
      path,
      isFolder ? `${clean}${path.slice(from.length)}` : clean
    ]));
    // A destination path may not collide with a file that stays put.
    const renameTargets = new Set(renames.values());
    if (paths.some((path) => renameTargets.has(path) && !renames.has(path))) {
      toast.error("A file with the new name already exists", { description: clean });
      return false;
    }
    setSaving(true);
    try {
      await io.renameUserPath({ root, oldPath: from, newPath: clean });
      setPaths((prev) => prev.map((path) => renames.get(path) ?? path));
      const retargetKeys = <T,>(prev: Record<string, T>): Record<string, T> => {
        const next: Record<string, T> = {};
        for (const [key, value] of Object.entries(prev)) {
          const mapped = renames.get(key);
          next[mapped ?? key] = value;
        }
        return next;
      };
      setContents(retargetKeys);
      setSavedContents(retargetKeys);
      setGitBaselines(retargetKeys);
      setSaveStates(retargetKeys);
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
      ? paths.filter((path2) => path2 === path || path2.startsWith(`${path}/`)).length
      : 1;
    setPendingDelete({ path, isFolder, count });
  }

  /** Confirmed delete: remove from disk (recursive for folders), then drop locally. */
  async function confirmDelete(): Promise<void> {
    const target = pendingDelete;
    setPendingDelete(undefined);
    if (!target || !root) return;
    const victimPaths = new Set(
      target.isFolder
        ? paths.filter((path) => path === target.path || path.startsWith(`${target.path}/`))
        : [target.path]
    );
    try {
      await io.deleteUserPath({ root, path: target.path });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        console.warn("[TestPilot] Delete failed:", error);
        toast.error("Delete failed", { description: message.slice(0, 160) });
        return;
      }
      // Already gone (another editor/git) — treat as success.
    }
    setPaths((prev) => prev.filter((path) => !victimPaths.has(path)));
    const purge = <T,>(prev: Record<string, T>): Record<string, T> => {
      const next = { ...prev };
      for (const path of victimPaths) delete next[path];
      return next;
    };
    setContents(purge);
    setSavedContents(purge);
    setGitBaselines(purge);
    setSaveStates(purge);
    toast.success(target.isFolder ? "Folder deleted" : "File deleted", {
      description: target.isFolder
        ? `${target.path} (${victimPaths.size} file${victimPaths.size === 1 ? "" : "s"})`
        : target.path
    });
  }

  // ── Pull (Source Control) — writes the pulled files INTO the open folder ──

  /** Persist a staged pull report into the open folder on disk. Progress
   *  streams to importProgress (the explorer/status bar UI is shared).
   *  Written files arrive with content in hand, so they are recorded as
   *  loaded — opening one costs no extra read. */
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
        await io.writeUserFile({ root, path: file.path, content: file.content });
        written.set(file.path, file.content);
        setImportProgress({ phase: "writing", done: written.size, total: report.files.length });
      }
      setPaths((prev) => {
        const known = new Set(prev);
        return [...prev, ...[...written.keys()].filter((path) => !known.has(path))];
      });
      setContents((prev) => ({ ...prev, ...Object.fromEntries(written) }));
      setSavedContents((prev) => ({ ...prev, ...Object.fromEntries(written) }));
      setGitBaselines((prev) => ({ ...prev, ...Object.fromEntries(written) }));
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

  /** After a successful push: every committed file's SCM baseline moves
   *  to the pushed content (VS Code's HEAD advancing to the new commit),
   *  so the changes list empties until the next edit. The editor keeps
   *  whatever was typed during the push — those strokes stay visible as
   *  new changes — and the disk copy is refreshed to match. */
  async function markCommitted(files: { path: string; content: string }[]): Promise<void> {
    for (const file of files) {
      if (!paths.includes(file.path)) continue;
      setGitBaselines((prev) => ({ ...prev, [file.path]: file.content }));
      await persistFile(file.path, false);
    }
  }

  async function run(): Promise<void> {
    setErrorText(undefined);
    setOutcome(undefined);
    setRunning(true);
    appendOutput(`Run started — ${runnableCount} runnable spec(s) · base URL ${baseURL} · runner ${runnerUrl()}`);
    try {
      // What runs is what is on disk: flush every dirty file (and the
      // base URL) first so the executed run matches the editor state.
      for (const path of dirtyPaths) {
        if (root) await io.writeUserFile({ root, path, content: contentOf(path) });
        setSavedContents((prev) => ({ ...prev, [path]: contentOf(path) }));
      }
      if (dirtyPaths.size > 0) appendOutput(`Saved ${dirtyPaths.size} unsaved file(s) before running`);
      if (baseURL !== savedBaseURL) {
        writeSavedSettings(project.id, baseURL);
        setSavedBaseURL(baseURL);
      }

      const runnable = paths.filter((path) => isRunnableSpecPath(path));
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
      // Helpers may never have been opened — load the run set first
      // (bounded: at most RUNNER_MAX_FILES files total).
      const helperBudget = Math.max(0, RUNNER_MAX_FILES - selected.length);
      const helperPaths = paths
        .filter((path) => !isRunnableSpecPath(path) && CODE_FILE_EXTENSIONS.test(path))
        .slice(0, helperBudget);
      const fetched = await ensureLoaded([...selected, ...helperPaths]);
      const contentNow = (path: string): string => fetched[path] ?? contentOf(path);

      // The runner refuses files over its own per-file cap — exclude
      // those here and say so, instead of failing the whole run.
      const RUNNER_FILE_CAP = 200_000;
      const oversized = [...selected].filter((path) => contentNow(path).length > RUNNER_FILE_CAP);
      const sendable = selected.filter((path) => contentNow(path).length <= RUNNER_FILE_CAP);
      if (oversized.length > 0) {
        appendOutput(`⚠ ${oversized.length} spec(s) over the runner's 200 KB file cap were skipped`);
      }
      if (sendable.length === 0) {
        appendOutput("✖ No runnable specs in the workspace");
        toast.error(t("tests.noSpecs"));
        return;
      }
      const helpers = helperPaths.filter((path) => contentNow(path).length > 0);
      appendOutput(`Dispatched to runner — ${sendable.length} spec(s) + ${helpers.length} helper file(s)`);
      const result = await runPlaywrightTests({
        projectId: project.id,
        baseURL,
        files: [...sendable, ...helpers].map((path) => ({ name: path, content: contentNow(path) }))
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

  return {
    paths,
    loaded,
    loadedWithoutFiles: loaded && paths.length === 0,
    root,
    opening,
    revision,
    dirtyPaths,
    gitDirtyPaths,
    gitContentOf,
    saveStates,
    runnableCount,
    baseURL,
    setBaseURL,
    savedBaseURL,
    saving,
    running,
    importProgress,
    pendingImport,
    runnerOnline,
    /** Saved FSA workspace awaiting a click-granted permission — the
     *  explorer renders a reconnect banner for it. */
    fsaReconnect,
    reconnectFsaWorkspace,
    errorText,
    outcome,
    outputLines,
    clearOutput,
    contentOf,
    savedContentOf,
    isLoaded,
    isLoading,
    ensureLoaded,
    searchWorkspace,
    setContent,
    openFolder,
    openFileFromDisk,
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
    markCommitted,
    run,
    runnerUrl: runnerUrl()
  };
}
