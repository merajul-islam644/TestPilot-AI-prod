import { useMemo, useState } from "react";
import { ChevronRight, CircleCheck, CircleX, Gauge, ListChecks, Plus } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { useShell } from "../../app/layout/ShellContext";
import { buildDailyActivity, buildPassRateTrend, buildProjectStats, computeKpis, projectById } from "../../lib/demo/data";
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
import { useRunColumns } from "../runs/runColumns";

type Range = "7" | "14" | "30";

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
  const { openNewRun } = useShell();
  const { t } = useT();
  const [range, setRange] = useState<Range>("30");
  const days = Number(range);

  const kpis = useMemo(() => computeKpis(runs, days), [runs, days]);
  const activity = useMemo(() => buildDailyActivity(runs, days), [runs, days]);
  const rateTrend = useMemo(() => buildPassRateTrend(runs, days), [runs, days]);
  const projectStats = useMemo(
    () => buildProjectStats(runs, 30).sort((a, b) => a.successRate - b.successRate),
    [runs]
  );
  const runColumns = useRunColumns((run) => navigate(`/runs/${run.id}`));

  const rangeOptions: SegmentOption<Range>[] = [
    { id: "7", label: t("overview.range7") },
    { id: "14", label: t("overview.range14") },
    { id: "30", label: t("overview.range30") }
  ];

  const hasActivity = activity.some((day) => day.passed + day.failed > 0);
  const totalPassed = activity.reduce((sum, day) => sum + day.passed, 0);
  const totalFailed = activity.reduce((sum, day) => sum + day.failed, 0);
  const totalsDaily = activity.map((day) => day.passed + day.failed);
  const failedDaily = activity.map((day) => day.failed);

  return (
    <section>
      <PageHeader
        actions={(
          <>
            <Segmented onChange={(id) => setRange(id)} options={rangeOptions} value={range} />
            <button className="primary-button" onClick={openNewRun}>
              <Plus size={16} /> {t("overview.newRun")}
            </button>
          </>
        )}
        subtitle={t("overview.subtitle")}
        title={t("overview.title")}
      />

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
            {projectStats.slice(0, 5).map((stat) => {
              const project = projectById(stat.projectId);
              if (!project) return null;
              const health = healthFromRate(stat.successRate);
              return (
                <button className="health-row" key={stat.projectId} onClick={() => navigate(`/projects/${project.id}`)}>
                  <ProjectIcon icon={project.icon} />
                  <span className="health-row-name">{project.name}</span>
                  <span className={`health-dot ${healthDotClass(health.tone)}`} />
                  <span className="health-row-health">{t(health.labelKey)}</span>
                  <span className="num health-row-rate">{formatPercent(stat.successRate, 1)}</span>
                  <ChevronRight size={15} style={{ color: "hsl(var(--muted-foreground))" }} />
                </button>
              );
            })}
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
        <DataTable columns={runColumns} onRowClick={(run) => navigate(`/runs/${run.id}`)} rows={runs.slice(0, 8)} />
      </div>
    </section>
  );
}
