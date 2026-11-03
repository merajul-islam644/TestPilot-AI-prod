import { ChevronRight } from "lucide-react";
import type { Column } from "../../shared/ui/DataTable";
import type { Run, RunStatus } from "../../lib/demo/data";
import { projectById } from "../../lib/demo/data";
import { formatDateTime, formatDuration, formatRelative } from "../../lib/format";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { RunStatusBadge } from "../../shared/ui/StatusBadge";

export const RUN_STATUS_KEYS: Record<RunStatus, TranslationKey> = {
  passed: "status.passed",
  failed: "status.failed",
  running: "status.running",
  pending: "status.pending",
  cancelled: "status.cancelled"
};

/** The standard run table row set, shared by Overview, Runs and drill-downs.
 *  `omitProject` drops the Project column inside project-scoped views. */
export function useRunColumns(onOpen: (run: Run) => void, { omitProject = false }: { omitProject?: boolean } = {}): Column<Run>[] {
  const { t } = useT();

  return [
    { key: "name", header: t("common.name"), render: (run) => <span className="table-link">{run.name}</span> },
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
      render: (run) => (run.durationSec > 0 ? formatDuration(run.durationSec) : "…")
    },
    {
      key: "date",
      header: t("common.date"),
      render: (run) => <span title={formatDateTime(run.startedAt)}>{run.startedAt > Date.now() ? "…" : formatRelative(run.startedAt)}</span>
    },
    {
      key: "open",
      header: "",
      render: () => <ChevronRight size={15} style={{ color: "hsl(var(--muted-foreground))" }} />
    }
  ];
}
