import { useSyncExternalStore } from "react";

/**
 * What the suites surfaces and the New Run modal need to know about the
 * workspace a project has open — published by useTestWorkspace whenever a
 * folder loads (or closes), so a suite is literally "the specs on disk"
 * rather than a disconnected record.
 *
 * Persisted per browser (mirroring wb-folder-root.v1:*) so a refresh does
 * not blank the suites views before the Tests tab is reopened. Same-tab
 * only: cross-tab sync would need storage events, which nothing here needs.
 */
export type WorkspaceInfo = {
  /** Folder name as shown in the workbench (not the absolute path). */
  root: string;
  /** Runnable spec paths the workbench computed from the tree. */
  specPaths: string[];
  /** Total files in the workspace tree (specs are a subset). */
  filesCount: number;
  updatedAt: number;
};

const STORAGE_KEY = "testpilot:workspace-info.v1";
/** Keep the persisted payload bounded; 200 specs is past every real suite. */
const SPEC_CAP = 200;

let cache: Record<string, WorkspaceInfo> = readStorage();
const listeners = new Set<() => void>();

function readStorage(): Record<string, WorkspaceInfo> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WorkspaceInfo>;
    // Shape-check entries so a structural change degrades to "no workspace
    // known" instead of crashing every reader.
    for (const [id, info] of Object.entries(parsed)) {
      if (typeof info?.root !== "string" || !Array.isArray(info?.specPaths)) delete parsed[id];
    }
    return parsed;
  } catch {
    return {};
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWorkspaceInfo(projectId: string): WorkspaceInfo | null {
  return cache[projectId] ?? null;
}

export function setWorkspaceInfo(projectId: string, info: WorkspaceInfo | null): void {
  const next = { ...cache };
  if (info) next[projectId] = { ...info, specPaths: info.specPaths.slice(0, SPEC_CAP) };
  else delete next[projectId];
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* private mode / quota — the in-memory view still works */
  }
  for (const listener of listeners) listener();
}

/** One project's known workspace, or null. Snapshot is a stable reference
 *  between mutations, so useSyncExternalStore does not loop. */
export function useWorkspaceInfo(projectId: string): WorkspaceInfo | null {
  return useSyncExternalStore(subscribe, () => getWorkspaceInfo(projectId));
}

/** The whole registry (stable object per mutation) — for list pages that
 *  map every project to its derived suite. */
export function useWorkspaceInfos(): Record<string, WorkspaceInfo> {
  return useSyncExternalStore(subscribe, () => cache);
}
