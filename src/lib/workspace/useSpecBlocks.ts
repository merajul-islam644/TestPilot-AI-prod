import { useEffect, useState } from "react";
import { loadTestWorkspace } from "../blocks/data";
import { localFolder } from "./localFolder";
import { parseSpecBlocks, type SpecTestBlock } from "./specBlocks";

export type SpecFileBlocks = { file: string; tests: SpecTestBlock[] };

/**
 * Parse the given workspace-relative spec paths into their test/step blocks.
 * Two read paths:
 *  • runner root (same machine): files stream from the local runner's
 *    guarded read endpoint — always the freshest disk state.
 *  • gateway mirror (remote viewer): a browser on another machine has no
 *    localhost runner; the admin's open publishes every runnable spec's
 *    CONTENT to the gateway (TestSpec rows), and this hook parses that
 *    mirror instead — identical blocks, possibly a few seconds staler.
 * null while loading; one entry per path otherwise (a vanished or
 * unreadable file yields an empty list, never a failure — the tree must
 * survive a half-deleted workspace). FSA roots are not readable without a
 * click-granted permission, so callers pass null there (with a projectId
 * the gateway mirror still answers).
 */
export function useSpecBlocks(root: string | null, specPaths: string[], projectId?: string): SpecFileBlocks[] | null {
  const [files, setFiles] = useState<SpecFileBlocks[] | null>(null);
  const pathKey = specPaths.join("|");
  useEffect(() => {
    setFiles(null);
    if (specPaths.length === 0) return;
    if (!root && !projectId) return;
    let cancelled = false;
    void (async () => {
      let out: SpecFileBlocks[];
      if (root) {
        out = [];
        for (const path of specPaths) {
          if (cancelled) return;
          try {
            const content = await localFolder.readUserFile({ root, path });
            if (cancelled) return;
            out.push({ file: path, tests: content ? parseSpecBlocks(content) : [] });
          } catch {
            out.push({ file: path, tests: [] });
          }
        }
      } else {
        // Gateway mirror: load once, parse in memory.
        try {
          const workspace = await loadTestWorkspace(projectId as string);
          if (cancelled) return;
          const byPath = new Map(workspace.files.map((file) => [file.path, file.content]));
          out = specPaths.map((path) => ({ file: path, tests: parseSpecBlocks(byPath.get(path) ?? "") }));
        } catch {
          if (cancelled) return;
          out = specPaths.map((path) => ({ file: path, tests: [] }));
        }
      }
      if (!cancelled) setFiles(out);
    })();
    return () => {
      cancelled = true;
    };
    // pathKey covers the whole list identity; the array itself is unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, pathKey, projectId]);
  return files;
}
