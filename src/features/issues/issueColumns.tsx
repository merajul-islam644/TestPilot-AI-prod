import type { Column } from "../../shared/ui/DataTable";
import type { Issue, IssueSeverity, IssueStatus } from "../../lib/demo/data";
import { projectById } from "../../lib/demo/data";
import { formatRelative } from "../../lib/format";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { IssueStatusBadge, SeverityBadge } from "../../shared/ui/StatusBadge";

export const SEVERITY_KEYS: Record<IssueSeverity, TranslationKey> = {
  critical: "severity.critical",
  high: "severity.high",
  medium: "severity.medium",
  low: "severity.low"
};

export const ISSUE_STATUS_KEYS: Record<IssueStatus, TranslationKey> = {
  open: "issue.open",
  in_progress: "issue.inProgress",
  resolved: "issue.resolved"
};

/** `omitProject` drops the Project column inside project-scoped views. */
export function useIssueColumns(onOpen: (issue: Issue) => void, { omitProject = false }: { omitProject?: boolean } = {}): Column<Issue>[] {
  const { t } = useT();

  return [
    {
      key: "title",
      header: t("common.name"),
      render: (issue) => (
        <span style={{ display: "grid", gap: 2 }}>
          <span className="table-link">{issue.title}</span>
          <span className="mono" style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>{issue.id}</span>
        </span>
      )
    },
    ...(omitProject ? [] : [{ key: "project", header: t("common.project"), render: (issue: Issue) => projectById(issue.projectId)?.name ?? "—" }]),
    { key: "severity", header: t("common.severity"), render: (issue) => <SeverityBadge label={t(SEVERITY_KEYS[issue.severity])} severity={issue.severity} /> },
    { key: "status", header: t("common.status"), render: (issue) => <IssueStatusBadge label={t(ISSUE_STATUS_KEYS[issue.status])} status={issue.status} /> },
    { key: "assignee", header: t("common.assignee"), render: (issue) => issue.assignee },
    { key: "created", header: t("issue.created"), render: (issue) => formatRelative(issue.createdAt) }
  ];
}
