import { useRoute } from "../../app/router/routes";
import { useDemoState } from "../../lib/demo/store";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { RunDetailView } from "./RunDetailView";

/** The sidebar route: /runs/:id. The breadcrumb carries the trail the user
 *  actually walked — Overview rows land here with ?from=overview and read
 *  Overview › run, while the Test runs board keeps its own
 *  Test runs › run trail. The trail is handed to the view so it renders
 *  INSIDE the centered section — a sibling would hug main's edge and
 *  misalign with the content below. Thin wrapper over RunDetailView for
 *  the circular-import reason documented above. */
export function RunDetailPage() {
  const { params, navigate, search } = useRoute();
  const { runs } = useDemoState();
  const { t } = useT();
  const runId = params.runId ?? "";
  const run = runs.find((entry) => entry.id === runId);

  const crumbs = new URLSearchParams(search).get("from") === "overview" && run
    ? [
        { label: t("nav.overview"), onClick: () => navigate("/") },
        { label: run.name }
      ]
    : [
        { label: t("nav.runs"), onClick: () => navigate("/runs") },
        { label: run?.name ?? runId }
      ];

  return (
    <RunDetailView
      crumbs={crumbs}
      hideHeader
      runId={runId}
      onBack={() => navigate("/runs")}
      onOpenIssue={(issueId) => navigate(`/issues/${issueId}`)}
    />
  );
}
