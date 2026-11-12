import { readSavedRoot, sameWorkspaceRoot } from "../features/workbench/data/useTestWorkspace";
import { isRunnableSpecPath, pathSkipReason, workbenchPathFilter } from "../lib/workspace/importFiles";
import { localFolder, type FolderNode } from "../lib/workspace/localFolder";
import { loadWorkspaceSettings, saveWorkspaceSettings } from "../lib/demo/store";
import { setWorkspaceInfo } from "./workspaceRegistry";

// Once per page load per project. The bootstrap exists so a browser that has
// not mounted the Tests tab since the registry shipped (fresh browser,
// cleared storage, demo-data reset) still sees the project's derived suite.
const attempted = new Set<string>();

/** Forget this page load's attempts so the next "ready" re-derives every
 *  remembered workspace (demo-data reset wipes the registry but keeps the
 *  saved roots — without this, suites would stay blank until a reload). */
export function resetWorkspaceBootstrap(): void {
  attempted.clear();
}

function flattenPaths(tree: FolderNode[]): string[] {
  const found: string[] = [];
  const walk = (nodes: FolderNode[]) => {
    for (const node of nodes) {
      if (node.kind === "dir") walk(node.children ?? []);
      else found.push(node.path);
    }
  };
  walk(tree);
  return found;
}

/**
 * Rebuild workspace-registry entries for every project whose workbench folder
 * is remembered in runner mode (`wb-folder-root.v1:*`). Deliberately runs even
 * when a registry row already exists: a row written while the runner was down
 * (or before the derived-suites change) carries empty specs and would pin the
 * suites views blank until the Tests tab is remounted. At app start no
 * workbench is mounted, so the disk listing is the freshest truth available;
 * when the Tests tab does mount, its publish effect overwrites this through
 * the same writer. An FSA root cannot be listed without a click-granted
 * permission, so those still publish only from the workbench on restore.
 *
 * Failures (runner offline, folder gone) are swallowed — the next app load
 * retries, and the Tests tab remains the authoritative publisher.
 */
export async function bootstrapWorkspaceInfos(projectIds: string[]): Promise<void> {
  await Promise.all(projectIds.map(async (projectId) => {
    if (attempted.has(projectId)) return;
    attempted.add(projectId);
    const saved = readSavedRoot(projectId);
    if (!saved || saved.mode !== "runner") return;
    // Never clobber a NEWER binding from another browser: whoever opened a
    // different folder (or closed the shared one) AFTER this browser opened
    // its own owns the binding — the open-time stamp decides, and every
    // browser here shares one machine clock. Same-root republishes still
    // pass through to renew specPaths; an older or stamp-less gateway root
    // is re-claimed. This guard is what keeps a stale browser's boot from
    // resurrecting a folder the user replaced in another browser.
    const existing = await loadWorkspaceSettings(projectId).catch(() => null);
    if (existing
      && !sameWorkspaceRoot(existing.root ?? "", saved.root)
      && (existing.updatedAt ?? 0) > (saved.at ?? 0)) {
      return;
    }
    try {
      const { tree, exists } = await localFolder.listTree({ root: saved.root });
      if (!exists) return;
      // Same workbench folder scope as the Tests tab's loadFolder: the
      // project card's suite list must not count client/-style app trees.
      const paths = workbenchPathFilter(flattenPaths(tree).filter((path) => pathSkipReason(path) === null));
      const specPaths = paths.filter(isRunnableSpecPath);
      setWorkspaceInfo(projectId, {
        root: saved.root,
        filesCount: paths.length,
        specPaths,
        updatedAt: Date.now()
      });
      // Publish the binding to the gateway: this is what lets a browser that
      // never opened the folder render the same suite spec list (it fetches
      // root + spec paths from here, then reads the files through the runner,
      // which serves the same disk). projectIds come from the domain catalog,
      // so bindings are never persisted for deleted projects. Quiet failure —
      // the next boot re-scans and re-publishes.
      if (specPaths.length > 0) {
        // updatedAt carries the OPEN event's time (saved.at), not now — a
        // mere re-advertisement must not look like a newer claim.
        void saveWorkspaceSettings({ projectId, root: saved.root, mode: "runner", specPaths, updatedAt: saved.at ?? Date.now() })
          .catch((error) => console.warn("[TestPilot] Workspace binding save failed:", error));
      }
    } catch {
      // Runner offline — suites show "no workspace" until the next reload.
    }
  }));
}
