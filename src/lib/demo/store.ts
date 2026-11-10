import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import * as cloud from "../blocks/data";
import { cleanCaseError, cancelRunnerRun, fetchRunProgress, fetchRunnerResults, runnerBusy, runSpecsOnRunner, type RunnerFinishedRun, type RunnerRunProgress } from "../runner/client";
import { loadCaseDetail, saveCaseDetail, type CaseDetailEntry } from "../../shared/caseDetailRegistry";
import { projects, suites, runTrigger, type CaseResult, type Environment, type Issue, type IssueStatus, type Project, type ProjectIcon, type Run, type Suite } from "./data";
import { translate } from "../i18n/LocalizationProvider";
import type { TranslationKey } from "../i18n/dictionary";
import { setWorkspaceInfo } from "../../shared/workspaceRegistry";

// Domain store backed by the Blocks Data Gateway. The app-facing shape stays
// synchronous (useSyncExternalStore) so pages keep reading `runs`/`issues`
// and the live `projects`/`suites` catalogs exactly as before; behind that
// facade every load lists the gateway collections, and every mutation
// optimistically updates local state and then persists the record
// fire-and-forget. A failed cloud write never breaks the UI -- the record
// re-syncs on the next full load.

export type DemoState = {
  status: "loading" | "ready" | "error";
  runs: Run[];
  issues: Issue[];
  /** Persisted per-case rows from runner-backed runs, grouped by runId on read. */
  caseResults: CaseResult[];
  /** The runner suite currently executing — set by the dispatching page and,
   *  after that page dies, by the boot reconcile's live watch. Module-level
   *  truth: a workbench that (re)mounts mid-run reattaches to it, because
   *  module state survives route changes that kill component state. */
  activeRunnerRun: { runId: string; projectId: string } | null;
};

let state: DemoState = { status: "loading", runs: [], issues: [], caseResults: [], activeRunnerRun: null };
const listeners = new Set<() => void>();
const timers = new Map<string, number>();
let runSequence = 1000;
let refreshStarted = false;
let refreshInFlight: Promise<void> | undefined;

function emit(next: DemoState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Live progress fan-out: the dispatch poll and the orphan watch both push
 *  every /status heartbeat here; a mounted workbench subscribes to log
 *  milestone lines even when it did not dispatch the run itself. */
const progressListeners = new Set<(progress: RunnerRunProgress) => void>();

export function subscribeRunnerProgress(callback: (progress: RunnerRunProgress) => void): () => void {
  progressListeners.add(callback);
  return () => {
    progressListeners.delete(callback);
  };
}

/** Store-side view of the in-flight suite — the workbench reattach reads this. */
export function useActiveRunnerRun(): { runId: string; projectId: string } | null {
  return useSyncExternalStore(subscribe, () => state.activeRunnerRun);
}

/** The most recent /status heartbeat, kept so a view mounting mid-run (the
 *  run detail opened after the suite started) sees the last known snapshot
 *  immediately instead of waiting out the next ~2 s poll. */
let lastRunnerProgress: RunnerRunProgress | null = null;

/** Latest /status snapshot, or null before the first heartbeat of a run. */
export function runnerProgressSnapshot(): RunnerRunProgress | null {
  return lastRunnerProgress;
}

function notifyProgressListeners(progress: RunnerRunProgress): void {
  lastRunnerProgress = progress;
  for (const callback of progressListeners) callback(progress);
}

/** Cloud writes are what make data visible from every browser, so a failed
 *  write must be seen, not swallowed — silence is how runs and suites went
 *  missing cross-browser. Console for every caller; toast because the user
 *  just did the action whose result is not saved. */
function warnCloudWriteFailure(what: string): (error: unknown) => void {
  return (error) => {
    console.warn(`[TestPilot] ${what} failed:`, error);
    toast.error(`${what} could not be saved`, {
      description: (error instanceof Error ? error.message : String(error)).slice(0, 200)
    });
  };
}

/**
 * First call kicks off the gateway load (idempotent and guarded, so the
 * StrictMode double render and multi-page mounts share one request).
 */
export function useDemoState(): DemoState {
  if (!refreshStarted) {
    refreshStarted = true;
    void refresh();
  }
  return useSyncExternalStore(subscribe, () => state);
}

async function refresh(): Promise<void> {
  refreshInFlight ??= (async () => {
    try {
      const snapshot = await cloud.loadDomain();
      fillCatalog(projects, snapshot.projects);
      fillCatalog(suites, snapshot.suites);
      // Runner case rows are secondary: a collection hiccup must not blank the
      // whole app, so they resolve to [] instead of failing the load.
      const caseResults = await cloud.listCaseRecords().catch((error) => {
        console.warn("[TestPilot] CaseResult load failed:", error);
        return [] as cloud.StoredCase[];
      });
      // Legacy default run names carried a "Playwright · " prefix; display
      // them as the bare project name so run headers read clean. Display-
      // level only — the stored record is left as written.
      const runs = snapshot.runs.map((run) => {
        const projectName = projects.find((entry) => entry.id === run.projectId)?.name;
        return projectName && run.name === `Playwright · ${projectName}` ? { ...run, name: projectName } : run;
      });
      emit({ status: "ready", runs: sortRuns(dedupeRuns(runs)), issues: sortIssues(snapshot.issues), caseResults: sortCases(caseResults), activeRunnerRun: state.activeRunnerRun });
      // Cross-browser suite heal: the "Playwright tests" catalog row is what
      // makes Test Suites visible from a browser that never opened the
      // folder (derivedSuiteForProject falls back to it). Rows were lost to
      // silently-swallowed insert failures and project deletions, so every
      // project in the catalog gets its row re-created on boot — idempotent
      // (ensurePlaywrightSuite skips projects that already have one) and
      // gateway-backed, so no browser is special.
      for (const project of projects) void ensurePlaywrightSuite(project.id);
      // A dispatch whose page died mid-run leaves a stale "Running" record.
      // Ask the runner what actually happened and repair it (below).
      void reconcileRunnerRuns();
      // A page that stays OPEN must also see runs dispatched from ANOTHER
      // browser — the boot reconcile above only fires once per load.
      startRemoteRunAdoption();
    } catch (error) {
      // The exact gateway reason (GraphQL errors ride in HTTP 200 bodies and
      // are unpacked by cloud.assertGateway) must reach the console -- an
      // empty UI with zero diagnostics is undebuggable.
      console.error("[TestPilot] Blocks Data load failed:", error);
      emit({ status: "error", runs: [], issues: [], caseResults: [], activeRunnerRun: null });
    } finally {
      refreshInFlight = undefined;
    }
  })();
  return refreshInFlight;
}

/** Error-banner retry: re-run the gateway load without a full page reload. */
export function reloadDomain(): Promise<void> {
  return refresh();
}

/** Catalog arrays are imported across the app, so they are refilled in place. */
function fillCatalog<T>(catalog: T[], next: T[]) {
  catalog.length = 0;
  catalog.push(...next);
}

// --- Stale-run reconcile ----------------------------------------------------
// A run dispatched from a page that then closed (or reloaded mid-run) leaves
// the record "Running" forever: the suite kept going on the runner, but the
// response landed on nobody. The runner stashes finished results (memory +
// .runs/finished/*.json), and this reconcile — fired after every gateway
// load — repairs each stale record with the evidence it can prove:
//   • a matching finished result  → revive with the real outcome + case rows
//   • no result, runner idle      → the run is definitively dead → cancelled
//   • runner busy with THIS record's suite → watch it live (reattach):
//     rows keep updating and the editor can show the run again
//   • runner unreachable or busy with someone else's run → leave it alone
async function reconcileRunnerRuns(): Promise<void> {
  const live = state.runs.filter((entry) => entry.status === "running" || entry.status === "pending");
  if (live.length === 0) return;
  const results = await fetchRunnerResults();
  const busy = await runnerBusy();
  if (busy === null) return; // unreachable — never guess while offline
  // Mid-suite: one /status read serves every orphan match check below.
  const liveProgress = busy ? await fetchRunProgress() : null;
  const consumed = new Set<number>();
  for (const run of live) {
    const match = results.find((res) =>
      !consumed.has(res.startedAt)
      && res.startedAt >= run.startedAt - 5_000
      && res.startedAt <= run.startedAt + 300_000
    );
    if (match) {
      consumed.add(match.startedAt);
      reviveRunFromResult(run, match);
    } else if (!busy) {
      parkCancelledRun(run);
    } else if (
      !state.activeRunnerRun
      && liveProgress
      && liveProgress.startedAt >= run.startedAt - 5_000
      && liveProgress.startedAt <= run.startedAt + 300_000
    ) {
      // The dispatching page is gone but the suite executes: watch it live —
      // the row keeps breathing and the editor can reattach to the run.
      watchOrphanRun(run);
    }
  }
}

/** Applies a runner-kept result to a stale record — the same terminal path
 *  a live finish takes: record patch, case rows (gateway + registry), one
 *  issue per failure (capped), and the outcome toast. */
function reviveRunFromResult(run: Run, result: RunnerFinishedRun): void {
  const cases: CaseResult[] = result.cases.map((entry, index) => ({
    id: `${run.id}-c${index}`,
    name: entry.title,
    status: entry.status,
    durationMs: entry.durationMs,
    error: cleanCaseError(entry.error) || undefined,
    file: entry.file || undefined,
    steps: entry.steps?.map((step) => ({
      title: step.title,
      depth: step.depth,
      durationMs: step.durationMs,
      error: step.error ? cleanCaseError(step.error) || undefined : undefined
    })),
    runId: run.id,
    order: index
  }));
  const finished: Run = {
    ...run,
    status: result.summary.failed > 0 ? "failed" : "passed",
    total: result.summary.total || cases.length,
    passed: result.summary.passed,
    failed: result.summary.failed,
    progress: undefined,
    durationSec: Math.max(1, Math.round((result.summary.durationMs || result.finishedAt - result.startedAt) / 1000))
  };
  emit({
    ...state,
    runs: sortRuns([...state.runs.map((entry) => (entry.id === run.id ? finished : entry))]),
    caseResults: [...cases, ...state.caseResults]
  });
  void cloud.updateRunRecord(finished).catch(warnCloudWriteFailure("Run result"));
  persistCaseRows(run.id, run.projectId, cases);
  for (const failedCase of cases.filter((entry) => entry.status === "failed").slice(0, 5)) {
    createIssueFromCase(run.projectId, finished, failedCase);
  }
  if (result.summary.failed > 0) {
    toast.error(`${run.name} — ${translate("status.failed")}`, {
      description: `${result.summary.failed}/${result.summary.total} ${translate("common.failed").toLowerCase()}`
    });
  } else {
    toast.success(`${run.name} — ${translate("status.passed")}`);
  }
}

// --- Cross-browser live adoption --------------------------------------------
// The boot reconcile catches a run dispatched while this page was closed, but
// a page SITTING OPEN learned nothing when a run started in another browser:
// the gateway row lands after this page's load and nothing re-checks. While
// this page has no live run of its own, a quiet 5 s probe watches for one —
// runner busy + a matching gateway "Running" record → adopt it through the
// same watchOrphanRun path. Runner idle or unreachable → the probe is two
// skipped checks and zero gateway traffic.
const REMOTE_ADOPTION_POLL_MS = 5_000;
let remoteAdoptionTimer: number | null = null;

function matchesLiveRunnerRun(run: Run, progress: RunnerRunProgress): boolean {
  return (run.status === "running" || run.status === "pending")
    && progress.startedAt >= run.startedAt - 5_000
    && progress.startedAt <= run.startedAt + 300_000;
}

async function adoptRemoteRun(): Promise<void> {
  if (state.activeRunnerRun || state.status !== "ready") return;
  const busy = await runnerBusy();
  if (!busy || state.activeRunnerRun) return; // idle, unreachable, or a local run started meanwhile
  const progress = await fetchRunProgress();
  if (!progress || state.activeRunnerRun) return;
  const localMatch = state.runs.find((run) => matchesLiveRunnerRun(run, progress));
  if (localMatch) {
    watchOrphanRun(localMatch);
    return;
  }
  // No row in this page's catalog — it was dispatched after our load. One
  // focused runs refresh, then re-check before adopting.
  try {
    const runs = await cloud.listRunRecords();
    if (state.activeRunnerRun) return;
    emit({ ...state, runs: sortRuns(dedupeRuns(runs)) });
  } catch (error) {
    console.warn("[TestPilot] Runs refresh for adoption failed:", error);
    return;
  }
  const rematch = state.runs.find((run) => matchesLiveRunnerRun(run, progress));
  if (rematch && !state.activeRunnerRun) watchOrphanRun(rematch);
}

function startRemoteRunAdoption(): void {
  if (remoteAdoptionTimer !== null) return;
  remoteAdoptionTimer = window.setInterval(() => {
    void adoptRemoteRun();
  }, REMOTE_ADOPTION_POLL_MS);
}

/** Terminal "definitively dead" verdict for a stale record: cancelled with
 *  the honest wall-clock duration — the same story the row Cancel tells. */
function parkCancelledRun(run: Run): void {  patchRun(run.id, {
    status: "cancelled",
    progress: undefined,
    durationSec: Math.max(1, Math.round((Date.now() - run.startedAt) / 1000))
  });
  toast.info(translate("toast.runCancelled"), { description: run.name });
}

/** Live-watch a suite executing without its dispatching page (the boot
 *  reconcile matched a stale "Running" record to the runner's in-flight
 *  progress). Same duties as the dispatch poll: patch the record's live
 *  totals, stream heartbeats to listeners, and on suite end apply the real
 *  outcome — revive from the runner's keepsake when the child finished on
 *  its own, park cancelled when it was killed without one. */
function watchOrphanRun(run: Run): void {
  if (state.activeRunnerRun) return; // one watch at a time
  emit({ ...state, activeRunnerRun: { runId: run.id, projectId: run.projectId } });
  let finishing = false;
  const tick = window.setInterval(() => {
    const current = state.runs.find((entry) => entry.id === run.id);
    if (!current || (current.status !== "running" && current.status !== "pending")) {
      // Cancelled elsewhere — the row button already told that story.
      stopWatch();
      return;
    }
    void fetchRunProgress()
      .then(async (progress) => {
        if (!progress) {
          // The suite left /status — decide its end from the runner's evidence.
          await finishWatchedRun();
          return;
        }
        notifyProgressListeners(progress);
        const pct = progress.total > 0
          ? Math.min(99, Math.round((progress.completed / progress.total) * 100))
          : undefined;
        emit({
          ...state,
          runs: sortRuns(state.runs.map((entry) => (
            entry.id === run.id
              ? { ...entry, total: progress.total, passed: progress.passed, failed: progress.failed, progress: pct }
              : entry
          )))
        });
      })
      .catch(() => undefined);
  }, 2_000);

  function stopWatch(): void {
    window.clearInterval(tick);
    if (state.activeRunnerRun?.runId === run.id) emit({ ...state, activeRunnerRun: null });
  }

  async function finishWatchedRun(): Promise<void> {
    if (finishing) return;
    finishing = true;
    stopWatch();
    const busy = await runnerBusy();
    if (busy === null) return; // runner unreachable — the next boot reconcile decides
    if (busy) return; // another suite took the runner; its own watch/reconcile handles it
    const current = state.runs.find((entry) => entry.id === run.id);
    if (!current || (current.status !== "running" && current.status !== "pending")) return;
    const results = await fetchRunnerResults();
    const match = results.find((res) =>
      res.startedAt >= run.startedAt - 5_000
      && res.startedAt <= run.startedAt + 300_000
    );
    if (match) reviveRunFromResult(current, match);
    else parkCancelledRun(current);
  }
}

function sortRuns(runs: Run[]): Run[] {
  return [...runs].sort((a, b) => b.startedAt - a.startedAt);
}

// The gateway can end up holding two rows for one run id (a create racing a
// page reload re-fires with the same record). Two rows with one id mean
// duplicate React keys and two cancel buttons on one run — collapse to one,
// preferring a terminal record over a stale live twin.
function dedupeRuns(runs: Run[]): Run[] {
  const byId = new Map<string, Run>();
  for (const run of runs) {
    const existing = byId.get(run.id);
    if (!existing) {
      byId.set(run.id, run);
    } else if ((existing.status === "running" || existing.status === "pending") && run.status !== "running" && run.status !== "pending") {
      byId.set(run.id, run);
    }
  }
  return [...byId.values()];
}

// Per-case file + steps: saved locally first (reload-proof on this
// machine), then offered to the gateway (which keeps them only if its
// CaseResult schema accepts the columns). Shared by the live terminal
// path and the boot reconcile.
function persistCaseRows(runId: string, projectId: string, list: CaseResult[]): void {
  saveCaseDetail(runId, list);
  void cloud.createCaseRecords(runId, projectId, list.map((entry) => ({
    id: entry.id,
    runId,
    projectId,
    name: entry.name,
    status: entry.status,
    durationMs: entry.durationMs,
    error: entry.error ?? "",
    order: entry.order ?? 0,
    file: entry.file,
    steps: entry.steps
  }))).catch((error) => console.warn("[TestPilot] CaseResult persist failed:", error));
}

function sortCases(cases: cloud.StoredCase[]): CaseResult[] {
  // Re-attach each case's file + step results: the gateway may carry them
  // (stepsJson, when its schema accepted the columns) — otherwise the local
  // case-detail registry from the machine that ran the tests does. Without
  // this, every reload rendered executed steps as "Not run".
  const detailCache = new Map<string, Record<string, CaseDetailEntry> | null>();
  return [...cases]
    .sort((a, b) => (a.runId === b.runId ? a.order - b.order : a.runId.localeCompare(b.runId)))
    .map((entry) => {
      let detail = detailCache.get(entry.runId);
      if (detail === undefined) {
        detail = loadCaseDetail(entry.runId);
        detailCache.set(entry.runId, detail);
      }
      const hit = detail?.[entry.id];
      return {
        id: entry.id,
        name: entry.name,
        status: entry.status as CaseResult["status"],
        durationMs: entry.durationMs,
        error: entry.error || undefined,
        runId: entry.runId,
        order: entry.order,
        file: entry.file ?? hit?.file,
        steps: entry.steps ?? hit?.steps
      };
    });
}

// Seed order (ISS-101 first) is the display order every page expects; the
// gateway does not guarantee list order, so restore it explicitly.
function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => issueSequence(a) - issueSequence(b));
}

function issueSequence(issue: Issue): number {
  const parsed = Number.parseInt(issue.id.replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function clearTimers(runId: string) {
  const timeout = timers.get(runId);
  if (timeout !== undefined) {
    window.clearTimeout(timeout);
    timers.delete(runId);
  }
  const interval = timers.get(`${runId}:tick`);
  if (interval !== undefined) {
    window.clearInterval(interval);
    timers.delete(`${runId}:tick`);
  }
}

export function cancelRun(runId: string) {
  const run = state.runs.find((entry) => entry.id === runId);
  if (!run || (run.status !== "running" && run.status !== "pending")) return;
  clearTimers(runId);
  // A runner-backed live run must also STOP EXECUTING — the record patch
  // alone used to leave the runner's Playwright child burning CPU for the
  // rest of the timeout window. The in-flight request then answers
  // "cancelled", runPlaywrightTests parks the record again (idempotent).
  if (runTrigger(run) === "runner") void cancelRunnerRun().catch(() => undefined);
  patchRun(runId, {
    status: "cancelled",
    progress: undefined,
    durationSec: Math.max(1, Math.round((Date.now() - run.startedAt) / 1000))
  });
  toast.info(translate("toast.runCancelled"), { description: run.name });
}

/** Local patch + cloud persistence for the runner run lifecycle. */
function patchRun(runId: string, patch: Partial<Run>) {
  const runs = state.runs.map((entry) => (entry.id === runId ? { ...entry, ...patch } : entry));
  emit({ ...state, runs });
  const next = runs.find((entry) => entry.id === runId);
  // Background lifecycle repair — console only; no toast for a patch the
  // user did not directly trigger.
  if (next) void cloud.updateRunRecord(next).catch((error) => console.warn("[TestPilot] Run patch failed:", error));
}

// ---------------------------------------------------------------------------
// Runner-backed Playwright runs (Tests tab and New Run). Every run executes
// real specs on the runner service; the run row, the per-case rows and one
// issue per failure all persist to the gateway. The simulated lifecycle that
// used to live above this block is gone — there is no fake data path left.
// ---------------------------------------------------------------------------
const PLAYWRIGHT_SUITE_NAME = "Playwright tests";

/** Every runner run files under this suite so the existing suite/run UI works unchanged. */
async function ensurePlaywrightSuite(projectId: string): Promise<Suite> {
  const existing = suites.find((entry) => entry.projectId === projectId && entry.name === PLAYWRIGHT_SUITE_NAME);
  if (existing) return existing;
  const suite: Suite = {
    id: `suite-pw-${projectId}`,
    projectId,
    name: PLAYWRIGHT_SUITE_NAME,
    description: "Specs edited and executed from the project's Tests tab.",
    status: "active",
    owner: "You",
    lastUpdatedAt: Date.now()
  };
  suites.push(suite);
  emit({ ...state });
  try {
    await cloud.createSuiteRecord(suite);
  } catch (error) {
    // The run can proceed without the suite row; the next boot's heal
    // re-creates it. Silence once hid exactly this failure — without the
    // row no OTHER browser can see the suite.
    warnCloudWriteFailure("Suite row")(error);
  }
  return suite;
}

export type PlaywrightRunOutcome = { run: Run; cases: CaseResult[] };

export async function runPlaywrightTests(input: {
  projectId: string;
  files: { name: string; content: string }[];
  baseURL: string;
  root?: string;
  name?: string;
  environment?: Environment;
  /** Live runner progress while the suite executes (GET /status, ~2 s cadence). */
  onProgress?: (progress: RunnerRunProgress) => void;
}): Promise<PlaywrightRunOutcome> {
  const project = projects.find((entry) => entry.id === input.projectId);
  if (!project) throw new Error("Unknown project");
  const suite = await ensurePlaywrightSuite(input.projectId);

  const id = `run-pw-${Date.now()}-${++runSequence}`;
  const now = Date.now();
  const run: Run = {
    id,
    name: input.name?.trim() || project.name,
    projectId: input.projectId,
    suiteId: suite.id,
    environment: input.environment ?? "staging",
    status: "running",
    total: 0,
    passed: 0,
    failed: 0,
    durationSec: 0,
    startedAt: now,
    triggeredBy: "Playwright runner",
    browser: "chromium",
    trigger: "runner",
    progress: 0
  };
  emit({ ...state, runs: sortRuns([run, ...state.runs]), activeRunnerRun: { runId: id, projectId: input.projectId } });
  // The gateway row is what makes this run visible from every other
  // browser, so a failed insert must not vanish silently — it is exactly
  // how runs used to go missing cross-browser.
  void cloud.createRunRecord(run).catch(warnCloudWriteFailure("Run"));
  toast.info(translate("toast.runStarted"), { description: run.name });

  // Live progress while the suite runs: poll the runner's /status every 2 s
  // and patch the LOCAL run record only — the gateway is written at dispatch
  // and at the terminal state, never per tick (per-tick writes would spam
  // the collection for a 27-minute run). An unreachable/older runner answers
  // null and the bar simply keeps its last value.
  const pollTimer = window.setInterval(() => {
    void fetchRunProgress()
      .then((progress) => {
        if (!progress) return;
        // total=0 (begin line missed): no denominator for a % — the row
        // keeps "Running" without one, but the milestones still flow.
        const pct = progress.total > 0
          ? Math.min(99, Math.round((progress.completed / progress.total) * 100))
          : undefined;
        emit({
          ...state,
          runs: sortRuns([
            { ...run, total: progress.total, passed: progress.passed, failed: progress.failed, progress: pct },
            ...state.runs.filter((entry) => entry.id !== run.id)
          ])
        });
        input.onProgress?.(progress);
        notifyProgressListeners(progress);
      })
      .catch(() => undefined);
  }, 2_000);
  const stopProgressPolling = (): void => window.clearInterval(pollTimer);
  const persistCases = (list: CaseResult[]): void => persistCaseRows(id, input.projectId, list);

  try {
    const result = await runSpecsOnRunner({
      name: run.name,
      baseURL: input.baseURL,
      root: input.root,
      files: input.files
    });
    // The response carries the authoritative final numbers — stop polling.
    stopProgressPolling();

    const cases: CaseResult[] = result.cases.map((entry, index) => ({
      id: `${id}-c${index}`,
      name: entry.title,
      status: entry.status,
      durationMs: entry.durationMs,
      error: cleanCaseError(entry.error) || undefined,
      file: entry.file || undefined,
      steps: entry.steps?.map((step) => ({
        title: step.title,
        depth: step.depth,
        durationMs: step.durationMs,
        error: step.error ? cleanCaseError(step.error) || undefined : undefined
      })),
      runId: id,
      order: index
    }));
    // Cancel race: the user already flipped this record to "cancelled"
    // while the suite kept executing (a slow runner answers whenever it
    // finishes). A finished result landing afterwards must NOT resurrect
    // the cancelled record as passed/failed — keep it cancelled, but keep
    // the cases that did complete so the detail view still shows them.
    if (state.runs.find((entry) => entry.id === id)?.status === "cancelled") {
      emit({ ...state, caseResults: [...cases, ...state.caseResults], activeRunnerRun: null });
      persistCases(cases);
      return { run: state.runs.find((entry) => entry.id === id)!, cases };
    }
    const finished: Run = {
      ...run,
      status: result.summary.failed > 0 ? "failed" : "passed",
      total: cases.length,
      passed: result.summary.passed,
      failed: result.summary.failed,
      progress: undefined,
      durationSec: Math.max(1, Math.round(result.summary.durationMs / 1000))
    };
    emit({
      ...state,
      runs: sortRuns([finished, ...state.runs.filter((entry) => entry.id !== id)]),
      caseResults: [...cases, ...state.caseResults],
      activeRunnerRun: null
    });

    // Persist terminal state, case rows, and one issue per failure (capped so
    // a broken suite cannot flood the issues board).
    void cloud.updateRunRecord(finished).catch(warnCloudWriteFailure("Run result"));
    persistCases(cases);
    for (const failedCase of cases.filter((entry) => entry.status === "failed").slice(0, 5)) {
      createIssueFromCase(input.projectId, finished, failedCase);
    }

    if (result.summary.failed > 0) toast.error(`${run.name} — ${translate("status.failed")}`, { description: `${result.summary.failed}/${result.summary.total} ${translate("common.failed").toLowerCase()}` });
    else toast.success(`${run.name} — ${translate("status.passed")}`);
    return { run: finished, cases };
  } catch (error) {
    // Transport-level failure (runner down / timeout): park the run as
    // cancelled so it does not spin as "running" forever.
    stopProgressPolling();
    const userCancelled = state.runs.find((entry) => entry.id === id)?.status === "cancelled";
    patchRun(id, {
      status: "cancelled",
      progress: undefined,
      durationSec: Math.max(1, Math.round((Date.now() - now) / 1000))
    });
    // A user-initiated cancel already told its story ("Run cancelled" toast
    // from cancelRun) — don't stack a scary "runner failed" toast on top.
    if (!userCancelled) {
      toast.error(translate("toast.runnerFailed"), {
        description: error instanceof Error ? error.message.slice(0, 200) : undefined
      });
    }
    if (state.activeRunnerRun?.runId === id) emit({ ...state, activeRunnerRun: null });
    throw error;
  }
}

function createIssueFromCase(projectId: string, run: Run, failedCase: CaseResult) {
  const now = Date.now();
  const issue: Issue = {
    id: `ISS-R-${now.toString(36)}-${++runSequence}`,
    title: failedCase.name,
    projectId,
    runId: run.id,
    severity: "high",
    status: "open",
    message: failedCase.error ?? "Playwright case failed.",
    steps: [`Spec: ${run.name}`, `Case: ${failedCase.name}`],
    assignee: "",
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, actor: run.triggeredBy, labelKey: "issue.event.opened" }]
  };
  emit({ ...state, issues: sortIssues([issue, ...state.issues]) });
  void cloud.createIssueRecord(issue).catch((error) => {
    console.warn("[TestPilot] Issue persist failed:", error);
  });
}

export function setIssueStatus(issueId: string, status: IssueStatus, actor = "You") {
  const target = state.issues.find((issue) => issue.id === issueId);
  const labelKey: TranslationKey = status === "resolved" ? "issue.event.resolved" : status === "in_progress" ? "issue.event.started" : "issue.event.reopened";
  const issues = state.issues.map((issue) =>
    issue.id === issueId
      ? { ...issue, status, updatedAt: Date.now(), history: [...issue.history, { at: Date.now(), actor, labelKey }] }
      : issue
  );
  emit({ ...state, issues });
  toast.success(translate("toast.issueUpdated"), { description: target?.title });
  const next = issues.find((issue) => issue.id === issueId);
  if (next) {
    void cloud.updateIssueRecord(next).catch((error) => {
      toast.error(translate("toast.syncFailed"), { description: next.title });
      console.error("[TestPilot] Issue update failed:", error);
    });
  }
}

/** Projects page form input -- the store trims and derives the rest. */
export type ProjectInput = { name: string; description: string; icon: ProjectIcon; tags: string[] };

/** New project: optimistic catalog insert, then the gateway write. */
export function createProject(input: ProjectInput): Project {
  const project: Project = {
    id: `proj-${Date.now().toString(36)}`,
    name: input.name.trim(),
    description: input.description.trim(),
    icon: input.icon,
    tags: input.tags,
    createdAt: Date.now()
  };
  projects.push(project);
  // Pages read the module-level catalogs, so an emit is what makes the new
  // card show up -- the state fields themselves are unchanged.
  emit({ ...state });
  toast.success(translate("toast.projectCreated"), { description: project.name });
  void cloud.createProjectRecord(project).catch((error) => {
    toast.error(translate("toast.syncFailed"), { description: project.name });
    console.error("[TestPilot] Project create failed:", error);
  });
  return project;
}

export function updateProject(projectId: string, patch: ProjectInput): void {
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) return;
  project.name = patch.name.trim();
  project.description = patch.description.trim();
  project.icon = patch.icon;
  project.tags = patch.tags;
  emit({ ...state });
  toast.success(translate("toast.projectUpdated"), { description: project.name });
  void cloud.updateProjectRecord(project).catch((error) => {
    toast.error(translate("toast.syncFailed"), { description: project.name });
    console.error("[TestPilot] Project update failed:", error);
  });
}

/** Cascade delete: the UI drops the project and its records at once; the gateway rows follow in the background. */
export function deleteProject(projectId: string): void {
  const name = projects.find((entry) => entry.id === projectId)?.name;
  fillCatalog(projects, projects.filter((entry) => entry.id !== projectId));
  fillCatalog(suites, suites.filter((entry) => entry.projectId !== projectId));
  emit({
    ...state,
    issues: sortIssues(state.issues.filter((entry) => entry.projectId !== projectId)),
    runs: sortRuns(state.runs.filter((entry) => entry.projectId !== projectId))
  });
  // The workspace binding is browser-local: without this cleanup a deleted
  // project leaves an orphan folder registry behind, and its stale spec
  // paths keep firing 404 file reads from every page that touches it.
  try {
    localStorage.removeItem(`wb-folder-root.v1:${projectId}`);
  } catch {
    /* private mode — nothing to clean */
  }
  setWorkspaceInfo(projectId, null);
  toast.success(translate("toast.projectDeleted"), { description: name });
  void cloud.deleteProjectRecord(projectId).catch((error) => {
    toast.error(translate("toast.syncFailed"), { description: name });
    console.error("[TestPilot] Project delete failed:", error);
  });
}

/**
 * Settings > Danger zone: clear UI prefs, wipe every gateway record and
 * reload into the empty state. Nothing is reseeded — the next data in this
 * environment is whatever the user creates and runs for real.
 */
export function resetDemoData() {
  for (const timeout of timers.values()) window.clearTimeout(timeout);
  for (const interval of timers.values()) window.clearInterval(interval);
  timers.clear();
  for (const key of [...localStorage.keys()]) {
    if (key.startsWith("testpilot:")) localStorage.removeItem(key);
  }
  emit({ status: "loading", runs: [], issues: [], caseResults: [], activeRunnerRun: null });
  toast.info(translate("toast.resetStarted"));
  void (async () => {
    try {
      await cloud.deleteAllDomain();
    } catch {
      // Wipe failures are non-fatal: refresh reseeds only what is gone.
    }
    await refresh();
    toast.success(translate("toast.resetDone"));
  })();
}

export { suitesForProject } from "./data";

// ---------------------------------------------------------------------------
// Test workspace file operations (Tests tab). Files are not part of the
// reactive DemoState -- only the Tests tab reads them -- but every gateway
// call still goes through the store so components keep one data boundary.
// ---------------------------------------------------------------------------
export type WorkspaceFile = { path: string; content: string };

export function loadTestWorkspace(projectId: string): Promise<cloud.StoredWorkspace> {
  return cloud.loadTestWorkspace(projectId);
}

export function saveTestFile(input: { projectId: string; path: string; content: string }): Promise<void> {
  return cloud.saveTestFile(input);
}

/** Remove one workspace file's stored record (no-op if never stored). */
export function deleteTestFile(input: { projectId: string; path: string }): Promise<void> {
  return cloud.deleteTestFile(input);
}

export function saveWorkspaceSettings(input: { projectId: string } & cloud.WorkspaceSettings): Promise<void> {
  return cloud.saveWorkspaceSettings(input);
}

/** The server-side workspace binding (root + spec paths) another browser
 *  needs to render this project's suite spec list. */
export function loadWorkspaceSettings(projectId: string): Promise<cloud.WorkspaceSettings | null> {
  return cloud.loadWorkspaceSettings(projectId);
}

/** Import: replaces the project's stored file set with exactly these files.
 *  onProgress streams the clearing/writing phases to the workbench UI. */
export function importTestWorkspace(input: {
  projectId: string;
  files: WorkspaceFile[];
  onProgress?: (progress: cloud.ImportProgress) => void;
}): Promise<void> {
  return cloud.replaceTestFiles(input);
}
