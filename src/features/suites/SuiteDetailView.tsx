// The suite detail body, split out of SuiteDetailPage.tsx so the project
// page can embed it WITHOUT importing the route module — the route file
// pulls in app/router/routes, which imports the project page back and
// makes the module graph circular (vite then full-reloads on every HMR
// update inside the cycle).
import { useMemo } from "react";
import { ArrowLeft, FileCode2 } from "lucide-react";
import { PLAYWRIGHT_SUITE_ID_PREFIX, derivedSuiteForProject, projectById, runTrigger, suiteById } from "../../lib/demo/data";
import { useDemoState } from "../../lib/demo/store";
import { formatDate, formatRelative } from "../../lib/format";
import type { SpecTestBlock } from "../../lib/workspace/specBlocks";
import { useSpecBlocks } from "../../lib/workspace/useSpecBlocks";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Breadcrumb } from "../../shared/ui/Breadcrumb";
import { CaseTree } from "../../shared/ui/CaseTree";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { SuiteStatusBadge } from "../../shared/ui/StatusBadge";
import { getWorkspaceInfo, useWorkspaceInfo } from "../../shared/workspaceRegistry";
import { readSavedRoot } from "../workbench/data/useTestWorkspace";
import { useRunColumns } from "../runs/runColumns";

/** The suite detail body, shared by the sidebar route and the project
 *  page's in-context drill-down. */
export function SuiteDetailView({ contentOnly = false, suiteId, onBack, onOpenRun }: {
  /** Content-only mode (the Test suites page): show what the suite
   *  CONTAINS — files, tests, steps — with no run history and no pass /
   *  fail marks anywhere. */
  contentOnly?: boolean;
  suiteId: string;
  onBack: () => void;
  /** Open a run — the project page swaps in its own drill-down. */
  onOpenRun: (runId: string) => void;
}) {
  const { runs, caseResults } = useDemoState();
  const { t } = useT();
  const runColumns = useRunColumns((run) => onOpenRun(run.id));

  // For derived ids the workspace registry is the truth (fresher than the
  // stored row, and it carries the spec list); fall back to the stored
  // record so historic runs' suites still open. The subscription makes the
  // view track folder open/close for derived ids.
  const derivedProjectId = suiteId.startsWith(PLAYWRIGHT_SUITE_ID_PREFIX) ? suiteId.slice(PLAYWRIGHT_SUITE_ID_PREFIX.length) : null;
  useWorkspaceInfo(derivedProjectId ?? "");
  const derived = derivedProjectId ? derivedSuiteForProject(derivedProjectId) : null;
  const specPaths = derived && derivedProjectId ? getWorkspaceInfo(derivedProjectId)?.specPaths ?? [] : [];
  const suite = derived ?? suiteById(suiteId);
  const suiteRuns = useMemo(() => runs.filter((run) => run.suiteId === suiteId), [suiteId, runs]);

  // The block list: parse every spec of the (runner-mode) workspace and
  // attach the latest finished runner run's per-case/per-step results.
  // Files unreadable (runner offline, FSA workspace) fall back to the
  // plain path list below.
  const savedRoot = derivedProjectId ? readSavedRoot(derivedProjectId) : null;
  const runnerRoot = savedRoot?.mode === "runner" ? savedRoot.root : null;
  const blocks = useSpecBlocks(runnerRoot, specPaths);
  const latestRunnerRun = useMemo(
    () => suiteRuns
      .filter((run) => runTrigger(run) === "runner" && (run.status === "passed" || run.status === "failed"))
      .sort((a, b) => b.startedAt - a.startedAt)[0],
    [suiteRuns]
  );
  const latestCases = useMemo(
    () => (latestRunnerRun ? caseResults.filter((entry) => entry.runId === latestRunnerRun.id) : []),
    [caseResults, latestRunnerRun]
  );

  if (!suite) {
    return (
      <section>
        <button className="tertiary-button" onClick={onBack}><ArrowLeft size={16} /> {t("common.back")}</button>
        <EmptyState description={t("suites.notFound")} title={t("common.error")} />
      </section>
    );
  }

  const project = projectById(suite.projectId);

  return (
    <section>
      {contentOnly ? (
        /* Content-only mode presents the page as the PROJECT: the trail is
           Test suites › <project>, its name is the last crumb — so no back
           arrow or repeated heading is needed. The first crumb walks back
           to the global suites list in one click. */
        <Breadcrumb
          items={[
            { label: t("nav.suites"), onClick: onBack },
            { label: project?.name ?? suite.name }
          ]}
        />
      ) : (
        /* Compact title bar: back arrow, suite name and its description on
            ONE row — same pattern as the project page's titlebar. The
            project page's drill-down keeps it: its back button IS the way
            out of the in-context view. */
        <div className="titlebar">
          <button aria-label={t("common.back")} className="tertiary-button" onClick={onBack} title={t("common.back")} type="button">
            <ArrowLeft size={16} />
          </button>
          <h2>{suite.name}</h2>
          <span className="titlebar-meta">{suite.description}</span>
        </div>
      )}

      <div className="chips" style={{ marginBottom: 16 }}>
        <SuiteStatusBadge
          label={t(suite.status === "active" ? "suite.active" : suite.status === "draft" ? "suite.draft" : "suite.archived")}
          status={suite.status}
        />
        {!contentOnly ? <span className="chip">{project?.name ?? "—"}</span> : null}
        <span className="chip">{`${t("common.owner")}: ${suite.owner}`}</span>
        <span className="chip">{`${t("suite.lastUpdated")}: ${formatDate(suite.lastUpdatedAt)}`}</span>
      </div>

      {specPaths.length > 0 ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head">
            <h3 className="panel-title">{t("suite.specs")}</h3>
            {!contentOnly && latestRunnerRun ? (
              <button className="link-button" onClick={() => onOpenRun(latestRunnerRun.id)}>
                {t("suite.latestRun")}: {formatRelative(latestRunnerRun.startedAt)}
              </button>
            ) : null}
          </div>
          {blocks !== null && blocks.length > 0 ? (
            contentOnly ? (
              /* The same parse presented project-based: ONE group headed by
                 the project's name, every test of every spec flattened
                 beneath — no spec file paths, no status marks of any kind. */
              <PlainSpecTree blocks={blocks} projectName={project?.name ?? suite.name} />
            ) : (
              /* Every test + test.step block of every spec, in file order —
                 with the latest run's status/duration beside matched blocks
                 and "Not run" beside the rest. */
              <CaseTree cases={latestCases} files={blocks} />
            )
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              {specPaths.map((path) => (
                <span className="mono" key={path} style={{ fontSize: 12.5 }}>{path}</span>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!contentOnly ? (
        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">{t("suite.recentRuns")}</h3>
          </div>
          {suiteRuns.length > 0 ? (
            <DataTable columns={runColumns} fixed onRowClick={(run) => onOpenRun(run.id)} rows={suiteRuns.slice(0, 10)} />
          ) : (
            <p className="muted">{t("suite.noRuns")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** The spec parse presented PROJECT-based, as the Test suites page asks:
 *  ONE group headed by the project's name (plus its total test count),
 *  with every test of every spec flattened beneath it — no spec file
 *  paths anywhere. Steps keep their indented titles, and describe/step
 *  chains stay on hover. No status icons, durations or pass/fail of any
 *  kind — that is CaseTree's job on the run views. */
function PlainSpecTree({ blocks, projectName }: { blocks: { file: string; tests: SpecTestBlock[] }[]; projectName: string }) {
  const { t } = useT();
  const tests = blocks.flatMap((group) => group.tests);
  return (
    <div className="case-tree">
      <div className="case-file">
        <div className="case-file-head">
          <FileCode2 size={13} aria-hidden />
          <span>{projectName}</span>
          <span className="muted">{`${tests.length} ${t("common.tests")}`}</span>
        </div>
        {tests.map((test, index) => (
          <div className="case-test" key={`test-${index}`}>
            <div
              className="case-row"
              title={test.describeChain.length > 0 ? `${test.describeChain.join(" › ")} › ${test.title}` : test.title}
            >
              <span className="case-title">{test.title}</span>
            </div>
            {test.steps.map((step, stepIndex) => (
              <div
                className="case-row case-step"
                key={`test-${index}:${stepIndex}`}
                style={{ paddingLeft: 26 + step.depth * 16 }}
                title={step.title}
              >
                <span className="case-title">{step.title}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
