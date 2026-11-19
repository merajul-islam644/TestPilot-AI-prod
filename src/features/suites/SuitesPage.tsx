import { useState } from "react";
import { ChevronDown, FileCode2, Search } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { PLAYWRIGHT_SUITE_ID_PREFIX, derivedSuiteForProject, projects } from "../../lib/demo/data";
import type { Project, Suite } from "../../lib/demo/data";
import { useDemoState } from "../../lib/demo/store";
import { useSpecBlocks } from "../../lib/workspace/useSpecBlocks";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Select } from "../../shared/ui/select";
import { PlainSpecFiles } from "./SuiteDetailView";
import { useWorkspaceInfo, useWorkspaceInfos } from "../../shared/workspaceRegistry";
import { useWorkspaceBinding } from "../../shared/useWorkspaceBinding";
import { readSavedRoot } from "../workbench/data/useTestWorkspace";

export function SuitesPage() {
  const { navigate } = useRoute();
  const { t } = useT();
  // Subscribes to the domain store so this page re-renders once the gateway
  // load fills the projects catalog.
  useDemoState();
  // Subscribes to the workspace registry so project rows appear the moment
  // a folder opens (and disappear when it closes).
  useWorkspaceInfos();
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  // The list presents PROJECTS, not suites: one collapsible row per project
  // whose workspace opened (one derived "Playwright tests" suite each).
  // Expanding happens INLINE — the whole spec tree lives on this page, no
  // navigation. Computed per render: the projects catalog fills in place,
  // so a memo on its (unchanging) array reference would miss the gateway
  // load.
  const allRows = projects
    .map((project) => {
      const suite = derivedSuiteForProject(project.id);
      return suite ? { project, suite } : null;
    })
    .filter((entry): entry is { project: Project; suite: Suite } => entry !== null);
  const rows = allRows.filter(({ project }) => {
    if (projectFilter && project.id !== projectFilter) return false;
    if (query && !project.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <section>
      <PageHeader subtitle={t("suites.subtitle")} title={t("suites.title")} />

      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input onChange={(event) => setQuery(event.target.value)} placeholder={t("suites.searchPlaceholder")} value={query} />
        </label>
        <div className="toolbar-actions">
          <Select
            ariaLabel={t("common.project")}
            items={[
              { value: "", label: t("suites.filterProject") },
              ...projects.map((project) => ({ value: project.id, label: project.name }))
            ]}
            onChange={setProjectFilter}
            value={projectFilter}
          />
        </div>
      </div>

      {allRows.length === 0 ? (
        <EmptyState
          action={<button className="secondary-button" onClick={() => navigate("/projects")}>{t("suites.openProjects")}</button>}
          description={t("suites.noneDerivedDesc")}
          title={t("suites.noneDerivedTitle")}
        />
      ) : rows.length === 0 ? (
        <EmptyState description={t("common.notFound")} title={t("suites.empty")} />
      ) : (
        <div className="case-tree">
          {rows.map(({ project, suite }) => (
            <ProjectSuiteRow key={project.id} project={project} suite={suite} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One project's collapsible row + inline spec tree. Carries the same
 *  workspace plumbing as SuiteDetailView (local registry first, gateway
 *  binding fallback) so the parse works in every browser on the machine.
 *  Hooks live here — per-row — because the row count varies. */
function ProjectSuiteRow({ project, suite }: { project: Project; suite: Suite }) {
  const { t } = useT();
  const derivedProjectId = suite.id.startsWith(PLAYWRIGHT_SUITE_ID_PREFIX) ? suite.id.slice(PLAYWRIGHT_SUITE_ID_PREFIX.length) : null;
  const localWorkspace = useWorkspaceInfo(derivedProjectId ?? "");
  // A browser that never opened the folder (every data-viewer's browser)
  // has an EMPTY local registry — the gateway binding's spec list parses
  // the ENTIRE suite identically there (same model as SuiteDetailView).
  const binding = useWorkspaceBinding(derivedProjectId ?? "", !localWorkspace);
  const workspace = localWorkspace ?? (binding?.root ? {
    root: binding.root,
    filesCount: binding.specPaths?.length ?? 0,
    specPaths: binding.specPaths ?? [],
    updatedAt: 0
  } : null);
  const specPaths = derivedProjectId ? workspace?.specPaths ?? [] : [];
  const savedRoot = derivedProjectId ? readSavedRoot(derivedProjectId) : null;
  const runnerRoot = savedRoot?.mode === "runner"
    ? savedRoot.root
    : savedRoot
      ? null // a local FSA root can't be read here and must not fall back
      : binding?.mode === "runner" && binding.root ? binding.root : null;
  const blocks = useSpecBlocks(runnerRoot, specPaths, derivedProjectId ?? undefined);

  const [expanded, setExpanded] = useState(false);
  const tests = blocks !== null ? blocks.flatMap((group) => group.tests) : [];

  return (
    <div className={`case-file${expanded ? "" : " collapsed"}`}>
      <button
        aria-expanded={expanded}
        className="case-file-head"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <FileCode2 className="case-file-ico" size={13} aria-hidden />
        <span>{project.name}</span>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {blocks !== null
            ? `${tests.length} ${t("common.tests")}`
            : suite.description.split(" · ")[0]}
        </span>
        <ChevronDown className="case-file-chevron" size={15} aria-hidden />
      </button>
      <div className="case-file-body">
        <div className="case-file-body-inner">
          {blocks !== null && blocks.length > 0 ? (
            <div style={{ padding: "10px 12px" }}>
              <PlainSpecFiles blocks={blocks} />
            </div>
          ) : (
            /* Specs unreadable (runner offline, FSA workspace): fall back to
               the plain path list — never an empty expanded row. */
            <div className="case-tree" style={{ padding: "10px 12px" }}>
              {specPaths.length > 0 ? specPaths.map((path) => (
                <span className="mono" key={path} style={{ fontSize: 12.5 }}>{path}</span>
              )) : <p className="muted" style={{ margin: 0 }}>{t("suite.noRuns")}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
