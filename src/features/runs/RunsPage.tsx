import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { projects } from "../../lib/demo/data";
import type { Run, RunStatus } from "../../lib/demo/data";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { cancelRun, useDemoState } from "../../lib/demo/store";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Select } from "../../shared/ui/select";
import { RUN_STATUS_KEYS, useRunStatsColumns } from "./runColumns";

/** Same page size as the Overview table so both lists read identically. */
const RUNS_PAGE_SIZE = 10;

export function RunsPage() {
  const { runs } = useDemoState();
  const { navigate } = useRoute();
  const { t } = useT();
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "">("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  // Same stats table as the Overview's Recent test runs — one column
  // system everywhere — with the stop button armed on live rows.
  const runColumns = useRunStatsColumns({ onCancel: (run) => cancelRun(run.id) });

  const filtered = useMemo(() => runs.filter((run: Run) => {
    if (projectFilter && run.projectId !== projectFilter) return false;
    if (statusFilter && run.status !== statusFilter) return false;
    if (query && !`${run.name} ${run.id}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [projectFilter, query, runs, statusFilter]);

  const hasFilters = Boolean(projectFilter || statusFilter || query);

  // A new filter or search resets paging; page also clamps when the
  // filtered list shrinks below the current page.
  useEffect(() => {
    setPage(1);
  }, [projectFilter, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / RUNS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * RUNS_PAGE_SIZE;
  const visibleRows = filtered.slice(start, start + RUNS_PAGE_SIZE);

  return (
    <section>
      <PageHeader subtitle={t("runs.subtitle")} title={t("runs.title")} />

      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input onChange={(event) => setQuery(event.target.value)} placeholder={t("runs.searchPlaceholder")} value={query} />
        </label>
        <div className="toolbar-actions">
          <Select
            ariaLabel={t("common.project")}
            items={[
              { value: "", label: t("runs.filterProject") },
              ...projects.map((project) => ({ value: project.id, label: project.name }))
            ]}
            onChange={setProjectFilter}
            value={projectFilter}
          />
          <Select
            ariaLabel={t("common.status")}
            items={[
              { value: "", label: t("runs.filterStatus") },
              ...(Object.keys(RUN_STATUS_KEYS) as RunStatus[]).map((status) => ({ value: status, label: t(RUN_STATUS_KEYS[status]) }))
            ]}
            onChange={(value) => setStatusFilter(value as RunStatus | "")}
            value={statusFilter}
          />
        </div>
      </div>

      {filtered.length === 0 && !hasFilters ? (
        <EmptyState description={t("runs.subtitle")} title={t("runs.empty")} />
      ) : filtered.length === 0 ? (
        <EmptyState description={t("common.notFound")} title={t("runs.empty")} />
      ) : (
        <DataTable columns={runColumns} fixed onRowClick={(run) => navigate(`/runs/${run.id}`)} rows={visibleRows} />
      )}
      {filtered.length > 0 && totalPages > 1 ? (
        <div className="pagination">
          <span className="pagination-count">
            {start + 1}–{Math.min(start + RUNS_PAGE_SIZE, filtered.length)} / {filtered.length}
          </span>
          <div className="pagination-controls">
            <button
              className="secondary-button"
              disabled={safePage <= 1}
              onClick={() => setPage(Math.max(1, safePage - 1))}
              type="button"
            >
              {t("users.prevPage")}
            </button>
            <span>
              {t("users.page")} {safePage} {t("users.of")} {totalPages}
            </span>
            <button
              className="secondary-button"
              disabled={safePage >= totalPages}
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              type="button"
            >
              {t("users.nextPage")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
