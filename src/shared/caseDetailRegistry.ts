// localStorage mirror of per-case detail (spec file + step results) for
// runner runs. The gateway's CaseResult schema predates those fields, so
// steps used to die with the session — after a reload every executed step
// rendered as "Not run". This registry is the reload-proof copy on the
// machine that ran the tests; the gateway write is still attempted first
// (see blocks/data.ts createCaseRecords) and wins when it sticks.

import type { CaseStep } from "../lib/demo/data";

const PREFIX = "testpilot:case-detail.v1:";
// One full suite ≈ 15-20 KB; 25 runs stays far under the 5 MB quota.
const MAX_RUNS = 25;

export type CaseDetailEntry = { file?: string; steps?: CaseStep[] };
type CaseDetailPayload = { savedAt: number; cases: Record<string, CaseDetailEntry> };

/** Persist one finished run's per-case detail. Best effort — quota errors
 *  or a private window only cost the cross-reload view, never the run. */
export function saveCaseDetail(runId: string, cases: { id: string; file?: string; steps?: CaseStep[] }[]): void {
  try {
    const payload: CaseDetailPayload = {
      savedAt: Date.now(),
      cases: Object.fromEntries(cases.map((entry) => [entry.id, { file: entry.file, steps: entry.steps }]))
    };
    window.localStorage.setItem(PREFIX + runId, JSON.stringify(payload));
    prune();
  } catch {
    // Steps then live only in the session — acceptable.
  }
}

/** Per-case detail for a run, or null when this machine never ran it
 *  (another browser/device) or the entry was pruned. */
export function loadCaseDetail(runId: string): Record<string, CaseDetailEntry> | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + runId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CaseDetailPayload | null;
    return parsed && typeof parsed === "object" && parsed.cases ? parsed.cases : null;
  } catch {
    return null;
  }
}

/** Keep only the newest MAX_RUNS entries — old runs' step detail ages out. */
function prune(): void {
  try {
    const runs: { key: string; savedAt: number }[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as CaseDetailPayload | null;
      runs.push({ key, savedAt: typeof parsed?.savedAt === "number" ? parsed.savedAt : 0 });
    }
    if (runs.length <= MAX_RUNS) return;
    runs.sort((a, b) => a.savedAt - b.savedAt);
    for (const stale of runs.slice(0, runs.length - MAX_RUNS)) window.localStorage.removeItem(stale.key);
  } catch {
    // Pruning is best-effort.
  }
}
