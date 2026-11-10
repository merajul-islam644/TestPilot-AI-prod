// The run detail body, split out of RunDetailPage.tsx so the project
// page can embed it WITHOUT importing the route module — importing the
// route file here would cycle through app/router/routes (which imports
// this page back) and vite falls back to a full page reload on every
// HMR update of the cycle.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Link2 } from "lucide-react";
import { projectById, runTrigger, suiteById } from "../../lib/demo/data";
import type { CaseResult, Run } from "../../lib/demo/data";
import { cancelRun, subscribeRunnerProgress, runnerProgressSnapshot, useDemoState } from "../../lib/demo/store";
import type { RunnerRunProgress } from "../../lib/runner/client";
import { formatDateTime, formatDuration, formatMs } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { CaseError, CaseTree } from "../../shared/ui/CaseTree";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { RunStatusBadge, SimulatedBadge, StatusBadge } from "../../shared/ui/StatusBadge";
import { useWorkspaceInfo } from "../../shared/workspaceRegistry";
import { useWorkspaceBinding } from "../../shared/useWorkspaceBinding";
import { useSpecBlocks } from "../../lib/workspace/useSpecBlocks";
import { readSavedRoot } from "../workbench/data/useTestWorkspace";
import { RUN_STATUS_KEYS } from "./runColumns";

const BROWSER_KEYS: Record<Run["browser"], string> = { chromium: "Chromium", webkit: "WebKit", firefox: "Firefox" };

/** The run detail body, shared by the sidebar route and the project
 *  page's in-context drill-down (which passes its own back/open
 *  callbacks so nothing here can pull the user into a sidebar page). */
export function RunDetailView({ runId, onBack, onOpenIssue }: {
  runId: string;
  onBack: () => void;
  /** Open a linked issue — the project page swaps in its own drill-down. */
  onOpenIssue?: (issueId: string) => void;
}) {
  const { runs, issues, caseResults, activeRunnerRun } = useDemoState();
  const { t } = useT();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const run = runs.find((entry) => entry.id === runId);
  // Only persisted per-case rows render here — every run that executes
  // persists them. A row without cases (a legacy Simulated record from
  // before the simulator was removed) shows the honest empty state below.
  const cases = useMemo(
    () => caseResults.filter((entry) => entry.runId === run?.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [caseResults, run]
  );
  const linkedIssue = run ? issues.find((issue) => issue.runId === run.id) : undefined;
  const project = run ? projectById(run.projectId) : undefined;
  const suite = run ? suiteById(run.suiteId) : undefined;
  const isLive = run?.status === "running" || run?.status === "pending";
  // True when THIS record is the suite executing on the runner right now —
  // guards the heartbeat from leaking into a different running record.
  const isOwnedLive = isLive && !!run && activeRunnerRun?.runId === run.id;

  // Live heartbeat: which test and which test.step line are executing right
  // now. Seeded with the last snapshot so a view opened mid-run shows the
  // current state immediately, then follows the ~2 s poll.
  const [liveProgress, setLiveProgress] = useState<RunnerRunProgress | null>(() => runnerProgressSnapshot());
  useEffect(() => {
    if (!isOwnedLive) return;
    setLiveProgress(runnerProgressSnapshot());
    return subscribeRunnerProgress(setLiveProgress);
  }, [isOwnedLive]);

  // 1 s heartbeat so the executing block's elapsed time TICKS while it runs —
  // dots stream instantly already, but a static "Running…" gave no sense of
  // how long the block has been going. Mounted only while this view owns the
  // live run (no idle timers).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isOwnedLive) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isOwnedLive]);

  const liveNow = isOwnedLive ? liveProgress : null;
  const currentTestTitle = liveNow?.currentTest?.title ?? liveNow?.current ?? null;
  // The executing block's start: the runner's server-clock testBegin stamp
  // when the wire carries it (true elapsed even for a view opened mid-test),
  // else a local clock keyed on the test identity. Updating the ref during
  // render is the documented previous-value pattern — idempotent, so the
  // timer is correct on the very first render of a new block.
  const testStartRef = useRef<{ title: string | null; at: number }>({ title: null, at: 0 });
  if (currentTestTitle !== testStartRef.current.title) {
    testStartRef.current = {
      title: currentTestTitle,
      at: liveNow?.currentTest?.startedAt ?? Date.now()
    };
  }
  const runningElapsedMs = currentTestTitle != null && testStartRef.current.title === currentTestTitle
    ? Math.max(0, nowTick - testStartRef.current.at)
    : null;

  // Same identity tracking for the step executing INSIDE the running block —
  // its count-up seeds from the runner's stepBegin stamp when present, else
  // the local clock. Between steps (stepEnd → next stepBegin) there is no
  // current step, so the timer rests.
  const stepKey = currentTestTitle != null && liveNow?.currentStep?.line != null
    ? `${currentTestTitle}|${liveNow.currentStep.line}`
    : null;
  const stepStartRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  if (stepKey !== stepStartRef.current.key) {
    stepStartRef.current = {
      key: stepKey,
      at: liveNow?.currentStep?.startedAt ?? Date.now()
    };
  }
  const stepElapsedMs = stepKey != null && stepStartRef.current.key === stepKey
    ? Math.max(0, nowTick - stepStartRef.current.at)
    : null;

  // Per-block tree hydration: for runner runs whose results predate the
  // file/steps fields (or lost them to a reload), re-parse the linked
  // workspace's specs and attach cases by title. Legacy simulated runs
  // keep the flat table. A browser that never opened the folder falls back
  // to the gateway workspace binding — the runner serves the same disk to
  // every browser on the machine, so the live tree renders identically
  // there instead of collapsing to an empty flat table.
  const savedRoot = run ? readSavedRoot(run.projectId) : null;
  const localWorkspace = useWorkspaceInfo(run?.projectId ?? "");
  const binding = useWorkspaceBinding(run?.projectId ?? "", !localWorkspace);
  const workspace = localWorkspace ?? (binding?.root ? {
    root: binding.root,
    filesCount: binding.specPaths?.length ?? 0,
    specPaths: binding.specPaths ?? [],
    updatedAt: 0
  } : null);
  const isRunnerRun = run ? runTrigger(run) === "runner" : false;
  const runnerRoot = savedRoot?.mode === "runner"
    ? savedRoot.root
    : savedRoot
      ? null // a local FSA root can't be read here and must not fall back
      : binding?.mode === "runner" && binding.root ? binding.root : null;
  const specPaths = useMemo(
    () => (isRunnerRun ? workspace?.specPaths ?? [] : []),
    [isRunnerRun, workspace]
  );
  const blocks = useSpecBlocks(isRunnerRun ? runnerRoot : null, specPaths);

  if (!run) {
    return (
      <section>
        <button className="tertiary-button" onClick={onBack}><ArrowLeft size={16} /> {t("common.back")}</button>
        <EmptyState description={t("run.notFound")} title={t("common.error")} />
      </section>
    );
  }

  const statusKey = RUN_STATUS_KEYS[run.status];
  const terminal = run.status === "passed" || run.status === "failed";
  // An in-flight run streams results in: completed cases render as rows, the
  // rest stay skeletons — matching the progress bar above.
  const completedCount = run.status === "pending"
    ? 0
    : run.status === "running"
      ? Math.max(1, Math.min(cases.length, Math.round((cases.length * (run.progress ?? 0)) / 100)))
      : cases.length;
  const completedCases = cases.slice(0, completedCount);

  // While the suite runs, finished tests stream in through the heartbeat —
  // the tree flips each block's dot before the authoritative rows land with
  // the final report. Persisted rows win whenever they exist. error/steps
  // ride the heartbeat too, so a mid-run failure renders its red dot and
  // its error box under the failing step INSTANTLY, not after the report.
  const live = liveNow;
  const liveCases: CaseResult[] = (live?.cases ?? []).map((entry, index) => ({
    id: `${run.id}-live${index}`,
    name: entry.title,
    file: entry.file || undefined,
    status: entry.status,
    durationMs: entry.durationMs,
    error: entry.error,
    steps: entry.steps?.map((step) => ({
      title: step.title,
      depth: 0,
      durationMs: step.durationMs ?? 0,
      error: step.error ?? undefined
    })),
    runId: run.id,
    order: completedCases.length + index
  }));
  const treeCases = completedCases.length > 0 ? completedCases : liveCases;

  return (
    <section>
      {/* Compact title bar: back arrow + THE one heading (the run name) and
          start time on a single row; the cancel action sits at the right
          edge. The project page hides its own heading while this drill is
          open, so exactly one heading is visible. */}
      <div className="titlebar">
        <button aria-label={t("common.back")} className="tertiary-button" onClick={onBack} title={t("common.back")} type="button">
          <ArrowLeft size={16} />
        </button>
        <h2>{run.name}</h2>
        <span className="titlebar-meta">{formatDateTime(run.startedAt)}</span>
        {isLive ? (
          <div className="titlebar-actions">
            <button className="danger-button" onClick={() => setConfirmingCancel(true)}>{t("run.cancel")}</button>
          </div>
        ) : null}
      </div>

      <div className="chips" style={{ marginBottom: 14 }}>
        <RunStatusBadge label={t(statusKey)} status={run.status} />
        {runTrigger(run) === "simulated" ? <SimulatedBadge label={t("run.simulated")} title={t("run.simulatedHint")} /> : null}
        <span className="chip mono">{run.id}</span>
        <span className="chip">{project?.name ?? "—"}</span>
        <span className="chip">{suite?.name ?? "—"}</span>
        <span className="chip">{t(run.environment === "production" ? "env.production" : run.environment === "staging" ? "env.staging" : "env.sandbox")}</span>
        <span className="chip">{BROWSER_KEYS[run.browser]}</span>
        <span className="chip">{`${t("run.meta.triggeredBy")}: ${run.triggeredBy}`}</span>
      </div>

      {run.status === "running" ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="progress-row">
            <span className="muted">{t("run.progressLabel")}</span>
            <div className="progress-track" style={{ flex: 1 }}>
              <div className="progress-fill" style={{ width: `${run.progress ?? 0}%` }} />
            </div>
            <strong className="num" style={{ fontVariantNumeric: "tabular-nums" }}>{`${run.progress ?? 0}%`}</strong>
          </div>
        </div>
      ) : null}

      <div className="grid">
        <div className="metric"><span>{t("common.tests")}</span><strong className="num">{run.total > 0 ? run.total : "…"}</strong></div>
        <div className="metric"><span>{t("common.passed")}</span><strong className="num" style={{ color: "hsl(var(--success))" }}>{terminal || run.status === "running" ? run.passed : "…"}</strong></div>
        {/* Failed and Duration used to sit on "…" for the WHOLE run even
            though the heartbeat knew both — the failed counter rides every
            testEnd and the elapsed clock ticks off the run's startedAt, so
            both stream live now, then hand over to the final record. */}
        <div className="metric"><span>{t("common.failed")}</span><strong className="num" style={{ color: "hsl(var(--destructive))" }}>{terminal ? run.failed : liveNow ? liveNow.failed : "…"}</strong></div>
        <div className="metric"><span>{t("common.duration")}</span><strong>{run.durationSec > 0 ? formatDuration(run.durationSec) : liveNow ? formatDuration(Math.round((nowTick - liveNow.startedAt) / 1000)) : "…"}</strong></div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <h3 className="panel-title">{t("run.cases")}</h3>
          {linkedIssue && onOpenIssue ? (
            <button className="link-button" onClick={() => onOpenIssue(linkedIssue.id)}><Link2 size={14} /> {t("run.openIssue")}: {linkedIssue.id}</button>
          ) : null}
        </div>
        {cases.length === 0 && run.status !== "pending" && run.status !== "running" ? (
          <p className="muted" style={{ margin: 0 }}>{t("run.noCases")}</p>
        ) : !isLive && terminal ? (
          // Finished runs render as the block tree: the failure sits directly
          // under the block that failed (with its Open issue action) — there
          // is no separate Failures section repeating the same errors.
          <CaseTree
            cases={completedCases}
            files={blocks ?? null}
            onOpenIssue={linkedIssue && onOpenIssue ? () => onOpenIssue(linkedIssue.id) : undefined}
          />
        ) : blocks ? (
          // A live run renders the SAME tree, fed by the heartbeat: the
          // folder's blocks all show (Not run until reached), finished ones
          // flip as their tests end, and the executing block + step pulse.
          // Without a spec parse (folder closed) the flat table below stays.
          <CaseTree
            cases={treeCases}
            files={blocks}
            running={live
              ? {
                  // New runners report the structured currentTest (title +
                  // file). Older ones only carry the plain `current` title
                  // string — still enough to pulse the executing test row,
                  // just without file/step precision.
                  testTitle: currentTestTitle,
                  file: live.currentTest?.file,
                  stepLine: live.currentStep?.line ?? null,
                  // Live count-up on the executing block; null when idle.
                  elapsedMs: runningElapsedMs,
                  // Steps already closed inside the running test — the tree
                  // flips each one's dot/duration/error the moment it ends.
                  finishedSteps: live.currentTest?.steps,
                  stepElapsedMs
                }
              : undefined}
          />
        ) : (
          <DataTable
            columns={[
              { key: "case", header: t("run.caseColumn"), render: (entry) => <span className="mono">{entry.name}</span> },
              { key: "result", header: t("common.status"), render: (entry: CaseResult) => (
                <StatusBadge tone={entry.status === "failed" ? "failed" : entry.status === "skipped" ? "neutral" : "passed"}>
                  {t(entry.status === "passed" ? "status.passed" : entry.status === "failed" ? "status.failed" : "status.skipped")}
                </StatusBadge>
              ) },
              { align: "end", key: "duration", header: t("common.duration"), render: (entry) => formatMs(entry.durationMs) }
            ]}
            loading={run.status === "pending"}
            loadingRows={8}
            rows={treeCases.length > 0 ? treeCases : completedCases}
            tailLoadingRows={run.status === "running" ? Math.max(0, cases.length - completedCount) : 0}
          />
        )}
      </div>

      {terminal && run.failed === 0 ? <p className="muted">{t("run.noFailures")}</p> : null}

      {confirmingCancel ? (
        <ConfirmDialog
          confirmLabel={t("run.cancel")}
          message={t("run.cancelMessage")}
          onCancel={() => setConfirmingCancel(false)}
          onConfirm={() => {
            cancelRun(run.id);
            setConfirmingCancel(false);
          }}
          title={t("run.cancelTitle")}
        />
      ) : null}
    </section>
  );
}
