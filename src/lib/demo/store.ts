import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import * as cloud from "../blocks/data";
import { projects, suiteById, suites, type Environment, type Issue, type IssueStatus, type Project, type ProjectIcon, type Run } from "./data";
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
};

let state: DemoState = { status: "loading", runs: [], issues: [] };
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
      emit({ status: "ready", runs: sortRuns(snapshot.runs), issues: sortIssues(snapshot.issues) });
    } catch (error) {
      // The exact gateway reason (GraphQL errors ride in HTTP 200 bodies and
      // are unpacked by cloud.assertGateway) must reach the console -- an
      // empty UI with zero diagnostics is undebuggable.
      console.error("[TestPilot] Blocks Data load failed:", error);
      emit({ status: "error", runs: [], issues: [] });
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
  emit({ status: "loading", runs: [], issues: [] });
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
