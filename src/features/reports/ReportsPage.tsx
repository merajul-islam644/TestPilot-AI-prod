import { useMemo, useState } from "react";
import { useRoute } from "../../app/router/routes";
import { buildDailyActivity, buildDailyCounts, buildPassRateTrend, buildProjectStats, buildTopFailingTests, projectById } from "../../lib/demo/data";
import { formatPercent } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useDemoState } from "../../lib/demo/store";
import { BarList } from "../../shared/charts/BarList";
import { ChartCard } from "../../shared/charts/ChartCard";
import { ColumnChart } from "../../shared/charts/ColumnChart";
import { LineChart } from "../../shared/charts/LineChart";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";

type Range = "30" | "60";

export function ReportsPage() {
  const { runs, caseResults } = useDemoState();
  const { t } = useT();
  const [range, setRange] = useState<Range>("30");
  const days = Number(range);

  const passRate = useMemo(() => buildPassRateTrend(runs, days), [days, runs]);
  const executions = useMemo(() => buildDailyCounts(runs, days), [days, runs]);
  const activity = useMemo(() => buildDailyActivity(runs, days), [days, runs]);
  // Projects that never completed a run in the window are "no data", not
  // "0%" — they would otherwise read as the worst performers.
  const projectStats = useMemo(() => buildProjectStats(runs, days).filter((stat) => stat.runs > 0).sort((a, b) => b.successRate - a.successRate), [days, runs]);
  const topFailing = useMemo(() => buildTopFailingTests(runs, caseResults, { days }), [caseResults, days, runs]);

  const rangeOptions: SegmentOption<Range>[] = [
    { id: "30", label: t("reports.range30") },
    { id: "60", label: t("reports.range60") }
  ];
  const rangeLabel = range === "30" ? t("reports.range30") : t("reports.range60");
  // Weighted average: total passed ÷ total executed tests across the whole
  // window. The old mean-of-daily-rates let a 2-test day outvote a 40-test
  // day, so the headline number didn't describe the actual tests.
  const windowTotals = activity.reduce((acc, day) => ({ passed: acc.passed + day.passed, tested: acc.tested + day.passed + day.failed }), { passed: 0, tested: 0 });
  const avgPassRate = windowTotals.tested > 0 ? (windowTotals.passed / windowTotals.tested) * 100 : undefined;

  return (
    <section>
      <PageHeader
        actions={<Segmented onChange={(id) => setRange(id)} options={rangeOptions} value={range} />}
        subtitle={t("reports.subtitle")}
        title={t("reports.title")}
      />

      <div className="grid-2">
        <ChartCard
          description={t("reports.passRate.desc")}
          footer={<span>{`${avgPassRate !== undefined ? formatPercent(avgPassRate) : "—"} ${rangeLabel}`}</span>}
          table={{
            head: [t("common.date"), t("reports.passRate.series")],
            rows: [...passRate].reverse().map((point) => [point.label, formatPercent(point.value)])
          }}
          title={t("reports.passRate.title")}
        >
          <LineChart
            ariaLabel={t("reports.passRate.title")}
            points={passRate}
            seriesLabel={t("reports.passRate.series")}
          />
        </ChartCard>

        <ChartCard
          description={t("reports.executions.desc")}
          footer={<span>{`${executions.reduce((sum, day) => sum + day.value, 0)} ${t("reports.executions.series")}`}</span>}
          table={{
            head: [t("common.date"), t("reports.executions.series")],
            rows: [...executions].reverse().map((day) => [day.label, String(day.value)])
          }}
          title={t("reports.executions.title")}
        >
          <ColumnChart
            ariaLabel={t("reports.executions.title")}
            data={executions.map((day) => ({ label: day.label, value: day.value }))}
            seriesLabel={t("reports.executions.series")}
          />
        </ChartCard>

        <ChartCard
          description={t("reports.failures.desc")}
          table={{
            head: [t("common.date"), t("common.failed")],
            rows: [...activity].reverse().map((day) => [day.label, String(day.failed)])
          }}
          title={t("reports.failures.title")}
        >
          <ColumnChart
            ariaLabel={t("reports.failures.title")}
            color="var(--chart-failed)"
            data={activity.map((day) => ({ label: day.label, value: day.failed }))}
            seriesLabel={t("common.failed")}
          />
        </ChartCard>

        <ChartCard
          description={t("reports.projects.desc")}
          table={{
            head: [t("common.project"), t("projects.successRate")],
            rows: projectStats.map((stat) => [projectById(stat.projectId)?.name ?? stat.projectId, formatPercent(stat.successRate)])
          }}
          title={t("reports.projects.title")}
        >
          <BarList
            rows={projectStats.map((stat) => ({
              display: formatPercent(stat.successRate),
              label: projectById(stat.projectId)?.name ?? stat.projectId,
              value: stat.successRate
            }))}
          />
        </ChartCard>

        <div className="panel" style={{ gridColumn: "1 / -1" }}>
          <div className="panel-head">
            <div>
              <h3 className="panel-title">{t("reports.topFailing.title")}</h3>
              <p className="panel-desc">{t("reports.topFailing.desc")}</p>
            </div>
          </div>
          {topFailing.length > 0 ? (
            <BarList
              color="var(--chart-failed)"
              rows={topFailing.map((entry) => ({ label: entry.name, value: entry.count }))}
            />
          ) : (
            <p className="muted">{t("run.noFailures")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
