import { useMemo, useState } from "react";
import { ArrowLeft, CircleX, Link2 } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { buildRunCases, projectById, suiteById } from "../../lib/demo/data";
import type { CaseResult, Run } from "../../lib/demo/data";
import { cancelRun, useDemoState } from "../../lib/demo/store";
import { formatDateTime, formatDuration, formatMs } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { RunStatusBadge, StatusBadge } from "../../shared/ui/StatusBadge";
import { RUN_STATUS_KEYS } from "./runColumns";

const BROWSER_KEYS: Record<Run["browser"], string> = { chromium: "Chromium", webkit: "WebKit", firefox: "Firefox" };

export function RunDetailPage() {
  const { params, navigate } = useRoute();
  const { runs, issues, caseResults } = useDemoState();
  const { t } = useT();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const run = runs.find((entry) => entry.id === params.runId);
  // Runner-backed runs carry persisted case rows; simulated ones fall back to
  // the deterministic generator so both render through the same table.
  const realCases = useMemo(
    () => caseResults.filter((entry) => entry.runId === run?.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [caseResults, run]
  );
  const cases = useMemo(
    () => (run ? (realCases.length > 0 ? realCases : buildRunCases(run)) : []),
    [run, realCases]
  );
  const linkedIssue = run ? issues.find((issue) => issue.runId === run.id) : undefined;
  const project = run ? projectById(run.projectId) : undefined;
  const suite = run ? suiteById(run.suiteId) : undefined;
  const isLive = run?.status === "running" || run?.status === "pending";
  const failedCases = cases.filter((entry) => entry.status === "failed");

  if (!run) {
    return (
      <section>
        <button className="tertiary-button" onClick={() => navigate("/runs")}><ArrowLeft size={16} /> {t("common.back")}</button>
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

  return (
    <section>
      <button className="tertiary-button" onClick={() => navigate("/runs")} style={{ marginBottom: 12 }}>
        <ArrowLeft size={16} /> {t("common.back")}
      </button>
      <PageHeader
        actions={isLive ? (
          <button className="danger-button" onClick={() => setConfirmingCancel(true)}>{t("run.cancel")}</button>
        ) : undefined}
        subtitle={formatDateTime(run.startedAt)}
        title={run.name}
      />

      <div className="chips" style={{ marginBottom: 14 }}>
        <RunStatusBadge label={t(statusKey)} status={run.status} />
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
        <div className="metric"><span>{t("common.failed")}</span><strong className="num" style={{ color: "hsl(var(--destructive))" }}>{terminal ? run.failed : "…"}</strong></div>
        <div className="metric"><span>{t("common.duration")}</span><strong>{run.durationSec > 0 ? formatDuration(run.durationSec) : "…"}</strong></div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <h3 className="panel-title">{t("run.cases")}</h3>
          {linkedIssue ? (
            <button className="link-button" onClick={() => navigate(`/issues/${linkedIssue.id}`)}><Link2 size={14} style={{ verticalAlign: -2 }} /> {t("run.openIssue")}: {linkedIssue.id}</button>
          ) : null}
        </div>
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
          rows={completedCases}
          tailLoadingRows={run.status === "running" ? Math.max(0, cases.length - completedCount) : 0}
        />
      </div>

      {terminal && run.failed > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">{t("run.failures")}</h3>
          </div>
          <div className="failure-list">
            {failedCases.map((entry) => (
              <div className="failure-card" key={entry.id}>
                <div className="failure-card-head">
                  <CircleX size={15} style={{ color: "hsl(var(--destructive))" }} />
                  <span className="mono">{entry.name}</span>
                </div>
                <pre>{entry.error}</pre>
                {linkedIssue ? (
                  <button className="link-button" onClick={() => navigate(`/issues/${linkedIssue.id}`)}>
                    {t("run.openIssue")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
