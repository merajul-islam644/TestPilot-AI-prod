import { useRoute } from "../../app/router/routes";
import { projectById } from "../../lib/demo/data";
import { useDemoState } from "../../lib/demo/store";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { IssueDetailView } from "./IssueDetailView";

/** The sidebar route: /issues/:id. The breadcrumb carries the board's
 *  hierarchy — Issues › Project › this issue — so every earlier level is
 *  one click away; the back arrow follows the immediate parent (the
 *  project's issues page) when the issue's project is known. The trail is
 *  handed to the view so it renders INSIDE the centered section — a
 *  sibling would hug main's edge and misalign with the content below.
 *  Thin wrapper over IssueDetailView for the circular-import reason
 *  documented in RunDetailPage. */
export function IssueDetailPage() {
  const { params, navigate } = useRoute();
  const { issues } = useDemoState();
  const { t } = useT();
  const issueId = params.issueId ?? "";
  const issue = issues.find((entry) => entry.id === issueId);
  const project = issue ? projectById(issue.projectId) : undefined;

  return (
    <IssueDetailView
      crumbs={[
        { label: t("nav.issues"), onClick: () => navigate("/issues") },
        ...(project ? [{ label: project.name, onClick: () => navigate(`/issues/project/${project.id}`) }] : []),
        { label: issue?.title ?? issueId }
      ]}
      hideHeader
      issueId={issueId}
      onBack={() => (project ? navigate(`/issues/project/${project.id}`) : navigate("/issues"))}
      onOpenRun={(runId) => navigate(`/runs/${runId}`)}
    />
  );
}
