import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CaseResult, Run } from "../../lib/demo/data";
import type { RunnerRunProgress } from "../../lib/runner/client";
import { runnerProgressSnapshot, subscribeRunnerProgress, useActiveRunnerRun } from "../../lib/demo/store";
import { useSpecBlocks } from "../../lib/workspace/useSpecBlocks";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { CaseTree } from "../../shared/ui/CaseTree";
import { useWorkspaceInfo } from "../../shared/workspaceRegistry";
import { useWorkspaceBinding } from "../../shared/useWorkspaceBinding";
import { readSavedRoot } from "../workbench/data/useTestWorkspace";
import type { Column } from "../../shared/ui/DataTable";

/** One run row + its fold-open case tree, shared by the Test runs board and
 *  the project page's runs tab. When THIS run is the browser's active runner
 *  run, the fold shows the SAME spec tree the Test Suites tab previews —
 *  hydrated by the ~2 s /status heartbeat: unreached blocks stay "Not run",
 *  the executing block and step pulse, finished tests flip their dots the
 *  moment they end (errors and steps ride the heartbeat too). The
 *  authoritative case rows persisted at suite end take over once the run
 *  reaches a terminal status. Hooks live here — per row — because liveness,
 *  workspace binding and spec parse all vary per run. */
export function RunInlineRow({ run, inlineColumns, cases, open, onToggle }: {
  run: Run;
  inlineColumns: Column<Run>[];
  cases: CaseResult[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useT();
  const activeRunnerRun = useActiveRunnerRun();
  const isLive = activeRunnerRun?.runId === run.id && (run.status === "running" || run.status === "pending");

  // Heartbeat subscription only while this row is the live one. The snapshot
  // seed means a fold opened mid-run paints the last known state instead of
  // waiting out the next ~2 s poll.
  const [progress, setProgress] = useState<RunnerRunProgress | null>(null);
  useEffect(() => {
    if (!isLive) return;
    setProgress(runnerProgressSnapshot());
    return subscribeRunnerProgress((next) => setProgress(next));
  }, [isLive]);

  // Same workspace plumbing as the suites rows (local registry first, gateway
  // binding fallback): the spec parse is what the live tree hydrates against.
  const localWorkspace = useWorkspaceInfo(run.projectId);
  const binding = useWorkspaceBinding(run.projectId, !localWorkspace);
  const workspace = localWorkspace ?? (binding?.root ? {
    root: binding.root,
    filesCount: binding.specPaths?.length ?? 0,
    specPaths: binding.specPaths ?? [],
    updatedAt: 0
  } : null);
  const savedRoot = readSavedRoot(run.projectId);
  const runnerRoot = savedRoot?.mode === "runner"
    ? savedRoot.root
    : savedRoot
      ? null // a local FSA root can't be read here and must not fall back
      : binding?.mode === "runner" && binding.root ? binding.root : null;
  const specPaths = workspace?.specPaths ?? [];
  const blocks = useSpecBlocks(runnerRoot, specPaths, run.projectId);

  // Finished tests streamed in by the heartbeat, shaped as case rows — the
  // tree merges them into the block parse by title+file, and the running
  // prop lights the executing test and step between landings.
  const liveCases: CaseResult[] = isLive ? (progress?.cases ?? []).map((entry, index) => ({
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
    order: index
  })) : [];

  return (
    <div className="runs-inline-item">
      <button
        aria-expanded={open}
        className={`runs-inline-row runs-inline-run${open ? " open" : ""}`}
        onClick={onToggle}
        type="button"
      >
        {inlineColumns.map((col) => (
          <span
            className={`${col.align === "end" ? "cell-end" : ""}${col.className ? ` ${col.className}` : ""}`}
            key={col.key}
            style={col.width ? { flex: "none", width: col.width } : undefined}
          >
            {col.render(run)}
          </span>
        ))}
        <ChevronDown className="case-file-chevron" size={15} aria-hidden />
      </button>
      <div className={`run-inline-body${open ? " open" : ""}`}>
        <div className="run-inline-body-inner">
          {isLive ? (
            blocks ? (
              <CaseTree
                cases={liveCases}
                files={blocks}
                running={{
                  testTitle: progress?.currentTest?.title ?? null,
                  file: progress?.currentTest?.file,
                  stepLine: progress?.currentStep?.line ?? null,
                  elapsedMs: progress?.currentTest?.startedAt ? Date.now() - progress.currentTest.startedAt : null,
                  finishedSteps: progress?.currentTest?.steps,
                  stepElapsedMs: progress?.currentStep?.startedAt ? Date.now() - progress.currentStep.startedAt : null
                }}
              />
            ) : liveCases.length > 0 ? (
              /* No spec parse (folder unreadable in this browser): the
                 finished tests still stream as a flat list — never an
                 empty live fold. */
              <CaseTree cases={liveCases} />
            ) : (
              <p className="muted" style={{ margin: 0, padding: "8px 14px" }}>{t("status.running")}…</p>
            )
          ) : cases.length > 0 ? (
            <CaseTree cases={cases} />
          ) : (
            <p className="muted" style={{ margin: 0, padding: "8px 14px" }}>{t("run.noCases")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
