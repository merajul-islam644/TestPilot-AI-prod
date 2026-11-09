import { useRoute } from "../../app/router/routes";
import { SuiteDetailView } from "./SuiteDetailView";

/** The sidebar route: /suites/:id — back goes to the global suites list.
 *  Thin wrapper over SuiteDetailView for the same circular-import reason
 *  documented in RunDetailPage. */
export function SuiteDetailPage() {
  const { params, navigate } = useRoute();
  return (
    <SuiteDetailView
      suiteId={params.suiteId ?? ""}
      onBack={() => navigate("/suites")}
      onOpenRun={(runId) => navigate(`/runs/${runId}`)}
    />
  );
}
