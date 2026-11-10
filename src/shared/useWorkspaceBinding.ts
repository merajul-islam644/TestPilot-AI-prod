import { useEffect, useState } from "react";
import { loadWorkspaceSettings } from "../lib/demo/store";
import type { WorkspaceSettings } from "../lib/blocks/data";

// One fetch per project per page load — the binding changes only when the
// folder browser re-publishes it (a boot or a folder open), and a reload
// picks that up naturally.
const cache = new Map<string, Promise<WorkspaceSettings | null>>();

function fetchBinding(projectId: string): Promise<WorkspaceSettings | null> {
  let promise = cache.get(projectId);
  if (!promise) {
    promise = loadWorkspaceSettings(projectId).catch((error) => {
      console.warn("[TestPilot] Workspace binding load failed:", error);
      return null;
    });
    cache.set(projectId, promise);
  }
  return promise;
}

/**
 * The server-side workspace binding another browser persisted (root + spec
 * paths + runner mode). Enabled only where the LOCAL registry has no row —
 * a browser that opened the folder itself already has fresher local state,
 * and a null result (nothing persisted yet, or the gateway was unreachable)
 * simply keeps the current behavior.
 */
export function useWorkspaceBinding(projectId: string, enabled: boolean): WorkspaceSettings | null {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    void fetchBinding(projectId).then((value) => {
      if (cancelled) return;
      const usable = Boolean(value?.root && value?.mode === "runner" && value.specPaths && value.specPaths.length > 0);
      setSettings(usable ? value : null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);
  return settings;
}
