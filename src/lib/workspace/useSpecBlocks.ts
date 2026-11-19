import { useEffect, useState } from "react";
import { loadTestWorkspace } from "../blocks/data";
import { localFolder } from "./localFolder";
import { parseSpecBlocks, type SpecTestBlock } from "./specBlocks";

export type SpecFileBlocks = { file: string; tests: SpecTestBlock[] };

/**
 * Parse the given workspace-relative spec paths into their test/step blocks.
 * Three read paths:
 *  • runner root (same machine), phase 1: files stream from the local
 *    runner's guarded read endpoint and a text scan produces an INSTANT
 *    preview — but the scan only recognizes common authoring shapes.
 *  • runner root, phase 2: the scan's contents go to the runner's /list,
 *    which materializes a temp project and lets PLAYWRIGHT'S OWN LOADER
 *    collect them (--list) — exact titles, chains and lines for ANY format.
 *    The upgrade replaces the scan in place; scan steps are carried over
 *    onto matching declaration lines (--list cannot see steps). Failure of
 *    any kind (runner offline, timeout, specs that don't load) silently
 *    keeps the phase-1 scan.
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
      /** Contents gathered on the runner path — phase 2's /list payload. */
      let contents: { name: string; content: string }[] = [];
      if (root) {
        out = [];
        for (const path of specPaths) {
          if (cancelled) return;
          try {
            const content = await localFolder.readUserFile({ root, path });
            if (cancelled) return;
            if (content) contents.push({ name: path, content });
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
      if (cancelled) return;
      setFiles(out);
      // Phase 2 — the authoritative upgrade. Only the runner path can run
      // Playwright; the gateway mirror stays on the scan.
      if (!root || contents.length === 0) return;
      const listed = await localFolder.listTests(root, contents);
      if (cancelled || !listed || listed.length === 0) return;
      const byFile = new Map<string, { title: string; line: number | null; describeChain: string[] }[]>();
      for (const test of listed) {
        const bucket = byFile.get(test.file) ?? [];
        bucket.push(test);
        byFile.set(test.file, bucket);
      }
      const upgraded: SpecFileBlocks[] = specPaths.map((path) => {
        const listedTests = byFile.get(path);
        const scanEntry = out.find((entry) => entry.file === path);
        if (!listedTests) return scanEntry ?? { file: path, tests: [] };
        // --list cannot see test.step blocks; the scan's steps (matched by
        // declaration line) are carried over so conformant files keep their
        // step-level tree.
        const scanByLine = new Map((scanEntry?.tests ?? []).map((test) => [test.line, test]));
        return {
          file: path,
          tests: listedTests.map((test) => {
            const scanned = test.line !== null ? scanByLine.get(test.line) : undefined;
            return {
              title: test.title,
              line: test.line ?? 0,
              describeChain: test.describeChain,
              steps: scanned?.steps ?? []
            };
          })
        };
      });
      if (!cancelled) setFiles(upgraded);
    })();
    return () => {
      cancelled = true;
    };
    // pathKey covers the whole list identity; the array itself is unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, pathKey, projectId]);
  return files;
}
