import { useEffect, useState } from "react";
import { localFolder } from "./localFolder";
import { parseSpecBlocks, type SpecTestBlock } from "./specBlocks";

export type SpecFileBlocks = { file: string; tests: SpecTestBlock[] };

/**
 * Parse the given workspace-relative spec paths of a runner-mode root into
 * their test/step blocks. null while loading; one entry per path otherwise
 * (a vanished or unreadable file yields an empty list, never a failure —
 * the tree must survive a half-deleted workspace). FSA roots are not
 * readable without a click-granted permission, so callers pass null there.
 */
export function useSpecBlocks(root: string | null, specPaths: string[]): SpecFileBlocks[] | null {
  const [files, setFiles] = useState<SpecFileBlocks[] | null>(null);
  const pathKey = specPaths.join("|");
  useEffect(() => {
    setFiles(null);
    if (!root || specPaths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const out: SpecFileBlocks[] = [];
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
      if (!cancelled) setFiles(out);
    })();
    return () => {
      cancelled = true;
    };
    // pathKey covers the whole list identity; the array itself is unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, pathKey]);
  return files;
}
