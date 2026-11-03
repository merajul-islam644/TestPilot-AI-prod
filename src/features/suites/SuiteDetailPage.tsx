import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { projectById, suiteById } from "../../lib/demo/data";
import { useDemoState } from "../../lib/demo/store";
import { formatDate, formatRelative } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { SuiteStatusBadge } from "../../shared/ui/StatusBadge";
import { useRunColumns } from "../runs/runColumns";

export function SuiteDetailPage() {
  const { params, navigate } = useRoute();
  const { runs } = useDemoState();
  const { t } = useT();
  const runColumns = useRunColumns((run) => navigate(`/runs/${run.id}`));

  const suite = suiteById(params.suiteId ?? "");
  const suiteRuns = useMemo(() => runs.filter((run) => run.suiteId === params.suiteId), [params.suiteId, runs]);

  if (!suite) {
    return (
      <section>
        <button className="tertiary-button" onClick={() => navigate("/suites")}><ArrowLeft size={16} /> {t("common.back")}</button>
        <EmptyState description={t("suites.notFound")} title={t("common.error")} />
      </section>
    );
  }

  const project = projectById(suite.projectId);

  return (
    <section>
      <button className="tertiary-button" onClick={() => navigate("/suites")} style={{ marginBottom: 12 }}>
        <ArrowLeft size={16} /> {t("common.back")}
      </button>
      <PageHeader subtitle={suite.description} title={suite.name} />

      <div className="chips" style={{ marginBottom: 16 }}>
        <SuiteStatusBadge
          label={t(suite.status === "active" ? "suite.active" : suite.status === "draft" ? "suite.draft" : "suite.archived")}
          status={suite.status}
        />
        <span className="chip">{project?.name ?? "—"}</span>
        <span className="chip">{`${t("common.owner")}: ${suite.owner}`}</span>
        <span className="chip">{`${t("suite.lastUpdated")}: ${formatDate(suite.lastUpdatedAt)}`}</span>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">{t("suite.recentRuns")}</h3>
        </div>
        {suiteRuns.length > 0 ? (
          <DataTable columns={runColumns} onRowClick={(run) => navigate(`/runs/${run.id}`)} rows={suiteRuns.slice(0, 10)} />
        ) : (
          <p className="muted">{t("suite.noRuns")}</p>
        )}
      </div>
    </section>
  );
}
