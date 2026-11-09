import { useMemo, useState } from "react";
import { useRoute } from "../../app/router/routes";
import { derivedSuiteForProject, projectById, projects } from "../../lib/demo/data";
import type { Suite, SuiteStatus } from "../../lib/demo/data";
import { useDemoState } from "../../lib/demo/store";
import { formatRelative } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";
import { Select } from "../../shared/ui/select";
import { SuiteStatusBadge } from "../../shared/ui/StatusBadge";
import { useWorkspaceInfos } from "../../shared/workspaceRegistry";

const SUITE_STATUS_KEYS: Record<SuiteStatus, "suite.active" | "suite.draft" | "suite.archived"> = {
  active: "suite.active",
  draft: "suite.draft",
  archived: "suite.archived"
};

export function SuitesPage() {
  const { navigate } = useRoute();
  const { t } = useT();
  // Subscribes to the domain store so this page re-renders once the gateway
  // load fills the projects catalog.
  useDemoState();
  // Subscribes to the workspace registry so derived suites appear the
  // moment a folder opens (and disappear when it closes).
  useWorkspaceInfos();
  const [statusFilter, setStatusFilter] = useState<SuiteStatus | "all">("all");
  const [projectFilter, setProjectFilter] = useState("");

  // Suites derive from each project's opened workspace (Rasta B) — one
  // "Playwright tests" suite per project with runnable specs, nothing else.
  // Computed per render: the projects catalog fills in place, so a memo on
  // its (unchanging) array reference would miss the gateway load.
  const derivedSuites: Suite[] = projects
    .map((project) => derivedSuiteForProject(project.id))
    .filter((suite): suite is Suite => suite !== null);

  const filtered = useMemo(() => derivedSuites.filter((suite) => {
    if (statusFilter !== "all" && suite.status !== statusFilter) return false;
    if (projectFilter && suite.projectId !== projectFilter) return false;
    return true;
  }), [derivedSuites, projectFilter, statusFilter]);

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
          <Select
            ariaLabel={t("common.project")}
            items={[
              { value: "", label: t("runs.filterProject") },
              ...projects.map((project) => ({ value: project.id, label: project.name }))
            ]}
            onChange={setProjectFilter}
            value={projectFilter}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        derivedSuites.length === 0 ? (
          <EmptyState
            action={<button className="secondary-button" onClick={() => navigate("/projects")}>{t("suites.openProjects")}</button>}
            description={t("suites.noneDerivedDesc")}
            title={t("suites.noneDerivedTitle")}
          />
        ) : (
          <EmptyState description={t("common.notFound")} title={t("suites.empty")} />
        )
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
