import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { projectById } from "../../lib/demo/data";
import type { Issue, IssueSeverity, IssueStatus } from "../../lib/demo/data";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useDemoState } from "../../lib/demo/store";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";
import { Select } from "../../shared/ui/select";
import { Breadcrumb } from "../../shared/ui/Breadcrumb";
import { ISSUE_STATUS_KEYS, SEVERITY_KEYS, useIssueColumns } from "./issueColumns";

/** The Issues menu's per-project page: /issues/project/:projectId — a
 *  STANDALONE issues-only view for one project. Deliberately not the
 *  project detail page's Issues tab: that tab lives inside the project
 *  workspace (its runs, suites, editor); this page is the issues board's
 *  own drill-down, so it carries only what an issues list needs. Back
 *  returns to the global issues list; an issue row opens its detail. */
export function IssuesProjectPage() {
  const { params, navigate } = useRoute();
  const { issues } = useDemoState();
  const { t } = useT();
  const [statusFilter, setStatusFilter] = useState<IssueStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | "">("");
  const [query, setQuery] = useState("");

  const projectId = params.projectId ?? "";
  const project = projectById(projectId);
  // This page IS the project scope — the issue rows drop the Project
  // column for the same reason the project page's own list does.
  const issueColumns = useIssueColumns((issue) => navigate(`/issues/${issue.id}`), { omitProject: true });

  const projectIssues = useMemo(() => issues.filter((issue) => issue.projectId === projectId), [issues, projectId]);

  const filtered = useMemo(() => projectIssues.filter((issue: Issue) => {
    if (statusFilter !== "all" && issue.status !== statusFilter) return false;
    if (severityFilter && issue.severity !== severityFilter) return false;
    if (query && !`${issue.title} ${issue.id}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [projectIssues, query, severityFilter, statusFilter]);

  // "All" lives HERE and first — the global board has no all-statuses tab,
  // so going inside a project is where the full mix becomes visible.
  const statusOptions: SegmentOption<IssueStatus | "all">[] = [
    { id: "all", label: t("common.all") },
    { id: "open", label: t("issue.open") },
    { id: "in_progress", label: t("issue.inProgress") },
    { id: "resolved", label: t("issue.resolved") }
  ];

  if (!project) {
    return (
      <section>
        <PageHeader subtitle={t("issues.subtitle")} title={t("issues.title")} />
        <EmptyState description={t("issues.notFound")} title={t("common.error")} />
      </section>
    );
  }

  return (
    <section>
      {/* Board hierarchy trail: Issues › <this project>. The first crumb
          walks back to the global issues list in one click — with the trail
          in place no back arrow or repeated heading is needed. */}
      <Breadcrumb
        items={[
          { label: t("nav.issues"), onClick: () => navigate("/issues") },
          { label: project.name }
        ]}
      />

      {/* One control row at tab level: search, then the status tabs right
          beside it, severity select pinned to the far edge — all vertically
          centered on the same line. */}
      <div className="toolbar">
        <div style={{ alignItems: "center", display: "flex", flex: 1, gap: 10, minWidth: 0 }}>
          <label className="search-box">
            <Search size={15} />
            <input onChange={(event) => setQuery(event.target.value)} placeholder={t("issues.searchPlaceholder")} value={query} />
          </label>
          <Segmented onChange={(id) => setStatusFilter(id)} options={statusOptions} value={statusFilter} />
        </div>
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
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState description={t("common.notFound")} title={t("issues.empty")} />
      ) : (
        <DataTable columns={issueColumns} onRowClick={(issue) => navigate(`/issues/${issue.id}`)} rows={filtered} />
      )}
    </section>
  );
}
