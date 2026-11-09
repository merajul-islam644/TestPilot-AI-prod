import { readSavedRoot } from "../features/workbench/data/useTestWorkspace";
import { isRunnableSpecPath, pathSkipReason } from "../lib/workspace/importFiles";
import { localFolder, type FolderNode } from "../lib/workspace/localFolder";
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
    try {
      const { tree, exists } = await localFolder.listTree({ root: saved.root });
      if (!exists) return;
      const paths = flattenPaths(tree).filter((path) => pathSkipReason(path) === null);
      setWorkspaceInfo(projectId, {
        root: saved.root,
        filesCount: paths.length,
        specPaths: paths.filter(isRunnableSpecPath),
        updatedAt: Date.now()
      });
    } catch {
      // Runner offline — suites show "no workspace" until the next reload.
    }
  }));
}
