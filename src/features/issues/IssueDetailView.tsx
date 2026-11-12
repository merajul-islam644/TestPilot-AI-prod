// The issue detail body, split out of IssueDetailPage.tsx so the project
// page can embed it WITHOUT importing the route module — the route file
// pulls in app/router/routes, which imports the project page back and
// makes the module graph circular (vite then full-reloads on every HMR
// update inside the cycle).
import { ArrowLeft } from "lucide-react";
import { projectById } from "../../lib/demo/data";
import { setIssueStatus, useDemoState } from "../../lib/demo/store";
import { formatDateTime, formatRelative } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Breadcrumb, type Crumb } from "../../shared/ui/Breadcrumb";
import { EmptyState } from "../../shared/ui/EmptyState";
import { IssueStatusBadge, SeverityBadge } from "../../shared/ui/StatusBadge";
import { ISSUE_STATUS_KEYS, SEVERITY_KEYS } from "./issueColumns";

/** The issue detail body, shared by the sidebar route and the project
 *  page's in-context drill-down. */
export function IssueDetailView({ crumbs, hideHeader = false, issueId, onBack, onOpenRun }: {
  /** Optional hierarchy trail (Issues › Project › this issue) rendered at
   *  the top. It must live INSIDE the section — a sibling would span main's
   *  full width while the section centers at max-width, and their left
   *  edges would misalign. */
  crumbs?: Crumb[];
  /** The sidebar route carries a breadcrumb (Issues › Project › this
   *  issue), so back arrow + repeated heading are suppressed there — only
   *  the id and the status actions remain. The project page's drill-down
   *  has no breadcrumb and keeps the full titlebar (its back button IS
   *  the way out). */
  hideHeader?: boolean;
  issueId: string;
  onBack: () => void;
  /** Open the linked run — the project page swaps in its own drill-down. */
  onOpenRun?: (runId: string) => void;
}) {
  const { issues } = useDemoState();
  const { t } = useT();

  const issue = issues.find((entry) => entry.id === issueId);

  if (!issue) {
    return (
      <section>
        <button className="tertiary-button" onClick={onBack}><ArrowLeft size={16} /> {t("common.back")}</button>
        <EmptyState description={t("issues.notFound")} title={t("common.error")} />
      </section>
    );
  }

  const project = projectById(issue.projectId);
  const linkedRun = issue.runId;
  const statusActions = (
    <div className="titlebar-actions">
      {issue.status === "open" ? (
        <button className="secondary-button" onClick={() => setIssueStatus(issue.id, "in_progress")}>{t("issue.startProgress")}</button>
      ) : null}
      {issue.status === "resolved" ? (
        <button className="tertiary-button" onClick={() => setIssueStatus(issue.id, "open")}>{t("issue.reopen")}</button>
      ) : (
        <button className="primary-button" onClick={() => setIssueStatus(issue.id, "resolved")}>{t("issue.resolve")}</button>
      )}
    </div>
  );

  return (
    <section>
      {hideHeader ? (
        /* ONE control level: the trail starts from the left edge, the id
           and the status actions sit pinned to the right edge of the same
           row — the breadcrumb replaces the old titlebar entirely. Wraps
           gracefully on narrow screens: the trail takes the space it needs
           while the id + actions stay together at the right. */
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", marginBottom: 16 }}>
          {crumbs ? <Breadcrumb items={crumbs} style={{ flex: "1 1 240px", marginBottom: 0, minWidth: 0 }} /> : null}
          <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
            <span className="titlebar-meta">{issue.id}</span>
            {statusActions}
          </div>
        </div>
      ) : (
        /* Compact title bar: back arrow, issue title and id on ONE row, with
            the status actions at the right edge — same pattern as the project
            page's titlebar. */
        <div className="titlebar">
          <button aria-label={t("common.back")} className="tertiary-button" onClick={onBack} title={t("common.back")} type="button">
            <ArrowLeft size={16} />
          </button>
          <h2>{issue.title}</h2>
          <span className="titlebar-meta">{issue.id}</span>
          {statusActions}
        </div>
      )}

      <div className="chips" style={{ marginBottom: 16 }}>
        <SeverityBadge label={t(SEVERITY_KEYS[issue.severity])} severity={issue.severity} />
        <IssueStatusBadge label={t(ISSUE_STATUS_KEYS[issue.status])} status={issue.status} />
        <span className="chip">{project?.name ?? "—"}</span>
        <span className="chip">{`${t("common.assignee")}: ${issue.assignee}`}</span>
        <span className="chip">{`${t("issue.created")}: ${formatRelative(issue.createdAt)}`}</span>
      </div>

      <div className="grid-2">
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="panel">
            <div className="panel-head">
              <h3 className="panel-title">{t("issue.message")}</h3>
            </div>
            <pre>{issue.message}</pre>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3 className="panel-title">{t("issue.steps")}</h3>
            </div>
            <ol className="step-list">
              {issue.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="panel">
            <div className="panel-head">
              <h3 className="panel-title">{t("issue.linkedRun")}</h3>
            </div>
            {linkedRun && onOpenRun ? (
              <button className="health-row" onClick={() => onOpenRun(linkedRun)}>
                <span className="table-link" style={{ flex: 1 }}>{linkedRun}</span>
                <span className="muted">{t("common.open")}</span>
              </button>
            ) : (
              <p className="muted">{t("issue.noRun")}</p>
            )}
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3 className="panel-title">{t("issue.history")}</h3>
            </div>
            <ul className="timeline">
              {[...issue.history].reverse().map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <span className="t-meta">{formatDateTime(event.at)}</span>
                  <span><strong>{event.actor}</strong> {t(event.labelKey)}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="muted">{`${t("issue.updated")}: ${formatDateTime(issue.updatedAt)}`}</p>
        </div>
      </div>
    </section>
  );
}
