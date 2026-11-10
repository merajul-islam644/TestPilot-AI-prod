// The per-block results tree — the app's answer to "show me every block in
// my spec files, and what each did when it ran". Three surfaces share it:
// the workbench Results tab (run outcome), the run detail page (history,
// re-hydrated against the spec parse), and the suite detail page (static
// blocks + the latest run's results attached).
//
// Two sources combine into one tree:
//   • `files` — the STATIC spec parse (describe → test → step, with lines);
//     blocks with no matching case render as "Not run".
//   • `cases` — the RUN data; matched onto blocks by file + title, steps by
//     title in order. Cases with no static block still render (the spec
//     changed since the run).

import { useMemo } from "react";
import { CircleCheck, CircleX, FileCode2 } from "lucide-react";
import type { CaseResult, CaseStatus } from "../../lib/demo/data";
import type { SpecTestBlock } from "../../lib/workspace/specBlocks";
import { formatMs } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";

type RowStatus = CaseStatus | "notrun";

type TreeStep = {
  key: string;
  title: string;
  depth: number;
  /** Static parse's declaration line — the live heartbeat's current step
   *  reports the same line, which is how the running step lights up. */
  line?: number;
  status: RowStatus;
  durationMs?: number;
  error?: string;
};

type TreeTest = {
  key: string;
  title: string;
  describeChain: string[];
  status: RowStatus;
  durationMs?: number;
  error?: string;
  steps: TreeStep[];
};

type TreeFile = { file: string; tests: TreeTest[] };

/** Merge static blocks + run cases into the render tree. Pure. */
function buildTree(files: { file: string; tests: SpecTestBlock[] }[] | null, cases: CaseResult[]): TreeFile[] {
  const pool = [...cases];
  const take = (file: string | undefined, title: string): CaseResult | undefined => {
    let index = pool.findIndex((entry) => entry.name === title && (entry.file ? entry.file === file : true));
    if (index < 0) index = pool.findIndex((entry) => entry.name === title);
    if (index < 0) return undefined;
    return pool.splice(index, 1)[0];
  };

  const out: TreeFile[] = [];
  const pushCaseSteps = (test: TreeTest, steps: NonNullable<CaseResult["steps"]>) => {
    const pending = [...steps];
    for (const step of test.steps) {
      const index = pending.findIndex((entry) => entry.title === step.title);
      if (index < 0) continue;
      const match = pending.splice(index, 1)[0];
      if (!match) continue;
      step.status = match.error ? "failed" : "passed";
      step.durationMs = match.durationMs;
      step.error = match.error;
    }
    // Steps the run recorded but the parse no longer knows: keep them
    // visible so results are never silently dropped.
    for (const step of pending) {
      test.steps.push({
        key: `${test.key}-x${test.steps.length}`,
        title: step.title,
        depth: step.depth,
        status: step.error ? "failed" : "passed",
        durationMs: step.durationMs,
        error: step.error
      });
    }
  };

  if (files) {
    for (const group of files) {
      const tests: TreeTest[] = group.tests.map((block, blockIndex) => {
        const matched = take(group.file, block.title);
        const test: TreeTest = {
          key: `${group.file}:${blockIndex}`,
          title: block.title,
          describeChain: block.describeChain,
          status: matched ? matched.status : "notrun",
          durationMs: matched?.durationMs,
          error: matched?.error,
          steps: block.steps.map((step, stepIndex) => ({
            key: `${group.file}:${blockIndex}:${stepIndex}`,
            title: step.title,
            depth: step.depth,
            line: step.line,
            status: "notrun"
          }))
        };
        if (matched?.steps) pushCaseSteps(test, matched.steps);
        return test;
      });
      // Cases left over whose file matches this group but whose block is
      // gone from the current spec — append so history stays complete.
      let extra = 0;
      for (let index = pool.length - 1; index >= 0; index--) {
        const entry = pool[index];
        if (!entry || entry.file !== group.file) continue;
        pool.splice(index, 1);
        tests.unshift({
          key: `${group.file}:extra${extra++}`,
          title: entry.name,
          describeChain: [],
          status: entry.status,
          durationMs: entry.durationMs,
          error: entry.error,
          steps: (entry.steps ?? []).map((step, stepIndex) => ({
            key: `${group.file}:extra${extra}:${stepIndex}`,
            title: step.title,
            depth: step.depth,
            status: step.error ? "failed" : "passed",
            durationMs: step.durationMs,
            error: step.error
          }))
        });
      }
      out.push({ file: group.file, tests });
    }
    // Stragglers pointing at files the workspace no longer has.
    const orphans = pool.splice(0, pool.length);
    if (orphans.length > 0) {
      const byFile = new Map<string, TreeTest[]>();
      for (const entry of orphans) {
        const file = entry.file ?? "";
        const list = byFile.get(file) ?? [];
        list.push({
          key: `orphan:${file}:${list.length}`,
          title: entry.name,
          describeChain: [],
          status: entry.status,
          durationMs: entry.durationMs,
          error: entry.error,
          steps: (entry.steps ?? []).map((step, stepIndex) => ({
            key: `orphan:${file}:${list.length}:${stepIndex}`,
            title: step.title,
            depth: step.depth,
            status: step.error ? "failed" : "passed",
            durationMs: step.durationMs,
            error: step.error
          }))
        });
        byFile.set(file, list);
      }
      for (const [file, tests] of byFile) out.push({ file, tests });
    }
    return out;
  }

  // No parse available: group the run's cases by file directly.
  const byFile = new Map<string, CaseResult[]>();
  for (const entry of cases) {
    const file = entry.file ?? "";
    const list = byFile.get(file) ?? [];
    list.push(entry);
    byFile.set(file, list);
  }
  return [...byFile.entries()].map(([file, group]) => ({
    file,
    tests: group.map((entry, index) => ({
      key: `${file}:${index}`,
      title: entry.name,
      describeChain: [],
      status: entry.status,
      durationMs: entry.durationMs,
      error: entry.error,
      steps: (entry.steps ?? []).map((step, stepIndex) => ({
        key: `${file}:${index}:${stepIndex}`,
        title: step.title,
        depth: step.depth,
        status: step.error ? "failed" : "passed",
        durationMs: step.durationMs,
        error: step.error
      }))
    }))
  }));
}

function statusClass(status: RowStatus): string {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  return "notrun";
}

/** Lines of a Playwright failure that carry the actual diagnosis —
 *  highlight them so the stack noise around them still scans. */
const DIAGNOSTIC_LINE_RE = /^(Error\b|Locator:|Expected\b|Received\b|Test timeout|Timeout:|Retry:|Call log:)/;

/**
 * A readable failure block: brighter than the old inherited pre colors
 * (which rendered dark-on-dark here), a wider excerpt so Locator/Expected/
 * Received survive the cut, and the diagnostic lines accented.
 */
export function CaseError({ text }: { text: string }) {
  const clipped = text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
  return (
    <pre className="case-err">
      {clipped.split("\n").map((line, index) => (
        <span className={DIAGNOSTIC_LINE_RE.test(line.trimStart()) ? "case-err-label" : undefined} key={index}>
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

export function CaseTree({ cases, files, onOpenIssue, running }: {
  /** The static spec parse, when the workspace is readable. null = group
   *  the cases alone (run data only). */
  files?: { file: string; tests: SpecTestBlock[] }[] | null;
  cases: CaseResult[];
  /** Present when this run has a linked issue: rendered under each failed
   *  step's error (or a failed test without step errors), so the failure
   *  and its triage path sit exactly where it happened. */
  onOpenIssue?: () => void;
  /** Live heartbeat from the runner: which test (and which test.step line
   *  inside it) is executing right now. Blocks not yet reached render as
   *  "Not run"; the running one pulses until its result lands. */
  running?: {
    testTitle?: string | null;
    file?: string;
    stepLine?: number | null;
    elapsedMs?: number | null;
    /** Steps the runner already closed inside the running test (stepEnd wire payload). */
    finishedSteps?: { title: string; line?: number; durationMs?: number; error?: string | null }[];
    /** Live count-up for the step executing right now. */
    stepElapsedMs?: number | null;
  };
}) {
  const { t } = useT();
  const tree = useMemo(() => buildTree(files ?? null, cases), [files, cases]);
  return (
    <div className="case-tree">
      {tree.map((group) => {
        const passed = group.tests.filter((test) => test.status === "passed").length;
        const failed = group.tests.filter((test) => test.status === "failed").length;
        return (
          <div className="case-file" key={group.file}>
            <div className="case-file-head">
              <FileCode2 size={13} aria-hidden />
              <span className="mono">{group.file || t("run.cases")}</span>
              {/* A count that has reached something renders as its colored
                  badge with the ✓ / ✗ mark; a zero count stays muted text —
                  an empty group never advertises a state it has not hit. */}
              <span className="case-file-counts">
                {passed > 0 ? (
                  <span className="badge badge-passed">
                    <CircleCheck size={13} />
                    {passed} {t("status.passed").toLowerCase()}
                  </span>
                ) : (
                  <span className="muted">{passed} {t("status.passed").toLowerCase()}</span>
                )}
                <span className="muted">·</span>
                {failed > 0 ? (
                  <span className="badge badge-failed">
                    <CircleX size={13} />
                    {failed} {t("status.failed").toLowerCase()}
                  </span>
                ) : (
                  <span className="muted">{failed} {t("status.failed").toLowerCase()}</span>
                )}
              </span>
            </div>
            {group.tests.map((test) => {
              // The runner's current test lights up here — matched by title
              // and file (same keys the result matcher uses), and only while
              // no result has landed for it yet (testEnd flips the dot).
              const testRunning = !!running?.testTitle
                && test.status === "notrun"
                && test.title === running.testTitle
                && (!running.file || running.file === group.file);
              return (
                <div className="case-test" key={test.key}>
                  <div
                    className={`case-row${test.status === "failed" ? " has-error" : ""}${testRunning ? " is-running" : ""}`}
                    title={test.describeChain.length > 0 ? `${test.describeChain.join(" › ")} › ${test.title}` : test.title}
                  >
                    {/* ✓ / ✗ marks instead of bare dots — the state reads
                        without color and matches the file-head badges. */}
                    {test.status === "passed" ? (
                      <CircleCheck className="case-ico passed" size={15} aria-hidden />
                    ) : test.status === "failed" ? (
                      <CircleX className="case-ico failed" size={15} aria-hidden />
                    ) : (
                      <span className={`case-dot ${testRunning ? "running" : statusClass(test.status)}`} aria-hidden />
                    )}
                    <span className="case-title">{test.title}</span>
                    <span className="case-dur">
                      {testRunning
                        ? running?.elapsedMs != null
                          ? `${t("run.runningNow")} · ${formatMs(running.elapsedMs)}`
                          : t("run.runningNow")
                        : test.status === "notrun" ? t("run.notRun") : formatMs(test.durationMs ?? 0)}
                    </span>
                  </div>
                  {test.status === "failed" && test.error && !test.steps.some((step) => step.status === "failed" && step.error) ? (
                    <>
                      <CaseError text={test.error} />
                      {onOpenIssue ? (
                        <button className="link-button case-issue-link" onClick={onOpenIssue} type="button">{t("run.openIssue")}</button>
                      ) : null}
                    </>
                  ) : null}
                  {test.steps.map((step) => {
                    const indent = 26 + step.depth * 16;
                    // A step the runner already closed inside this running
                    // test shows its real dot/duration/error instantly (the
                    // stepEnd wire payload) — line is the join key, title
                    // the fallback when a payload carries no line.
                    const liveStep = testRunning
                      ? running?.finishedSteps?.find((s) =>
                          (s.line != null && s.line === step.line)
                          || (s.line == null && s.title === step.title))
                      : undefined;
                    const stepRunning = !liveStep
                      && testRunning
                      && running?.stepLine != null
                      && step.line === running.stepLine;
                    const stepError = liveStep?.error ?? step.error;
                    const stepFailed = step.status === "failed" || !!liveStep?.error;
                    return (
                      <div key={step.key}>
                        <div
                          className={`case-row case-step${stepFailed ? " has-error" : ""}${stepRunning ? " now-running" : ""}`}
                          style={{ paddingLeft: indent }}
                          title={stepError ?? step.title}
                        >
                          {stepFailed ? (
                            <CircleX className="case-ico failed" size={13} aria-hidden />
                          ) : step.status === "passed" || (liveStep && !liveStep.error) ? (
                            <CircleCheck className="case-ico passed" size={13} aria-hidden />
                          ) : (
                            <span className={`case-dot sm ${stepRunning ? "running" : statusClass(step.status)}`} aria-hidden />
                          )}
                          <span className="case-title">{step.title}</span>
                          <span className="case-dur">
                            {stepRunning
                              ? running?.stepElapsedMs != null
                                ? `${t("run.runningNow")} · ${formatMs(running.stepElapsedMs)}`
                                : t("run.runningNow")
                              : liveStep
                                ? formatMs(liveStep.durationMs ?? 0)
                                : step.status === "notrun" ? t("run.notRun") : formatMs(step.durationMs ?? 0)}
                          </span>
                        </div>
                        {stepFailed && stepError ? (
                          <div style={{ marginLeft: indent }}>
                            <CaseError text={stepError} />
                            {onOpenIssue ? (
                              <button className="link-button case-issue-link" onClick={onOpenIssue} type="button">{t("run.openIssue")}</button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {group.tests.length === 0 ? <p className="muted case-file-empty">{t("run.noCases")}</p> : null}
          </div>
        );
      })}
      {tree.length === 0 ? <p className="muted case-file-empty">{t("run.noCases")}</p> : null}
    </div>
  );
}
