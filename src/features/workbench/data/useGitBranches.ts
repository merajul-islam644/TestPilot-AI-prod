// The open clone's branch list, fetched through the runner's allowlisted
// git op. One hook, two consumers: the Source Control branch section and
// the sidebar's pinned bottom branch bar — both render the same list
// from a single fetch, and both re-read when the branch itself changes
// or a git mutation bumps the tick (commit / pull / push / create).
import { useCallback, useEffect, useState } from "react";
import { localFolder } from "../../../lib/workspace/localFolder";

export function useGitBranches(root: string | null, gitBranch: string | null, gitTick: number): {
  branches: string[];
  /** Non-empty when the last fetch failed (shown as a note in the SCM section). */
  note: string;
  /** Manual re-fetch (the SCM section's reload button). */
  reload: () => void;
} {
  const [branches, setBranches] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    async function run() {
      if (!root) {
        setBranches([]);
        setNote("");
        return;
      }
      try {
        const res = await localFolder.runGit({ root, op: "branch-list" });
        if (!alive) return;
        if (res.code !== 0) {
          setBranches([]);
          setNote(((res.stderr || res.stdout).trim() || "git branch failed").slice(0, 160));
          return;
        }
        // git prints local branches first, then origin/* — the picker keeps
        // that order. "origin" and "origin/HEAD" are pseudo-refs, not branches.
        setBranches(res.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
          .filter((line) => line !== "origin" && !line.startsWith("origin/HEAD")));
        setNote("");
      } catch (error) {
        if (!alive) return;
        setBranches([]);
        setNote(error instanceof Error ? error.message : String(error));
      }
    }
    void run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gitBranch/gitTick are change triggers, not data
  }, [root, gitBranch, gitTick, tick]);

  return { branches, note, reload };
}
