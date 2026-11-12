import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { projects } from "../../lib/demo/data";
import type { Issue, IssueSeverity, IssueStatus, Project } from "../../lib/demo/data";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useDemoState } from "../../lib/demo/store";
import { DataTable } from "../../shared/ui/DataTable";
import type { Column } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";
import { Select } from "../../shared/ui/select";
import { ISSUE_STATUS_KEYS, SEVERITY_KEYS } from "./issueColumns";

/** The issues table is PROJECT-scoped like the suites list: one row per
 *  project, summarising its issues. Clicking the row opens the issues
 *  board's own per-project page (/issues/project/:id) — a standalone
 *  issues-only view for that project, NOT the project detail page's tab. */
type ProjectIssuesRow = { id: string; project: Project; issues: Issue[] };

/** "2 open · 1 resolved" — zero segments are dropped, a summary never
 *  advertises a state the project has not hit. */
function countSummary(counts: [string, number][]): string {
  return counts.filter(([, count]) => count > 0).map(([label, count]) => `${count} ${label}`).join(" · ");
}

export function IssuesPage() {
  const { issues } = useDemoState();
  const { navigate } = useRoute();
  const { t } = useT();
  const [statusFilter, setStatusFilter] = useState<IssueStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | "">("");
  const [projectFilter, setProjectFilter] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => issues.filter((issue: Issue) => {
    if (statusFilter !== "all" && issue.status !== statusFilter) return false;
    if (severityFilter && issue.severity !== severityFilter) return false;
    if (projectFilter && issue.projectId !== projectFilter) return false;
    if (query && !`${issue.title} ${issue.id}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [issues, projectFilter, query, severityFilter, statusFilter]);

  // Issues grouped under their project, in the catalog's project order —
  // a project with no matching issues simply has no row at all.
  const rows = useMemo(() => projects
    .map((project): ProjectIssuesRow => ({
      id: `project:${project.id}`,
      project,
      issues: filtered.filter((issue) => issue.projectId === project.id)
    }))
    .filter((row) => row.issues.length > 0), [filtered]);

  // "All" leads the row — the unfiltered mix is the default view, the
  // three statuses follow in their natural order.
  const statusOptions: SegmentOption<IssueStatus | "all">[] = [
    { id: "all", label: t("common.all") },
    { id: "open", label: t("issue.open") },
    { id: "in_progress", label: t("issue.inProgress") },
    { id: "resolved", label: t("issue.resolved") }
  ];

  const columns: Column<ProjectIssuesRow>[] = [
    {
      key: "name",
      header: t("common.project"),
      render: (row) => <strong>{row.project.name}</strong>
    },
    {
      key: "severity",
      header: t("common.severity"),
      render: (row) => {
        const counts = (Object.keys(SEVERITY_KEYS) as IssueSeverity[]).map(
          (severity): [string, number] => [t(SEVERITY_KEYS[severity]), row.issues.filter((issue) => issue.severity === severity).length]
        );
        return <span className="muted" style={{ fontSize: 12.5 }}>{countSummary(counts)}</span>;
      }
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const counts = (Object.keys(ISSUE_STATUS_KEYS) as IssueStatus[]).map(
          (status): [string, number] => [t(ISSUE_STATUS_KEYS[status]), row.issues.filter((issue) => issue.status === status).length]
        );
        return <span className="muted" style={{ fontSize: 12.5 }}>{countSummary(counts)}</span>;
      }
    },
    {
      // Pinned to the row's end — the affordance saying this row navigates
      // to the project's issues page.
      align: "end",
      key: "open",
      header: "",
      render: () => <ChevronRight size={15} style={{ color: "hsl(var(--muted-foreground))" }} />
    }
  ];

  return (
    <section>
      <PageHeader subtitle={t("issues.subtitle")} title={t("issues.title")} />

      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input onChange={(event) => setQuery(event.target.value)} placeholder={t("issues.searchPlaceholder")} value={query} />
        </label>
        <div className="toolbar-actions">
          <Select
            ariaLabel={t("common.severity")}
            items={[
              { value: "", label: t("issues.filterSeverity") },
              ...(Object.keys(SEVERITY_KEYS) as IssueSeverity[]).map((severity) => ({ value: severity, label: t(SEVERITY_KEYS[severity]) }))
            ]}
            onChange={(value) => setSeverityFilter(value as IssueSeverity | "")}
            value={severityFilter}
          />
          <Select
            ariaLabel={t("common.project")}
            items={[
              { value: "", label: t("runs.filterProject") },
              ...projects.map((project) => ({ value: project.id, label: project.name }))
            ]}
            onChange={setProjectFilter}
            value={projectFilter}
          />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <Segmented onChange={(id) => setStatusFilter(id)} options={statusOptions} value={statusFilter} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState description={t("common.notFound")} title={t("issues.empty")} />
      ) : (
        <DataTable
          columns={columns}
          onRowClick={(row) => navigate(`/issues/project/${row.project.id}`)}
          rows={rows}
        />
      )}
    </section>
  );
}
