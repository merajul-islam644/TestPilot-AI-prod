// File System Access API workspace backend — the runner-free path.
//
// The runner-backed workspace (localFolder.ts) needs a local Node process
// on :9090 and same-machine origins. This backend replaces that transport
// with the browser's own File System Access API: the user picks a folder
// with Chrome's native directory picker and every read/write/delete goes
// straight to the real files on disk from the page itself. That works on
// ANY https origin — the dev server AND the deployed app — with no local
// server involved.
//
// Shape parity with localFolder is deliberate: createWorkspaceIo() returns
// the exact same call signatures ({root, path}), so useTestWorkspace talks
// to one seam and only the transport differs. The `root` string in FSA
// mode is the folder's NAME (the API exposes no absolute paths); the real
// root is the persisted FileSystemDirectoryHandle resolved alongside it.
//
// Browser support: Chrome/Edge (and other Chromium forks). Firefox/Safari
// lack showDirectoryPicker — fsaSupported() gates every entry point, and
// those browsers keep the runner flow unchanged.

import { SKIP_DIR_NAMES, pathSkipReason } from "./importFiles";
import { localFolder } from "./localFolder";
import type { FolderNode, SearchLine, SearchResponse } from "./localFolder";

// ── Minimal handle types ─────────────────────────────────────────
// Typed locally, structurally: the real Chrome handles satisfy these
// members, and casting at the picker boundary (the only place lib.dom
// types enter) keeps this module independent of lib.dom's coverage of
// the still-moving FSA spec (async iteration and permissions are the
// usual gaps).

export type FsPermissionState = "granted" | "denied" | "prompt";

export type FsWritable = {
  write(data: string): Promise<void>;
  close(): Promise<void>;
};

export type FsFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FsWritable>;
};

export type FsDirHandle = {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, FsFileHandle | FsDirHandle]>;
};

type PermissionedHandle = FsDirHandle & {
  queryPermission(descriptor: { mode: "read" | "readwrite" }): Promise<FsPermissionState>;
  requestPermission(descriptor: { mode: "read" | "readwrite" }): Promise<FsPermissionState>;
};

/** True where the workspace can run entirely without the local runner. */
export function fsaSupported(): boolean {
  return typeof window !== "undefined"
    && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

// ── Pickers ──────────────────────────────────────────────────────
// Both must be called from a real user gesture (a click handler) — the
// browser refuses permission prompts otherwise. User-cancel resolves
// null (AbortError), matching PickResult's cancelled contract.

/** Native directory picker → a handle with read+write requested. */
export async function pickDirectory(): Promise<FsDirHandle | null> {
  const picker = (window as unknown as {
    showDirectoryPicker(options?: { mode?: "read" | "readwrite"; id?: string; startIn?: unknown }): Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  try {
    const handle = await picker({ mode: "readwrite" });
    return handle as unknown as FsDirHandle;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

export type PickedFileWithFolder = { file: FsFileHandle; dir: FsDirHandle };

/**
 * Native file picker, then the directory picker anchored at that file's
 * folder (the API has no parent-handle escape from a file pick, so the
 * folder dialog opens INSIDE the file's directory — one confirm click).
 * FSA gives no paths, so the folder is the workspace root and the file
 * is addressed by name under it.
 */
export async function pickFileWithFolder(): Promise<PickedFileWithFolder | null> {
  const w = window as unknown as {
    showOpenFilePicker(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemFileHandle[]>;
    showDirectoryPicker(options?: { mode?: "read" | "readwrite"; id?: string; startIn?: unknown }): Promise<FileSystemDirectoryHandle>;
  };
  try {
    const [fileHandle] = await w.showOpenFilePicker({ mode: "readwrite" });
    if (!fileHandle) return null;
    const dir = await w.showDirectoryPicker({ mode: "readwrite", startIn: fileHandle });
    return { file: fileHandle as unknown as FsFileHandle, dir: dir as unknown as FsDirHandle };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

// ── Permissions ──────────────────────────────────────────────────

/** Passive check — safe without a user gesture (used on restore). */
export async function queryFsaPermission(handle: FsDirHandle): Promise<FsPermissionState> {
  const permissioned = handle as unknown as PermissionedHandle;
  if (typeof permissioned.queryPermission !== "function") return "granted";
  return permissioned.queryPermission({ mode: "readwrite" });
}

/** Active grant — MUST run inside a user gesture (the reconnect button). */
export async function ensureFsaPermission(handle: FsDirHandle): Promise<boolean> {
  const permissioned = handle as unknown as PermissionedHandle;
  if (typeof permissioned.requestPermission !== "function") return true;
  return (await permissioned.requestPermission({ mode: "readwrite" })) === "granted";
}

// ── Handle persistence (IndexedDB) ───────────────────────────────
// FSA handles are structured-cloneable but NOT JSON — IndexedDB is the
// only home. Keyed per project so each project remembers its own folder,
// mirroring the localStorage saved-root contract.

const DB_NAME = "testpilot-workspace";
const STORE = "fsa-roots";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await run(db.transaction(STORE, mode).objectStore(STORE));
  } finally {
    db.close();
  }
}

/** Persist the workspace handle for a project. Best-effort: a failure
 *  only costs the refresh-restore convenience, never live edits. */
export async function saveRootHandle(projectId: string, handle: FsDirHandle): Promise<void> {
  try {
    await withStore("readwrite", (store) => requestToPromise(store.put(handle, projectId)));
  } catch (error) {
    console.warn("[TestPilot] Workspace handle persistence failed:", error);
  }
}

export async function loadRootHandle(projectId: string): Promise<FsDirHandle | null> {
  try {
    const handle = await withStore("readonly", (store) => requestToPromise(store.get(projectId) as IDBRequest<FsDirHandle | undefined>));
    return handle ?? null;
  } catch (error) {
    console.warn("[TestPilot] Workspace handle restore failed:", error);
    return null;
  }
}

export async function clearRootHandle(projectId: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => requestToPromise(store.delete(projectId)));
  } catch (error) {
    console.warn("[TestPilot] Workspace handle clear failed:", error);
  }
}

// ── Handle-path operations ───────────────────────────────────────
// The same guards and caps as the runner routes (runner/server.mjs):
// hidden build/VCS dirs, binaries and secret-shaped files never enter a
// tree or a search; 5,000 entries and 8 levels bound a walk; search
// caps mirror SEARCH_* in the runner so both backends feel identical.

const LIST_MAX_ENTRIES = 5_000;
const LIST_MAX_DEPTH = 8;
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_MAX_FILES_SCANNED = 800;
const SEARCH_MAX_LINES_PER_FILE = 20;
const SEARCH_MAX_TOTAL_LINES = 600;

/** Resolve a workspace-relative dir path ("", "a/b") under the root. */
async function dirFor(root: FsDirHandle, dirPath: string, create: boolean): Promise<FsDirHandle> {
  let dir = root;
  if (!dirPath) return dir;
  for (const segment of dirPath.split("/")) {
    if (!segment) continue;
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

function notFound(path: string): Error {
  return new Error(`not found: ${path}`);
}

/** Last path segment (noUncheckedIndexedAccess-safe; empty → "bad path"). */
function lastOf(segments: string[]): string {
  const last = segments[segments.length - 1];
  if (!last) throw new Error("bad path");
  return last;
}

function isMissing(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === "NotFoundError" || error.name === "TypeMismatchError");
}

/**
 * Recursive FolderNode walk over the handle tree. Hidden dirs follow the
 * shared SKIP_DIR_NAMES list; entries/depth caps mirror the runner. The
 * root itself always "exists" (the handle proves it).
 */
export async function listFsaTree(root: FsDirHandle, maxDepth = LIST_MAX_DEPTH): Promise<{ tree: FolderNode[]; exists: boolean }> {
  let count = 0;
  /** Depth-first walk threading the prefix through: paths come out
   *  workspace-relative with forward slashes — the same shape the runner
   *  returns, so buildTree/pathSkipReason need no translation. Folders
   *  sort before files per level, matching the runner's walk. */
  async function walk(dir: FsDirHandle, prefixPath: string, depth: number): Promise<FolderNode[]> {
    const dirs: FolderNode[] = [];
    const files: FolderNode[] = [];
    for await (const [name, child] of dir.entries()) {
      if (count >= LIST_MAX_ENTRIES || depth >= maxDepth) break;
      count += 1;
      const path = prefixPath ? `${prefixPath}/${name}` : name;
      if (child.kind === "directory") {
        if (SKIP_DIR_NAMES.has(name)) continue;
        const children = depth + 1 < maxDepth ? await walk(child as FsDirHandle, path, depth + 1) : [];
        dirs.push({ name, path, kind: "dir", children });
      } else {
        files.push({ name, path, kind: "file" });
      }
    }
    return [...dirs, ...files];
  }
  const tree = await walk(root, "", 0);
  return { tree, exists: true };
}

/** Read one text file; null when missing (the runner's 404 contract). */
export async function readFsaFile(root: FsDirHandle, path: string): Promise<string | null> {
  try {
    const segments = path.split("/").filter(Boolean);
    const dir = await dirFor(root, segments.slice(0, -1).join("/"), false);
    const file = await dir.getFileHandle(lastOf(segments));
    return await (await file.getFile()).text();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Write one file, creating missing parents (mkdir -p parity). */
export async function writeFsaFile(root: FsDirHandle, path: string, content: string): Promise<void> {
  const segments = path.split("/").filter(Boolean);
  const dir = await dirFor(root, segments.slice(0, -1).join("/"), true);
  const file = await dir.getFileHandle(lastOf(segments), { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

/** Delete a file or folder (recursive). "not found" in the error keeps
 *  the useTestWorkspace already-gone tolerance working unchanged. */
export async function deleteFsaPath(root: FsDirHandle, path: string): Promise<void> {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("refusing to delete the workspace root");
  const dir = await dirFor(root, segments.slice(0, -1).join("/"), false);
  try {
    await dir.removeEntry(lastOf(segments), { recursive: true });
  } catch (error) {
    if (isMissing(error)) throw notFound(path);
    throw error;
  }
}

/** mkdir -p under the handle root. */
export async function mkdirFsaPath(root: FsDirHandle, path: string): Promise<void> {
  await dirFor(root, path, true);
}

/** Copy a file handle's content to a path under the root. */
async function copyFileTo(root: FsDirHandle, file: FsFileHandle, targetPath: string): Promise<void> {
  const text = await (await file.getFile()).text();
  await writeFsaFile(root, targetPath, text);
}

/** Deep-copy a directory's guarded entries to a target dir path. */
async function copyDirTo(root: FsDirHandle, dir: FsDirHandle, targetPath: string): Promise<void> {
  await mkdirFsaPath(root, targetPath);
  for await (const [name, child] of dir.entries()) {
    const path = `${targetPath}/${name}`;
    if (child.kind === "directory") {
      if (SKIP_DIR_NAMES.has(name)) continue;
      await copyDirTo(root, child as FsDirHandle, path);
    } else {
      await copyFileTo(root, child as FsFileHandle, path);
    }
  }
}

/**
 * Rename/move by copy+delete — the FSA spec ships no rename. The target
 * must not exist (the runner's 409 contract). The copy completes BEFORE
 * the delete, so a mid-flight failure never loses the source.
 */
export async function renameFsaPath(root: FsDirHandle, oldPath: string, newPath: string): Promise<void> {
  const oldSegments = oldPath.split("/").filter(Boolean);
  const newSegments = newPath.split("/").filter(Boolean);
  if (oldSegments.length === 0 || newSegments.length === 0) throw new Error("bad path");
  // Target must not exist — file or directory.
  try {
    const newParent = await dirFor(root, newSegments.slice(0, -1).join("/"), false);
    const newName = lastOf(newSegments);
    let exists = true;
    try {
      await newParent.getFileHandle(newName);
    } catch {
      try {
        await newParent.getDirectoryHandle(newName);
      } catch {
        exists = false;
      }
    }
    if (exists) throw new Error(`already exists: ${newPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("already exists")) throw error;
    // Parent missing is fine — the write below creates it.
  }
  const oldParent = await dirFor(root, oldSegments.slice(0, -1).join("/"), false);
  const oldName = lastOf(oldSegments);
  try {
    const file = await oldParent.getFileHandle(oldName);
    await copyFileTo(root, file, newPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
    const dir = await oldParent.getDirectoryHandle(oldName);
    await copyDirTo(root, dir, newPath);
  }
  try {
    await oldParent.removeEntry(oldName, { recursive: true });
  } catch (error) {
    if (isMissing(error)) throw notFound(oldPath);
    throw error;
  }
}

/** Client-side content search, mirroring the runner's caps and guards. */
export async function searchFsaWorkspace(root: FsDirHandle, query: string): Promise<SearchResponse> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return { results: [], truncated: false };
  const { tree } = await listFsaTree(root);
  const files: string[] = [];
  const flatten = (nodes: FolderNode[]) => {
    for (const node of nodes) {
      if (node.kind === "dir") flatten(node.children ?? []);
      else files.push(node.path);
    }
  };
  flatten(tree);
  const results: { path: string; lines: SearchLine[] }[] = [];
  let scanned = 0;
  let totalLines = 0;
  let truncated = false;
  for (const path of files) {
    if (scanned >= SEARCH_MAX_FILES_SCANNED || totalLines >= SEARCH_MAX_TOTAL_LINES) {
      truncated = true;
      break;
    }
    if (pathSkipReason(path)) continue;
    const resolved = await (async () => {
      try {
        const segments = path.split("/").filter(Boolean);
        const dir = await dirFor(root, segments.slice(0, -1).join("/"), false);
        return await dir.getFileHandle(lastOf(segments));
      } catch {
        return null;
      }
    })();
    if (!resolved) continue;
    const blob = await resolved.getFile();
    if (blob.size > SEARCH_MAX_FILE_BYTES) continue;
    const text = await blob.text();
    if (text.includes("\u0000")) continue; // binary
    scanned += 1;
    const textLines = text.split("\n");
    const lines: SearchLine[] = [];
    for (let index = 0; index < textLines.length; index++) {
      if (!textLines[index]?.toLowerCase().includes(needle)) continue;
      totalLines += 1;
      if (lines.length < SEARCH_MAX_LINES_PER_FILE && totalLines <= SEARCH_MAX_TOTAL_LINES) {
        lines.push({ number: index + 1, text: (textLines[index] ?? "").slice(0, 300) });
      }
      if (totalLines >= SEARCH_MAX_TOTAL_LINES) {
        truncated = true;
        break;
      }
    }
    if (lines.length > 0) results.push({ path, lines });
  }
  return { results, truncated };
}

// ── The seam: one io object, two transports ──────────────────────
// Identical call signatures to localFolder; when `fsa` is null the
// runner transport answers (Firefox, or a runner-path workspace).

export type WorkspaceIo = {
  listTree(opts: { root: string; maxDepth?: number }): Promise<{ tree: FolderNode[]; exists: boolean }>;
  readUserFile(opts: { root: string; path: string }): Promise<string | null>;
  writeUserFile(opts: { root: string; path: string; content: string }): Promise<void>;
  deleteUserPath(opts: { root: string; path: string }): Promise<void>;
  renameUserPath(opts: { root: string; oldPath: string; newPath: string }): Promise<void>;
  mkdirUserPath(opts: { root: string; path: string }): Promise<void>;
  search(opts: { root: string; query: string }): Promise<SearchResponse>;
};

export function createWorkspaceIo(fsa: FsDirHandle | null): WorkspaceIo {
  if (!fsa) return localFolder;
  return {
    listTree: () => listFsaTree(fsa),
    readUserFile: (opts) => readFsaFile(fsa, opts.path),
    writeUserFile: (opts) => writeFsaFile(fsa, opts.path, opts.content),
    deleteUserPath: (opts) => deleteFsaPath(fsa, opts.path),
    renameUserPath: (opts) => renameFsaPath(fsa, opts.oldPath, opts.newPath),
    mkdirUserPath: (opts) => mkdirFsaPath(fsa, opts.path),
    search: (opts) => searchFsaWorkspace(fsa, opts.query)
  };
}
