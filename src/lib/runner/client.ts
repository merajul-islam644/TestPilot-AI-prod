// HTTP client for the Playwright runner service (runner/server.mjs). The SPA
// cannot launch Chromium, so the Tests tab POSTs saved specs here; the runner
// materializes a throwaway Playwright project, executes it headlessly and
// returns a compact, app-shaped result set. The base URL is overridable for
// hosted deployments; the default is the local dev runner.

export type RunnerCase = {
  title: string;
  file: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  error?: string;
};

export type RunnerSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
};

export type RunnerResult = { ok: true; name?: string; summary: RunnerSummary; cases: RunnerCase[] };

/** Keep in sync with MAX_FILES in runner/server.mjs; the UI caps the run set at this. */
export const RUNNER_MAX_FILES = 20;

const RUNNER_URL = import.meta.env.VITE_RUNNER_URL ?? "http://localhost:9090";

/** A Playwright run legitimately takes minutes; give the fetch a long leash. */
const RUN_TIMEOUT_MS = 180_000;

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

export async function runSpecsOnRunner(input: { name: string; baseURL: string; files: { name: string; content: string }[] }): Promise<RunnerResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  try {
    const response = await fetch(`${RUNNER_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: input.name, baseURL: input.baseURL, files: input.files }),
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
