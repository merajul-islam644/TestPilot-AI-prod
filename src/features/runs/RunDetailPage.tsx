import { useRoute } from "../../app/router/routes";
import { RunDetailView } from "./RunDetailView";

/** The sidebar route: /runs/:id — back goes to the global runs list,
 *  cross-links go to the global pages. Kept as a thin wrapper over
 *  RunDetailView so the project page can embed the view without
 *  importing the route module (routes.tsx imports this page back,
 *  which would make the graph circular and force vite full reloads). */
export function RunDetailPage() {
  const { params, navigate } = useRoute();
  return (
    <RunDetailView
      runId={params.runId ?? ""}
      onBack={() => navigate("/runs")}
      onOpenIssue={(issueId) => navigate(`/issues/${issueId}`)}
    />
  );
}
