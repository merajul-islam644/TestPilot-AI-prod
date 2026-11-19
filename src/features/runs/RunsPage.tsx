import { useMemo, useState } from "react";
import { ChevronDown, CircleX, FileCode2, Search } from "lucide-react";
import { projects } from "../../lib/demo/data";
import type { Run, RunStatus } from "../../lib/demo/data";
import { formatRelative } from "../../lib/format";
import { cancelRun, useDemoState } from "../../lib/demo/store";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Select } from "../../shared/ui/select";
import { useIsDataViewer } from "../access/useDataViewer";
import { RUN_STATUS_KEYS, useRunStatsColumns } from "./runColumns";
import { RunInlineRow } from "./RunInlineRow";
import type { Column } from "../../shared/ui/DataTable";

export function RunsPage() {
  const { runs, caseResults } = useDemoState();
  const { t } = useT();
  const viewer = useIsDataViewer();
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "">("");
  const [query, setQuery] = useState("");
  // Accordion: one project unfolded at a time — every row starts minimized.
  const [openProject, setOpenProject] = useState<string | null>(null);
  // One RUN unfolded at a time: clicking a run row folds open that run's
  // case tree INLINE (no navigation to the detail page).
  const [openRun, setOpenRun] = useState<string | null>(null);

  // Same stats table as the Overview's Recent test runs — one column
  // system everywhere — with the stop button armed on live rows. The
  // data-viewer role never stops anything: no stop column at all.
  const runColumns = useRunStatsColumns(viewer ? undefined : { onCancel: (run) => cancelRun(run.id) });

  // Inner-row columns: the group header already names the project, so the
  // "Project" cell is replaced by WHEN the run happened (leading, prominent)
  // and the trailing "Date" column is dropped — same info, no duplication.
  // The shared tail column stays out too: its chevron is replaced by the
  // rotating one this row carries itself.
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

  const filtered = useMemo(() => runs.filter((run: Run) => {
    if (projectFilter && run.projectId !== projectFilter) return false;
    if (statusFilter && run.status !== statusFilter) return false;
    if (query && !`${run.name} ${run.id}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [projectFilter, query, runs, statusFilter]);

  const hasFilters = Boolean(projectFilter || statusFilter || query);

  // Runs grouped by project — one collapsible row per project that has at
  // least one matching run; the row folds into that project's runs table.
  const groups = useMemo(() => projects.map((project) => ({
    project,
    projectRuns: filtered.filter((run) => run.projectId === project.id)
  })).filter((group) => group.projectRuns.length > 0), [filtered]);

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
        <div className="case-tree">
          {groups.map(({ project, projectRuns }) => {
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
                    {/* Run rows expand INLINE: clicking a run folds open its
                        case tree right beneath the row — no page change. The
                        column set is the shared stats columns, so this table
                        always matches Overview and the old flat list. */}
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
                        {/* Mirrors the row's chevron slot so the header
                            labels land exactly over their cells. */}
                        <span aria-hidden className="runs-inline-tail" />
                      </div>
                      {projectRuns.map((run) => {
                        const open = openRun === run.id;
                        return (
                          <RunInlineRow
                            cases={caseResults.filter((entry) => entry.runId === run.id)}
                            inlineColumns={inlineColumns}
                            key={run.id}
                            onToggle={() => setOpenRun(open ? null : run.id)}
                            open={open}
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
      )}
    </section>
  );
}
