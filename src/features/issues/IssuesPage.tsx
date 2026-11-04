import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { projects } from "../../lib/demo/data";
import type { Issue, IssueSeverity, IssueStatus } from "../../lib/demo/data";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useDemoState } from "../../lib/demo/store";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";
import { Select } from "../../shared/ui/select";
import { ISSUE_STATUS_KEYS, SEVERITY_KEYS, useIssueColumns } from "./issueColumns";

export function IssuesPage() {
  const { issues } = useDemoState();
  const { navigate } = useRoute();
  const { t } = useT();
  const [statusFilter, setStatusFilter] = useState<IssueStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | "">("");
  const [projectFilter, setProjectFilter] = useState("");
  const [query, setQuery] = useState("");

  const issueColumns = useIssueColumns((issue) => navigate(`/issues/${issue.id}`));

  const filtered = useMemo(() => issues.filter((issue: Issue) => {
    if (statusFilter !== "all" && issue.status !== statusFilter) return false;
    if (severityFilter && issue.severity !== severityFilter) return false;
    if (projectFilter && issue.projectId !== projectFilter) return false;
    if (query && !`${issue.title} ${issue.id}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [issues, projectFilter, query, severityFilter, statusFilter]);

  const statusOptions: SegmentOption<IssueStatus | "all">[] = [
    { id: "open", label: t("issue.open") },
    { id: "in_progress", label: t("issue.inProgress") },
    { id: "resolved", label: t("issue.resolved") },
    { id: "all", label: t("common.all") }
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
        <DataTable columns={issueColumns} onRowClick={(issue) => navigate(`/issues/${issue.id}`)} rows={filtered} />
      )}
    </section>
  );
}
