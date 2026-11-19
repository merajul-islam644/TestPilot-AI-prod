import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, CircleCheck, CircleX, FileCode2, Gauge, ListChecks, Rocket } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { buildDailyActivity, buildPassRateTrend, buildProjectStats, computeKpis, projectById, projects, runTrigger } from "../../lib/demo/data";
import type { DayActivity, Run } from "../../lib/demo/data";
import { formatCompact, formatNumber, formatPercent, formatRelative, healthDotClass, healthFromRate } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useDemoState } from "../../lib/demo/store";
import { ChartCard, ChartLegend } from "../../shared/charts/ChartCard";
import { StackedColumns } from "../../shared/charts/StackedColumns";
import { DataTable } from "../../shared/ui/DataTable";
import type { Column } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { KpiCard } from "../../shared/ui/KpiCard";
import type { KpiDelta } from "../../shared/ui/KpiCard";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";
import { BootstrapModal } from "../suites/BootstrapModal";
import { ProjectIcon } from "../projects/ProjectIcon";
import { useRunStatsColumns } from "../runs/runColumns";
import { RunInlineRow } from "../runs/RunInlineRow";
import { GlobalBranchSwitcher } from "./GlobalBranchSwitcher";

type Range = "7" | "14" | "30";

/* The Recent test runs panel's scope: the Overview's widest range (30 days),
   at most 5 runs per project — anything older or longer lives on the Test
   runs board, so this panel never grows unbounded. */
const RECENT_WINDOW_DAYS = 30;
const RECENT_MAX_PER_PROJECT = 5;

function deltaInfo(value: number, goodWhenUp: boolean, suffix: string): KpiDelta {
  return {
    direction: value > 0.05 ? "up" : value < -0.05 ? "down" : "flat",
    goodWhenUp,
    text: `${Math.abs(value).toFixed(1)}${suffix}`
  };
}

export function OverviewPage() {
  const { runs, caseResults } = useDemoState();
  const { navigate } = useRoute();
  const { t } = useT();
  const [range, setRange] = useState<Range>("30");
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  // Recent test runs: one project folded at a time — same rows as the Test
  // runs board; clicking a run unfolds its case tree INLINE (no navigation,
  // no sidebar selection change).
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const days = Number(range);

  // KPIs count each project ONCE — its latest run. Summing every run's
  // totals kept re-counting the same testcases per execution ("10 tests run
  // 3 times" read as 30). Latest-run-per-project = the current state of all
  // projects. Deltas stay out: a previous-period comparison doesn't apply
  // to a latest-run snapshot.
  const kpis = useMemo(() => {
    const latestByProject = new Map<string, Run>();
    for (const run of runs) {
      const existing = latestByProject.get(run.projectId);
      if (!existing || run.startedAt > existing.startedAt) latestByProject.set(run.projectId, run);
    }
    const latest = [...latestByProject.values()];
    const total = latest.reduce((sum, run) => sum + run.total, 0);
    const passed = latest.reduce((sum, run) => sum + run.passed, 0);
    const failed = latest.reduce((sum, run) => sum + run.failed, 0);
    return {
      totalTests: total,
      passedTests: passed,
      failedTests: failed,
      successRate: total > 0 ? (passed / total) * 100 : 0
    };
  }, [runs]);
  const activity = useMemo(() => buildDailyActivity(runs, days), [runs, days]);
  const rateTrend = useMemo(() => buildPassRateTrend(runs, days), [runs, days]);
  const projectStats = useMemo(
    // Same rule as Reports: no completed run in the window is "no data",
    // not 0% — an unrun project must not surface as the worst performer.
    () => buildProjectStats(runs, 30).filter((stat) => stat.runs > 0).sort((a, b) => a.successRate - b.successRate),
    [runs]
  );
  const runColumns = useRunStatsColumns();

  // Inner-row columns mirror the Test runs board: the group header already
  // names the project, so rows lead with WHEN the run happened; the Date
  // column and the tail chevron column stay out (the rotating chevron below
  // is the affordance).
  const inlineColumns: Column<Run>[] = useMemo(() => {
    const [, status, total, passed, failed, duration, , rate] = runColumns;
    const started: Column<Run> = {
      key: "started",
      header: t("runs.started"),
      render: (run) => <span className="table-link">{formatRelative(run.startedAt)}</span>,
      width: "18%"
    };
    return [started, status, total, passed, failed, duration, rate].filter((col): col is Column<Run> => Boolean(col));
  }, [runColumns, t]);
  // Projects with a live runner run — their health row gets the sweep.
  // Trigger resolves through runTrigger(): gateway-loaded rows (every
  // post-reload read) carry no trigger field, so a direct read went dark.
  const runningProjectIds = useMemo(
    () => new Set(runs.filter((run) => runTrigger(run) === "runner" && run.status === "running").map((run) => run.projectId)),
    [runs]
  );

  const rangeOptions: SegmentOption<Range>[] = [
    { id: "7", label: t("overview.range7") },
    { id: "14", label: t("overview.range14") },
    { id: "30", label: t("overview.range30") }
  ];

  // Recent runs grouped by project — one collapsible row per project with
  // runs, unfolding into that project's runs table. The panel is capped on
  // purpose: only runs from the last 30 days (the Overview's widest range)
  // and the latest 5 per project, newest first — history beyond that lives
  // on the Test runs board, never swelling this panel.
  const runGroups = useMemo(() => {
    const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return projects.map((project) => ({
      project,
      projectRuns: runs
        .filter((run) => run.projectId === project.id && run.startedAt >= cutoff)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, RECENT_MAX_PER_PROJECT)
    })).filter((group) => group.projectRuns.length > 0);
  }, [runs]);

  const hasActivity = activity.some((day) => day.passed + day.failed > 0);
  const totalPassed = activity.reduce((sum, day) => sum + day.passed, 0);
  const totalFailed = activity.reduce((sum, day) => sum + day.failed, 0);
  const totalsDaily = activity.map((day) => day.passed + day.failed);
  const failedDaily = activity.map((day) => day.failed);

  return (
    <section>
      <PageHeader
        actions={(
          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
            {/* Bootstrap sits left of the range tabs — the hand-off point
               where a coding agent gets this repo's Playwright suite ready. */}
            <button className="secondary-button" onClick={() => setBootstrapOpen(true)} type="button">
              <Rocket size={15} /> {t("suites.bootstrapButton")}
            </button>
            <Segmented onChange={(id) => setRange(id)} options={rangeOptions} value={range} />
          </div>
        )}
        subtitle={t("overview.subtitle")}
        title={t("overview.title")}
      />

      <GlobalBranchSwitcher />

      <div className="kpis">
        <KpiCard
          icon={<ListChecks size={15} />}
          label={t("overview.kpi.total")}
          value={formatCompact(kpis.totalTests)}
        />
        <KpiCard
          icon={<CircleCheck size={15} />}
          label={t("overview.kpi.passed")}
          tone="ok"
          value={formatCompact(kpis.passedTests)}
        />
        <KpiCard
          icon={<CircleX size={15} />}
          label={t("overview.kpi.failed")}
          tone="bad"
          value={formatCompact(kpis.failedTests)}
        />
        <KpiCard
          icon={<Gauge size={15} />}
          label={t("overview.kpi.success")}
          value={formatPercent(kpis.successRate)}
        />
      </div>

      <div className="grid-2">
        <ChartCard
          description={t("overview.activity.desc")}
          footer={(
            <>
              <span>{`${formatNumber(totalPassed + totalFailed)} ${t("common.tests")}`}</span>
              <span>{`${formatNumber(totalFailed)} ${t("common.failed")}`}</span>
            </>
          )}
          legend={<ChartLegend items={[{ color: "var(--chart-failed)", label: t("common.failed") }, { color: "var(--chart-context)", label: t("common.passed") }]} />}
          table={{
            head: [t("common.date"), t("common.passed"), t("common.failed")],
            rows: [...activity].reverse().map((day) => [day.label, formatNumber(day.passed), formatNumber(day.failed)])
          }}
          title={t("overview.activity.title")}
        >
          {hasActivity ? (
            <StackedColumns
              ariaLabel={t("overview.activity.title")}
              baseLabel={t("common.passed")}
              data={activity.map((day: DayActivity) => ({ base: day.passed, label: day.label, top: day.failed }))}
              topLabel={t("common.failed")}
            />
          ) : (
            <EmptyState
              description={t("overview.activity.emptyDesc")}
              icon={<ListChecks size={20} />}
              title={t("overview.activity.emptyTitle")}
            />
          )}
        </ChartCard>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">{t("overview.health.title")}</h3>
            </div>
            <button className="link-button" onClick={() => navigate("/projects")}>{t("common.viewAll")}</button>
          </div>
          <div
            className="health-list"
            /* Empty state centered: this column stretches to the chart's
               height, so a bare top-left paragraph read as a rendering bug. */
            style={projectStats.length === 0 ? { display: "grid", flex: 1, minHeight: 160, placeItems: "center" } : undefined}
          >
            {projectStats.length === 0 ? (
              <p className="muted" style={{ margin: 0, textAlign: "center" }}>{t("suite.noRuns")}</p>
            ) : (
              projectStats.slice(0, 5).map((stat) => {
              const project = projectById(stat.projectId);
              if (!project) return null;
              const health = healthFromRate(stat.successRate);
              return (
                <button
                  className={`health-row${runningProjectIds.has(stat.projectId) ? " health-row-running" : ""}`}
                  key={stat.projectId}
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <ProjectIcon icon={project.icon} />
                  <span className="health-row-name">{project.name}</span>
                  <span className={`health-dot ${healthDotClass(health.tone)}`} />
                  <span className="health-row-health">{t(health.labelKey)}</span>
                  <span className="num health-row-rate">{formatPercent(stat.successRate, 1)}</span>
                  <ChevronRight size={15} style={{ color: "hsl(var(--muted-foreground))" }} />
                </button>
              );
              })
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">{t("overview.recent.title")}</h3>
          </div>
          <button className="link-button" onClick={() => navigate("/runs")}>{t("common.viewAll")}</button>
        </div>
        {/* ?from tells the run page which trail to draw: from here it is
            Overview › project › run, from the Test runs board it stays
            Test runs › run. Project rows fold the same way the Test runs
            board groups them. */}
        <div className="case-tree">
          {runGroups.map(({ project, projectRuns }) => {
            const open = openProject === project.id;
            const failed = projectRuns.filter((run) => run.status === "failed").length;
            return (
              <div className={`case-file${open ? "" : " collapsed"}`} key={project.id}>
                <button
                  aria-expanded={open}
                  className="case-file-head"
                  onClick={() => setOpenProject(open ? null : project.id)}
                  type="button"
                >
                  <FileCode2 className="case-file-ico" size={13} aria-hidden />
                  <span>{project.name}</span>
                  <span className="case-file-counts">
                    {failed > 0 ? (
                      <span className="badge badge-failed">
                        <CircleX size={13} />
                        {failed} {t("status.failed").toLowerCase()}
                      </span>
                    ) : null}
                    <span className="muted">{`${projectRuns.length} ${t("runs.count")}`}</span>
                  </span>
                  <ChevronDown className="case-file-chevron" size={15} aria-hidden />
                </button>
                <div className="case-file-body">
                  <div className="case-file-body-inner">
                    {/* Run rows unfold INLINE — no navigation, no sidebar
                        selection change. Column set mirrors the Test runs
                        board's inner rows (time leads, no project name). */}
                    <div className="runs-inline">
                      <div className="runs-inline-row runs-inline-head">
                        {inlineColumns.map((col) => (
                          <span
                            className={`${col.align === "end" ? "cell-end" : ""}${col.className ? ` ${col.className}` : ""}`}
                            key={col.key}
                            style={col.width ? { flex: "none", width: col.width } : undefined}
                          >
                            {col.header}
                          </span>
                        ))}
                        <span aria-hidden className="runs-inline-tail" />
                      </div>
                      {projectRuns.map((run) => {
                        const runOpen = openRun === run.id;
                        return (
                          <RunInlineRow
                            cases={caseResults.filter((entry) => entry.runId === run.id)}
                            inlineColumns={inlineColumns}
                            key={run.id}
                            onToggle={() => setOpenRun(runOpen ? null : run.id)}
                            open={runOpen}
                            run={run}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {bootstrapOpen ? <BootstrapModal onClose={() => setBootstrapOpen(false)} /> : null}
    </section>
  );
}
