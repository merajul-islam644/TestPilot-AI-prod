import { useRoute } from "../../app/router/routes";
import { IssueDetailView } from "./IssueDetailView";

/** The sidebar route: /issues/:id — back goes to the global issues list.
 *  Thin wrapper over IssueDetailView for the same circular-import reason
 *  documented in RunDetailPage. */
export function IssueDetailPage() {
  const { params, navigate } = useRoute();
  return (
    <IssueDetailView
      issueId={params.issueId ?? ""}
      onBack={() => navigate("/issues")}
      onOpenRun={(runId) => navigate(`/runs/${runId}`)}
    />
  );
}
