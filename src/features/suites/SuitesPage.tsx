import { useMemo, useState } from "react";
import { useRoute } from "../../app/router/routes";
import { projectById, projects, suites } from "../../lib/demo/data";
import type { Suite, SuiteStatus } from "../../lib/demo/data";
import { useDemoState } from "../../lib/demo/store";
import { formatRelative } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";
import { SuiteStatusBadge } from "../../shared/ui/StatusBadge";

const SUITE_STATUS_KEYS: Record<SuiteStatus, "suite.active" | "suite.draft" | "suite.archived"> = {
  active: "suite.active",
  draft: "suite.draft",
  archived: "suite.archived"
};

export function SuitesPage() {
  const { navigate } = useRoute();
  const { t } = useT();
  // Subscribes to the domain store so this page re-renders once the gateway
  // load fills the projects/suites catalogs.
  useDemoState();
  const [statusFilter, setStatusFilter] = useState<SuiteStatus | "all">("all");
  const [projectFilter, setProjectFilter] = useState("");

  const filtered = useMemo(() => suites.filter((suite: Suite) => {
    if (statusFilter !== "all" && suite.status !== statusFilter) return false;
    if (projectFilter && suite.projectId !== projectFilter) return false;
    return true;
  }), [projectFilter, statusFilter]);

  const statusOptions: SegmentOption<SuiteStatus | "all">[] = [
    { id: "all", label: t("common.all") },
    { id: "active", label: t("suite.active") },
    { id: "draft", label: t("suite.draft") },
    { id: "archived", label: t("suite.archived") }
  ];

  return (
    <section>
      <PageHeader subtitle={t("suites.subtitle")} title={t("suites.title")} />

      <div className="toolbar">
        <Segmented onChange={(id) => setStatusFilter(id)} options={statusOptions} value={statusFilter} />
        <div className="toolbar-actions">
          <select aria-label={t("common.project")} className="inline-select" onChange={(event) => setProjectFilter(event.target.value)} value={projectFilter}>
            <option value="">{t("runs.filterProject")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState description={t("common.notFound")} title={t("suites.empty")} />
      ) : (
        <DataTable
          columns={[
            { key: "name", header: t("common.name"), render: (suite) => (
              <span style={{ display: "grid", gap: 2 }}>
                <span className="table-link">{suite.name}</span>
                <span className="muted" style={{ fontSize: 12.5 }}>{suite.description}</span>
              </span>
            ) },
            { key: "project", header: t("common.project"), render: (suite) => projectById(suite.projectId)?.name ?? "—" },
            { key: "status", header: t("common.status"), render: (suite) => <SuiteStatusBadge label={t(SUITE_STATUS_KEYS[suite.status])} status={suite.status} /> },
            { key: "owner", header: t("common.owner"), render: (suite) => suite.owner },
            { key: "updated", header: t("suite.lastUpdated"), render: (suite) => formatRelative(suite.lastUpdatedAt) }
          ]}
          onRowClick={(suite) => navigate(`/suites/${suite.id}`)}
          rows={filtered}
        />
      )}
    </section>
  );
}
