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

/** The workspace's own base URL — the E2E_BASE_URL its .env files set, as
 *  the runner would resolve it for /run (env wins over the manual value
 *  there). null when the runner is unreachable or the workspace sets none. */
export async function fetchRunnerEnvBaseURL(root: string): Promise<string | null> {
  try {
    const response = await fetch(`${RUNNER_URL}/env?root=${encodeURIComponent(root)}`, { signal: AbortSignal.timeout(4_000) });
    const body = (await response.json().catch(() => null)) as { baseURL?: string | null } | null;
    return typeof body?.baseURL === "string" && body.baseURL ? body.baseURL : null;
  } catch {
    return null;
  }
}

// --- Published batch queue (shared across this machine's browsers) --------
// The Overview batch owner publishes every queue transition to the runner;
// other browsers poll it to render the same cards. Every call is
// best-effort: an unreachable runner — or an older one without /batch —
// simply resolves to null / a swallowed error, and the local view wins.

export type RunnerBatchCardState = "queued" | "running" | "passed" | "failed" | "cancelled";
export type RunnerBatchCard = { state: RunnerBatchCardState; detail?: string; at?: number };

/** The queue document a batch-owning browser publishes to the runner. */
export type RunnerBatch = {
  /** When the batch started — cards only show finished runs from here on,
   *  and a browser picks whichever batch (own vs published) is newer. */
  startedAt: number;
  /** Progress badge payload; null once the queue finished (settled cards
   *  remain worth showing, so the document itself stays alive). */
  queue: { done: number; current: string; total: number } | null;
  /** The queued folders in dispatch order (key = normalized folder root —
   *  the same string every browser's probe produces for the same disk). */
  projects: { key: string; label: string; leadId: string }[];
  /** Per-folder card state, keyed like projects[].key. */
  states: Record<string, RunnerBatchCard>;
  /** Set by POST /batch/stop — the owning loop ends the queue after the
   *  in-flight project when it sees this. */
  stopRequested?: boolean;
  /** Folder roots a viewer ✕-ed out of the queue (POST /batch/skip) —
   *  the owning loop drops them like its own local skips. */
  skipped?: string[];
};

const BATCH_CARD_STATES: RunnerBatchCardState[] = ["queued", "running", "passed", "failed", "cancelled"];

/** Loose validation of a runner's /batch answer — anything malformed
 *  degrades to null, never throws into the caller's view. */
function asRunnerBatch(body: unknown): RunnerBatch | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { batch?: unknown }).batch;
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  if (typeof doc.startedAt !== "number" || !Array.isArray(doc.projects) || !doc.states || typeof doc.states !== "object") return null;
  const states: Record<string, RunnerBatchCard> = {};
  for (const [key, value] of Object.entries(doc.states as Record<string, unknown>)) {
    const state = (value ?? {}) as { state?: unknown; detail?: unknown; at?: unknown };
    if (typeof state.state !== "string" || !BATCH_CARD_STATES.includes(state.state as RunnerBatchCardState)) continue;
    states[key] = {
      state: state.state as RunnerBatchCardState,
      ...(typeof state.detail === "string" && state.detail ? { detail: state.detail } : {}),
      ...(typeof state.at === "number" ? { at: state.at } : {})
    };
  }
  const queueRaw = doc.queue as Record<string, unknown> | null;
  return {
    startedAt: doc.startedAt,
    queue: queueRaw && typeof queueRaw === "object"
      ? { done: Number(queueRaw.done) || 0, current: String(queueRaw.current ?? ""), total: Number(queueRaw.total) || 0 }
      : null,
    projects: (doc.projects as unknown[]).map((entry) => {
      const project = (entry ?? {}) as Record<string, unknown>;
      return { key: String(project.key ?? ""), label: String(project.label ?? ""), leadId: String(project.leadId ?? "") };
    }).filter((project) => project.key !== ""),
    states,
    stopRequested: doc.stopRequested === true,
    skipped: Array.isArray(doc.skipped)
      ? (doc.skipped as unknown[]).filter((key): key is string => typeof key === "string")
      : []
  };
}

/** The batch another browser published (null when none, stale or the
 *  runner predates /batch). */
export async function fetchRunnerBatch(): Promise<RunnerBatch | null> {
  try {
    const response = await fetch(`${RUNNER_URL}/batch`, { signal: AbortSignal.timeout(4_000) });
    return asRunnerBatch(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

/** Owner-side publish of the whole queue document. */
export async function putRunnerBatch(batch: RunnerBatch): Promise<void> {
  const response = await fetch(`${RUNNER_URL}/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(4_000)
  });
  if (!response.ok) throw new Error(`batch publish failed (${response.status})`);
}

/** Drop the published document (owner's batch content emptied). */
export async function clearRunnerBatch(): Promise<void> {
  await fetch(`${RUNNER_URL}/batch/clear`, { method: "POST", signal: AbortSignal.timeout(4_000) }).catch(() => undefined);
}

/** A viewer's stop request — the owning loop ends the queue after the
 *  in-flight project when it re-reads the document. */
export async function stopRunnerBatch(): Promise<void> {
  await fetch(`${RUNNER_URL}/batch/stop`, { method: "POST", signal: AbortSignal.timeout(4_000) }).catch(() => undefined);
}

/** A viewer ✕-ed a queued folder out of the queue — the owning loop drops
 *  it when it reaches that candidate. */
export async function skipRunnerBatch(key: string): Promise<void> {
  await fetch(`${RUNNER_URL}/batch/skip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
    signal: AbortSignal.timeout(4_000)
  }).catch(() => undefined);
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
