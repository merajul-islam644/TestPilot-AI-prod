// HTTP client for the Playwright runner service (runner/server.mjs). The SPA
// cannot launch Chromium, so the Tests tab POSTs saved specs here; the runner
// materializes a throwaway Playwright project, executes it headlessly and
// returns a compact, app-shaped result set. The base URL is overridable for
// hosted deployments; the default is the local dev runner.

/** One explicit test.step block of a case, flattened from the report's
 *  nested step tree (depth = nesting among steps). error present = failed. */
export type RunnerCaseStep = {
  title: string;
  depth: number;
  durationMs: number;
  error?: string;
};

export type RunnerCase = {
  title: string;
  /** Workspace-relative, forward-slash path matching files[].name. */
  file?: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  error?: string;
  steps?: RunnerCaseStep[];
};

export type RunnerSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  /** The effective base URL the run targeted — workspace .env values
   *  override the request's manual value, so this is what actually ran. */
  baseURL?: string;
};

export type RunnerResult = { ok: true; name?: string; summary: RunnerSummary; cases: RunnerCase[] };

/** A finished run the runner kept behind (GET /results): the dispatching
 *  page was gone by the time the suite completed, so this stashed payload
 *  is the only record of what happened. Matches RunnerResult's payload. */
export type RunnerFinishedRun = {
  startedAt: number;
  finishedAt: number;
  summary: RunnerSummary;
  cases: RunnerCase[];
};

/** One test.step(...) result carried on a live heartbeat case — lets the
 *  tree flip each step's dot (and pin the error under the failing step)
 *  the moment its test finishes. */
export type RunnerProgressStep = {
  title: string;
  line?: number;
  error?: string | null;
  durationMs?: number;
};

/** One finished test from the live heartbeat — the case tree flips this
 *  block's dot before the authoritative per-case rows land at the end.
 *  error/steps ride on newer runners; undefined = older runner, failures
 *  then surface only once the finished report lands. */
export type RunnerProgressCase = {
  title: string;
  file?: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  /** Test-level failure text (timeouts, expect failures outside test.step). */
  error?: string;
  /** The test.step blocks recorded for this test, in execution order. */
  steps?: RunnerProgressStep[];
};

/** Live progress snapshot from GET /status while a run is still executing —
 *  fed by the runner's in-line progress reporter (one JSON line per Playwright
 *  event). All counters are cumulative. currentTest/currentStep/cases ride on
 *  newer runners; undefined = older runner, the tree then just shows "Not
 *  run" blocks without the running highlight. */
export type RunnerRunProgress = {
  startedAt: number;
  total: number;
  completed: number;
  passed: number;
  failed: number;
  skipped: number;
  /** Title of the most recently finished test — gives the log a heartbeat. */
  current?: string | null;
  /** The test executing right now (workers are pinned to 1, so at most one). */
  currentTest?: { title: string; file?: string; line?: number; startedAt?: number; steps?: RunnerProgressStep[] } | null;
  /** The test.step(...) inside currentTest that is executing right now. */
  currentStep?: { title: string; line?: number; startedAt?: number } | null;
  /** Finished tests so far, in completion order. */
  cases?: RunnerProgressCase[];
  lastEventAt?: number;
};

/** Keep in sync with MAX_FILES in runner/server.mjs; the UI caps the run set at this.
 *  A real workspace carries ~10 specs plus every helper they import — 20 starved
 *  the helper set and specs failed to load. */
export const RUNNER_MAX_FILES = 100;

const RUNNER_URL = import.meta.env.VITE_RUNNER_URL ?? "http://localhost:9090";

/** A real suite runs sequentially for tens of minutes (the blocks-data repo
 *  took ~28 min); the fetch leash must cover a legitimate full run. */
const RUN_TIMEOUT_MS = 2_700_000;

export function runnerUrl(): string {
  return RUNNER_URL;
}

/** Cheap liveness probe for the runner status chip in the Tests tab. */
export async function pingRunner(): Promise<boolean> {
  try {
    const response = await fetch(`${RUNNER_URL}/health`, { signal: AbortSignal.timeout(4_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** The agent's pairing code — the terminal WebSocket refuses connections
 *  without it (WebSocket has no CORS, so the code is the door). null when
 *  the agent is unreachable or predates pairing (older frontend compat:
 *  the WS is then opened without a code). */
export async function fetchRunnerPairCode(): Promise<string | null> {
  try {
    const response = await fetch(`${RUNNER_URL}/pair`, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    return typeof body?.code === "string" && body.code ? body.code : null;
  } catch {
    return null;
  }
}

/** Live progress of the in-flight run, or null when the runner is idle or
 *  unreachable (an older runner without /status answers 404 — same null). */
export async function fetchRunProgress(): Promise<RunnerRunProgress | null> {
  try {
    const response = await fetch(`${RUNNER_URL}/status`, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { run?: RunnerRunProgress | null } | null;
    return body?.run ?? null;
  } catch {
    return null;
  }
}

/** Ask the runner to kill its in-flight Playwright child. True when the
 *  runner had something running and the kill was issued; false when the
 *  runner is unreachable (older runner without /cancel answers 404) or idle. */
/** Finished runs the runner kept behind (newest first). Empty when the
 *  runner is unreachable or nothing is stashed — the boot reconcile treats
 *  both as "no evidence". */
export async function fetchRunnerResults(): Promise<RunnerFinishedRun[]> {
  try {
    const response = await fetch(`${RUNNER_URL}/results`, { signal: AbortSignal.timeout(4_000) });
    const body = (await response.json().catch(() => null)) as { results?: RunnerFinishedRun[] } | null;
    return Array.isArray(body?.results) ? body.results : [];
  } catch {
    return [];
  }
}

/** Whether a suite is executing right now — null when the runner is
 *  unreachable (the reconcile path never guesses while offline). */
export async function runnerBusy(): Promise<boolean | null> {
  try {
    const response = await fetch(`${RUNNER_URL}/health`, { signal: AbortSignal.timeout(4_000) });
    const body = (await response.json().catch(() => null)) as { busy?: boolean } | null;
    return typeof body?.busy === "boolean" ? body.busy : null;
  } catch {
    return null;
  }
}

export async function cancelRunnerRun(): Promise<boolean> {
  try {
    const response = await fetch(`${RUNNER_URL}/cancel`, { method: "POST", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as { cancelled?: boolean } | null;
    return body?.cancelled === true;
  } catch {
    return false;
  }
}

export async function runSpecsOnRunner(input: { name: string; baseURL: string; root?: string; files: { name: string; content: string }[] }): Promise<RunnerResult> {  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  try {
    const response = await fetch(`${RUNNER_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // root lets the runner read the workspace's own .env files from disk
      // (they are never uploaded) so run values come from .env, like a
      // terminal `npm run test` would.
      body: JSON.stringify({ name: input.name, baseURL: input.baseURL, root: input.root, files: input.files }),
      signal: controller.signal
    });
    // Errors ride in JSON bodies with non-2xx statuses; 422 also carries the
    // Playwright load error verbatim in `detail` -- surface both.
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; detail?: string } | null;
    if (!response.ok || !payload?.ok) {
      const message = payload?.error ?? `Runner HTTP ${response.status}`;
      throw new Error(payload?.detail ? `${message}\n${payload.detail}` : message);
    }
    return payload as unknown as RunnerResult;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The runner did not answer in time.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Strip Playwright's ANSI coloring and cap the length for storage + UI. */
export function cleanCaseError(error: string | undefined): string {
  if (!error) return "";
  return error.replace(/\u001b\[[0-9;]*m/g, "").trim().slice(0, 2000);
}
