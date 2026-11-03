import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { useShell } from "../../app/layout/ShellContext";
import { projects } from "../../lib/demo/data";
import type { Run, RunStatus } from "../../lib/demo/data";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useDemoState } from "../../lib/demo/store";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { RUN_STATUS_KEYS } from "./runColumns";
import { useRunColumns } from "./runColumns";

export function RunsPage() {
  const { runs } = useDemoState();
  const { navigate } = useRoute();
  const { openNewRun } = useShell();
  const { t } = useT();
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "">("");
  const [query, setQuery] = useState("");

  const runColumns = useRunColumns((run) => navigate(`/runs/${run.id}`));

  const filtered = useMemo(() => runs.filter((run: Run) => {
    if (projectFilter && run.projectId !== projectFilter) return false;
    if (statusFilter && run.status !== statusFilter) return false;
    if (query && !`${run.name} ${run.id}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [projectFilter, query, runs, statusFilter]);

  const hasFilters = Boolean(projectFilter || statusFilter || query);

  return (
    <section>
      <PageHeader
        actions={(
          <button className="primary-button" onClick={openNewRun}>
            <Plus size={16} /> {t("runs.newRun")}
          </button>
        )}
        subtitle={t("runs.subtitle")}
        title={t("runs.title")}
      />

      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input onChange={(event) => setQuery(event.target.value)} placeholder={t("runs.searchPlaceholder")} value={query} />
        </label>
        <div className="toolbar-actions">
          <select aria-label={t("common.project")} className="inline-select" onChange={(event) => setProjectFilter(event.target.value)} value={projectFilter}>
            <option value="">{t("runs.filterProject")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <select aria-label={t("common.status")} className="inline-select" onChange={(event) => setStatusFilter(event.target.value as RunStatus | "")} value={statusFilter}>
            <option value="">{t("runs.filterStatus")}</option>
            {(Object.keys(RUN_STATUS_KEYS) as RunStatus[]).map((status) => (
              <option key={status} value={status}>{t(RUN_STATUS_KEYS[status])}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 && !hasFilters ? (
        <EmptyState
          action={(
            <button className="primary-button" onClick={openNewRun}>
              <Plus size={16} /> {t("runs.newRun")}
            </button>
          )}
          description={t("runs.subtitle")}
          title={t("runs.empty")}
        />
      ) : filtered.length === 0 ? (
        <EmptyState description={t("common.notFound")} title={t("runs.empty")} />
      ) : (
        <DataTable columns={runColumns} onRowClick={(run) => navigate(`/runs/${run.id}`)} rows={filtered} />
      )}
    </section>
  );
}
