import { ChevronRight, Square } from "lucide-react";
import type { Column } from "../../shared/ui/DataTable";
import type { Run, RunStatus } from "../../lib/demo/data";
import { projectById, runTrigger } from "../../lib/demo/data";
import { formatDateTime, formatDuration, formatRelative } from "../../lib/format";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { RunStatusBadge, SimulatedBadge } from "../../shared/ui/StatusBadge";

export const RUN_STATUS_KEYS: Record<RunStatus, TranslationKey> = {
  passed: "status.passed",
  failed: "status.failed",
  running: "status.running",
  pending: "status.pending",
  cancelled: "status.cancelled"
};

/** The standard run table row set, shared by Overview, Runs and drill-downs.
 *  `omitProject` drops the Project column inside project-scoped views.
 *  `onCancel` arms the last cell with a stop button on live rows (running /
 *  pending) — pages that shouldn't offer cancellation just leave it out. */
export function useRunColumns(onOpen: (run: Run) => void, { omitProject = false, onCancel }: { omitProject?: boolean; onCancel?: (run: Run) => void } = {}): Column<Run>[] {
  const { t } = useT();

  return [
    {
      key: "name",
      header: t("common.name"),
      render: (run) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="table-link">{run.name}</span>
          {runTrigger(run) === "simulated" ? <SimulatedBadge label={t("run.simulated")} title={t("run.simulatedHint")} /> : null}
        </span>
      )
    },
    ...(omitProject ? [] : [{ key: "project", header: t("common.project"), render: (run: Run) => projectById(run.projectId)?.name ?? "—" }]),
    {
      key: "status",
      header: t("common.status"),
      render: (run) => <RunStatusBadge label={t(RUN_STATUS_KEYS[run.status])} status={run.status} />
    },
    {
      align: "end",
      key: "tests",
      header: t("common.tests"),
      render: (run) => {
        if (run.status === "passed" || run.status === "failed") return <span className="num">{`${run.passed}/${run.total}`}</span>;
        if (run.status === "running") return <span className="num">{`${run.progress ?? 0}%`}</span>;
        return "…";
      }
    },
    {
      align: "end",
      key: "duration",
      header: t("common.duration"),
      render: (run) => {
        if (run.durationSec > 0) return formatDuration(run.durationSec);
        // A live row has no stored duration yet — count up from its start.
        // The ~2s progress emits re-render the row while the suite runs,
        // so this ticks in every list that shows it.
        if (run.status === "running") return formatDuration(Math.max(0, Math.round((Date.now() - run.startedAt) / 1000)));
        return "…";
      }
    },
    {
      key: "date",
      header: t("common.date"),
      render: (run) => <span title={formatDateTime(run.startedAt)}>{run.startedAt > Date.now() ? "…" : formatRelative(run.startedAt)}</span>
    },
    {
      key: "open",
      header: "",
      render: (run) =>
        onCancel && (run.status === "running" || run.status === "pending") ? (
          <button
            aria-label={t("run.cancel")}
            className="tertiary-button"
            onClick={(event) => {
              // The row itself navigates — don't follow it when the intent
              // is to stop the run.
              event.stopPropagation();
              onCancel(run);
            }}
            style={{ padding: "2px 8px", color: "hsl(var(--destructive))" }}
            title={t("run.cancel")}
          >
            <Square size={13} /> {t("run.cancel")}
          </button>
        ) : (
          <ChevronRight size={15} style={{ color: "hsl(var(--muted-foreground))" }} />
        )
    }
  ];
}
