import { ChevronRight, Square } from "lucide-react";
import type { Column } from "../../shared/ui/DataTable";
import type { Run, RunStatus } from "../../lib/demo/data";
import { projectById, runTrigger } from "../../lib/demo/data";
import { formatDateTime, formatDuration, formatPercent, formatRelative } from "../../lib/format";
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
        return <span className="cell-muted">—</span>;
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
        return <span className="cell-muted">—</span>;
      }
    },
    {
      key: "date",
      header: t("common.date"),
      render: (run) => <span className="cell-muted" title={formatDateTime(run.startedAt)}>{run.startedAt > Date.now() ? "—" : formatRelative(run.startedAt)}</span>
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

/** The stats table set shared by Overview and Test runs: the project name
 *  plus the full per-run breakdown — status, total tests, passed, failed,
 *  duration, date and passing rate. Percent widths keep the columns in
 *  proportion at any panel size instead of one column swallowing the row.
 *  `onCancel` arms the tail cell with a stop button on live rows, same as
 *  the standard set. */
export function useRunStatsColumns({ onCancel }: { onCancel?: (run: Run) => void } = {}): Column<Run>[] {
  const { t } = useT();
  return [
    {
      key: "project",
      header: t("common.project"),
      render: (run) => <span className="table-link">{projectById(run.projectId)?.name ?? "—"}</span>,
      width: "23%"
    },
    {
      key: "status",
      header: t("common.status"),
      render: (run) => <RunStatusBadge label={t(RUN_STATUS_KEYS[run.status])} status={run.status} />,
      width: "13%"
    },
    /* Counts stay neutral white — the status badge is the row's color
       story, tinted numbers just turned mostly-cancelled tables grey.
       Widths sum to ~94% (+ the 40px tail) — under fixed layout every
       hint lands EXACTLY, so the gaps between columns stay even; the
       old auto layout re-measured per row and let voids drift. */
    { align: "end", key: "total", header: t("common.tests"), render: (run) => <span className="num">{run.total}</span>, width: "8%" },
    { align: "end", key: "passed", header: t("common.passed"), render: (run) => <span className="num">{run.passed}</span>, width: "7%" },
    { align: "end", key: "failed", header: t("common.failed"), render: (run) => <span className="num">{run.failed}</span>, width: "7%" },
    {
      align: "end",
      key: "duration",
      header: t("common.duration"),
      render: (run) => {
        if (run.durationSec > 0) return formatDuration(run.durationSec);
        // A live row has no stored duration yet — count up from its start.
        // The ~2s progress emits re-render the row while the suite runs,
        // so this ticks while the run executes.
        if (run.status === "running") return formatDuration(Math.max(0, Math.round((Date.now() - run.startedAt) / 1000)));
        return <span className="cell-muted">—</span>;
      },
      width: "11%"
    },
    {
      className: "col-gap-l",
      key: "date",
      header: t("common.date"),
      // Muted on purpose: the date is context, not a metric — it shouldn't
      // compete with the counts for the eye.
      render: (run) => <span className="cell-muted" title={formatDateTime(run.startedAt)}>{run.startedAt > Date.now() ? "—" : formatRelative(run.startedAt)}</span>,
      width: "15%"
    },
    {
      align: "end",
      key: "rate",
      header: t("overview.recent.passingRate"),
      render: (run) => {
        // Rate only means something once tests have finished; a live or
        // never-started row shows an em dash instead of a fake 0% or an
        // ellipsis that reads as "still loading".
        if (run.total > 0 && run.status !== "running" && run.status !== "pending") {
          return <span className="num">{formatPercent(run.passed / run.total, 1)}</span>;
        }
        return <span className="num cell-muted">—</span>;
      },
      width: "10%"
    },
    {
      // Pinned to the row's far right edge — 40px keeps the chevron snug
      // against the border; auto layout still grows the column if a live
      // row's wider stop button lands here, never clipping content.
      align: "end",
      key: "open",
      header: "",
      width: "40px",
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
            type="button"
          >
            <Square size={13} /> {t("run.cancel")}
          </button>
        ) : (
          <ChevronRight size={15} style={{ color: "hsl(var(--muted-foreground))" }} />
        )
    }
  ];
}
