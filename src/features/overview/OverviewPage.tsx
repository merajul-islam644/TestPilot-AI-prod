import { useMemo, useState } from "react";
import { ChevronRight, CircleCheck, CircleX, Gauge, ListChecks } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { buildDailyActivity, buildPassRateTrend, buildProjectStats, computeKpis, projectById, runTrigger } from "../../lib/demo/data";
import type { DayActivity } from "../../lib/demo/data";
import { formatCompact, formatNumber, formatPercent, healthDotClass, healthFromRate } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useDemoState } from "../../lib/demo/store";
import { ChartCard, ChartLegend } from "../../shared/charts/ChartCard";
import { StackedColumns } from "../../shared/charts/StackedColumns";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { KpiCard } from "../../shared/ui/KpiCard";
import type { KpiDelta } from "../../shared/ui/KpiCard";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";
import { ProjectIcon } from "../projects/ProjectIcon";
import { useRunStatsColumns } from "../runs/runColumns";
import { GlobalBranchSwitcher } from "./GlobalBranchSwitcher";

type Range = "7" | "14" | "30";

/** Rows per page in the Recent test runs table — paged instead of
 *  hard-truncated. */
const RUNS_PAGE_SIZE = 10;

function deltaInfo(value: number, goodWhenUp: boolean, suffix: string): KpiDelta {
  return {
    direction: value > 0.05 ? "up" : value < -0.05 ? "down" : "flat",
    goodWhenUp,
    text: `${Math.abs(value).toFixed(1)}${suffix}`
  };
}

export function OverviewPage() {
  const { runs } = useDemoState();
  const { navigate } = useRoute();
  const { t } = useT();
  const [range, setRange] = useState<Range>("30");
  const [runsPage, setRunsPage] = useState(1);
  const days = Number(range);

  const kpis = useMemo(() => computeKpis(runs, days), [runs, days]);
  const activity = useMemo(() => buildDailyActivity(runs, days), [runs, days]);
  const rateTrend = useMemo(() => buildPassRateTrend(runs, days), [runs, days]);
  const projectStats = useMemo(
    // Same rule as Reports: no completed run in the window is "no data",
    // not 0% — an unrun project must not surface as the worst performer.
    () => buildProjectStats(runs, 30).filter((stat) => stat.runs > 0).sort((a, b) => a.successRate - b.successRate),
    [runs]
  );
  const runColumns = useRunStatsColumns();
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

  // Recent runs paging — clamped so a live update that adds/removes rows
  // (new run lands, run finishes) can never leave the page out of range.
  const runsTotalPages = Math.max(1, Math.ceil(runs.length / RUNS_PAGE_SIZE));
  const safeRunsPage = Math.min(runsPage, runsTotalPages);
  const runsStart = (safeRunsPage - 1) * RUNS_PAGE_SIZE;
  const visibleRuns = runs.slice(runsStart, runsStart + RUNS_PAGE_SIZE);

  const hasActivity = activity.some((day) => day.passed + day.failed > 0);
  const totalPassed = activity.reduce((sum, day) => sum + day.passed, 0);
  const totalFailed = activity.reduce((sum, day) => sum + day.failed, 0);
  const totalsDaily = activity.map((day) => day.passed + day.failed);
  const failedDaily = activity.map((day) => day.failed);

  return (
    <section>
      <PageHeader
        actions={<Segmented onChange={(id) => setRange(id)} options={rangeOptions} value={range} />}
        subtitle={t("overview.subtitle")}
        title={t("overview.title")}
      />

      <GlobalBranchSwitcher />

      <div className="kpis">
        <KpiCard
          delta={deltaInfo(kpis.deltas.total, true, "%")}
          icon={<ListChecks size={15} />}
          label={t("overview.kpi.total")}
          spark={totalsDaily.slice(-12)}
          value={formatCompact(kpis.totalTests)}
        />
        <KpiCard
          delta={deltaInfo(kpis.deltas.passed, true, "%")}
          icon={<CircleCheck size={15} />}
          label={t("overview.kpi.passed")}
          tone="ok"
          value={formatCompact(kpis.passedTests)}
        />
        <KpiCard
          delta={deltaInfo(kpis.deltas.failed, false, "%")}
          icon={<CircleX size={15} />}
          label={t("overview.kpi.failed")}
          spark={failedDaily.slice(-12)}
          tone="bad"
          value={formatCompact(kpis.failedTests)}
        />
        <KpiCard
          delta={deltaInfo(kpis.deltas.rate, true, "pp")}
          icon={<Gauge size={15} />}
          label={t("overview.kpi.success")}
          spark={rateTrend.slice(-12).map((point) => point.value)}
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
          <div className="health-list">
            {projectStats.length === 0 ? (
              <p className="muted">{t("suite.noRuns")}</p>
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
            Test runs › run. */}
        <DataTable columns={runColumns} fixed onRowClick={(run) => navigate(`/runs/${run.id}?from=overview`)} rows={visibleRuns} />
        {runsTotalPages > 1 ? (
          <div className="pagination">
            <span className="pagination-count">
              {runsStart + 1}–{Math.min(runsStart + RUNS_PAGE_SIZE, runs.length)} / {runs.length}
            </span>
            <div className="pagination-controls">
              <button
                className="secondary-button"
                disabled={safeRunsPage <= 1}
                onClick={() => setRunsPage(Math.max(1, safeRunsPage - 1))}
                type="button"
              >
                {t("users.prevPage")}
              </button>
              <span>
                {t("users.page")} {safeRunsPage} {t("users.of")} {runsTotalPages}
              </span>
              <button
                className="secondary-button"
                disabled={safeRunsPage >= runsTotalPages}
                onClick={() => setRunsPage(Math.min(runsTotalPages, safeRunsPage + 1))}
                type="button"
              >
                {t("users.nextPage")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
