import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import * as cloud from "../blocks/data";
import { cleanCaseError, runSpecsOnRunner } from "../runner/client";
import { projects, suiteById, suites, type CaseResult, type Environment, type Issue, type IssueStatus, type Project, type ProjectIcon, type Run, type Suite } from "./data";
import { translate } from "../i18n/LocalizationProvider";
import type { TranslationKey } from "../i18n/dictionary";

// Domain store backed by the Blocks Data Gateway. The app-facing shape stays
// synchronous (useSyncExternalStore) so pages keep reading `runs`/`issues`
// and the live `projects`/`suites` catalogs exactly as before; behind that
// facade every load lists the gateway collections, seeds an empty tenant on
// first run, and every mutation optimistically updates local state and then
// persists the record fire-and-forget. A failed cloud write never breaks the
// UI -- the record re-syncs on the next full load.

export type DemoState = {
  status: "loading" | "ready" | "error";
  runs: Run[];
  issues: Issue[];
  /** Persisted per-case rows from runner-backed runs, grouped by runId on read. */
  caseResults: CaseResult[];
};

let state: DemoState = { status: "loading", runs: [], issues: [], caseResults: [] };
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
      emit({ status: "ready", runs: sortRuns(snapshot.runs), issues: sortIssues(snapshot.issues), caseResults: sortCases(caseResults) });
    } catch (error) {
      // The exact gateway reason (GraphQL errors ride in HTTP 200 bodies and
      // are unpacked by cloud.assertGateway) must reach the console -- an
      // empty UI with zero diagnostics is undebuggable.
      console.error("[TestPilot] Blocks Data load failed:", error);
      emit({ status: "error", runs: [], issues: [], caseResults: [] });
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

function sortRuns(runs: Run[]): Run[] {
  return [...runs].sort((a, b) => b.startedAt - a.startedAt);
}

function sortCases(cases: cloud.StoredCase[]): CaseResult[] {
  return [...cases]
    .sort((a, b) => (a.runId === b.runId ? a.order - b.order : a.runId.localeCompare(b.runId)))
    .map((entry) => ({ id: entry.id, name: entry.name, status: entry.status as CaseResult["status"], durationMs: entry.durationMs, error: entry.error || undefined, runId: entry.runId, order: entry.order }));
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

export function startRun(input: { projectId: string; suiteId: string; environment: Environment; name?: string; description?: string }) {
  const suite = suiteById(input.suiteId);
  const id = `run-${Date.now()}-${++runSequence}`;
  const now = Date.now();

  const run: Run = {
    id,
    name: input.name?.trim() || `${suite?.name ?? "Test run"} · ${input.environment}`,
    projectId: input.projectId,
    suiteId: input.suiteId,
    environment: input.environment,
    status: "pending",
    total: 0,
    passed: 0,
    failed: 0,
    durationSec: 0,
    startedAt: now,
    triggeredBy: "You",
    browser: "chromium"
  };

  emit({ ...state, runs: sortRuns([run, ...state.runs]) });
  toast.info(translate("toast.runStarted"), { description: run.name });
  void cloud.createRunRecord(run).catch(() => undefined);

  // pending -> running -> terminal. The failure roll is deterministic per
  // run id so a refresh mid-flight cannot change the outcome the viewer
  // already saw progressing.
  const queue = window.setTimeout(() => {
    timers.delete(id);
    patchRun(id, { status: "running", progress: 0 });

    const tick = window.setInterval(() => {
      const current = state.runs.find((entry) => entry.id === id);
      const progress = Math.min(100, (current?.progress ?? 0) + 7 + (hash(id) % 6));
      if (progress >= 100) {
        window.clearInterval(tick);
        timers.delete(`${id}:tick`);
        finishRun(id);
      } else {
        patchRun(id, { progress });
      }
    }, 900);
    timers.set(`${id}:tick`, tick);
  }, 2_800);
  timers.set(id, queue);
}

export function cancelRun(runId: string) {
  const run = state.runs.find((entry) => entry.id === runId);
  if (!run || (run.status !== "running" && run.status !== "pending")) return;
  clearTimers(runId);
  patchRun(runId, {
    status: "cancelled",
    progress: undefined,
    durationSec: Math.max(1, Math.round((Date.now() - run.startedAt) / 1000))
  });
  toast.info(translate("toast.runCancelled"), { description: run.name });
}

/** Local patch + cloud persistence for the simulated run lifecycle. */
function patchRun(runId: string, patch: Partial<Run>) {
  const runs = state.runs.map((entry) => (entry.id === runId ? { ...entry, ...patch } : entry));
  emit({ ...state, runs });
  const next = runs.find((entry) => entry.id === runId);
  if (next) void cloud.updateRunRecord(next).catch(() => undefined);
}

function finishRun(runId: string) {
  const run = state.runs.find((entry) => entry.id === runId);
  if (!run) return;
  // ~85% green, matching the historical distribution.
  const failed = hash(runId) % 100 < 15 ? 1 + (hash(`${runId}:f`) % Math.max(1, Math.floor(run.total * 0.2))) : 0;
  const total = 14 + (hash(`${runId}:t`) % 26);
  patchRun(runId, {
    status: failed > 0 ? "failed" : "passed",
    total,
    passed: total - failed,
    failed,
    progress: undefined,
    durationSec: Math.round(total * (11 + (hash(`${runId}:d`) % 9)))
  });
  if (failed > 0) toast.error(`${run.name} — ${translate("status.failed")}`);
  else toast.success(`${run.name} — ${translate("status.passed")}`);
}

function hash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100000;
}

// ---------------------------------------------------------------------------
// Runner-backed Playwright runs (Tests tab). Unlike the simulated lifecycle
// above, these execute real specs on the runner service; the run row, the
// per-case rows and one issue per failure all persist to the gateway.
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
    // The run can proceed without the suite row; the next full load re-lists
    // whatever the gateway accepted and this method re-creates if missing.
    console.warn("[TestPilot] Playwright suite create failed:", error);
  }
  return suite;
}

export type PlaywrightRunOutcome = { run: Run; cases: CaseResult[] };

export async function runPlaywrightTests(input: { projectId: string; files: { name: string; content: string }[]; baseURL: string }): Promise<PlaywrightRunOutcome> {
  const project = projects.find((entry) => entry.id === input.projectId);
  if (!project) throw new Error("Unknown project");
  const suite = await ensurePlaywrightSuite(input.projectId);

  const id = `run-pw-${Date.now()}-${++runSequence}`;
  const now = Date.now();
  const run: Run = {
    id,
    name: `Playwright · ${project.name}`,
    projectId: input.projectId,
    suiteId: suite.id,
    environment: "staging",
    status: "running",
    total: 0,
    passed: 0,
    failed: 0,
    durationSec: 0,
    startedAt: now,
    triggeredBy: "Playwright runner",
    browser: "chromium",
    progress: 0
  };
  emit({ ...state, runs: sortRuns([run, ...state.runs]) });
  void cloud.createRunRecord(run).catch(() => undefined);
  toast.info(translate("toast.runStarted"), { description: run.name });

  try {
    const result = await runSpecsOnRunner({
      name: run.name,
      baseURL: input.baseURL,
      files: input.files
    });

    const cases: CaseResult[] = result.cases.map((entry, index) => ({
      id: `${id}-c${index}`,
      name: entry.title,
      status: entry.status,
      durationMs: entry.durationMs,
      error: cleanCaseError(entry.error) || undefined,
      runId: id,
      order: index
    }));
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
      caseResults: [...cases, ...state.caseResults]
    });

    // Persist terminal state, case rows, and one issue per failure (capped so
    // a broken suite cannot flood the issues board).
    void cloud.updateRunRecord(finished).catch(() => undefined);
    void cloud.createCaseRecords(id, input.projectId, cases.map((entry) => ({
      id: entry.id,
      runId: id,
      projectId: input.projectId,
      name: entry.name,
      status: entry.status,
      durationMs: entry.durationMs,
      error: entry.error ?? "",
      order: entry.order ?? 0
    }))).catch((error) => console.warn("[TestPilot] CaseResult persist failed:", error));
    for (const failedCase of cases.filter((entry) => entry.status === "failed").slice(0, 5)) {
      createIssueFromCase(input.projectId, finished, failedCase);
    }

    if (result.summary.failed > 0) toast.error(`${run.name} — ${translate("status.failed")}`, { description: `${result.summary.failed}/${result.summary.total} ${translate("common.failed").toLowerCase()}` });
    else toast.success(`${run.name} — ${translate("status.passed")}`);
    return { run: finished, cases };
  } catch (error) {
    // Transport-level failure (runner down / timeout): park the run as
    // cancelled so it does not spin as "running" forever.
    patchRun(id, {
      status: "cancelled",
      progress: undefined,
      durationSec: Math.max(1, Math.round((Date.now() - now) / 1000))
    });
    toast.error(translate("toast.runnerFailed"), {
      description: error instanceof Error ? error.message.slice(0, 200) : undefined
    });
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
  toast.success(translate("toast.projectDeleted"), { description: name });
  void cloud.deleteProjectRecord(projectId).catch((error) => {
    toast.error(translate("toast.syncFailed"), { description: name });
    console.error("[TestPilot] Project delete failed:", error);
  });
}

/**
 * Settings > Danger zone: clear UI prefs, wipe every gateway record and let
 * refresh() reseed the tenant from the deterministic generators.
 */
export function resetDemoData() {
  for (const timeout of timers.values()) window.clearTimeout(timeout);
  for (const interval of timers.values()) window.clearInterval(interval);
  timers.clear();
  for (const key of [...localStorage.keys()]) {
    if (key.startsWith("testpilot:")) localStorage.removeItem(key);
  }
  emit({ status: "loading", runs: [], issues: [], caseResults: [] });
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

export function saveWorkspaceSettings(input: { projectId: string; baseURL: string }): Promise<void> {
  return cloud.saveWorkspaceSettings(input);
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
