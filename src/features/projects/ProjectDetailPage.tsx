import { useMemo, useState } from "react";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { useShell } from "../../app/layout/ShellContext";
import { derivedSuiteForProject, projectById } from "../../lib/demo/data";
import { cancelRun, deleteProject, useDemoState } from "../../lib/demo/store";
import { useWorkspaceInfo } from "../../shared/workspaceRegistry";
import { formatDate, formatPercent, formatRelative, healthDotClass, healthFromRate } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { ChartCard, ChartLegend } from "../../shared/charts/ChartCard";
import { StackedColumns } from "../../shared/charts/StackedColumns";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { StatusBadge, SuiteStatusBadge } from "../../shared/ui/StatusBadge";
import { Tabs } from "../../shared/ui/Tabs";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { ProjectFormModal } from "./ProjectFormModal";
import { ProjectTestsTab } from "./ProjectTestsTab";
// The detail VIEWS (not the route pages) are imported here on purpose:
// the route pages pull in app/router/routes.tsx, which imports this page
// back — importing them here would close a circular module graph and
// vite would full-reload the page on every HMR update inside the cycle
// (which used to kill an in-flight run dispatch).
import { IssueDetailView } from "../issues/IssueDetailView";
import { useIssueColumns } from "../issues/issueColumns";
import { RunDetailView } from "../runs/RunDetailView";
import { useRunColumns } from "../runs/runColumns";
import { SuiteDetailView } from "../suites/SuiteDetailView";
import { ProjectIcon } from "./ProjectIcon";

type Tab = "summary" | "runs" | "suites" | "tests" | "issues" | "activity";
const TAB_IDS: Tab[] = ["summary", "runs", "suites", "tests", "issues", "activity"];
const DAY_MS = 86_400_000;

/** In-context drill-down: opens run/issue/suite detail INSIDE the project
 *  page — never the sidebar's global pages. A linked list so Back walks
 *  out one level at a time (issue → run → list). */
type DrillKind = "run" | "issue" | "suite";
type Drill = { kind: DrillKind; id: string; prev: Drill | null };
const DRILL_KINDS: DrillKind[] = ["run", "issue", "suite"];

/** The active tab lives in the URL (?tab=…), so a refresh or a shared
 *  link reopens the same view. Unknown/missing param → Summary. */
function initialTab(): Tab {
  try {
    const param = new URLSearchParams(window.location.search).get("tab");
    return TAB_IDS.includes(param as Tab) ? (param as Tab) : "summary";
  } catch {
    return "summary";
  }
}

/** Restores a drilled detail after a refresh (?sub=run:<id>). One level
 *  only — the full stack is session memory. */
function initialDrill(): Drill | null {
  try {
    const raw = new URLSearchParams(window.location.search).get("sub") ?? "";
    const sep = raw.indexOf(":");
    const kind = sep > 0 ? raw.slice(0, sep) : "";
    const id = sep > 0 ? raw.slice(sep + 1) : "";
    return DRILL_KINDS.includes(kind as DrillKind) && id ? { kind: kind as DrillKind, id, prev: null } : null;
  } catch {
    return null;
  }
}

export function ProjectDetailPage() {
  const { params, navigate } = useRoute();
  const { runs, issues } = useDemoState();
  const { openNewRun } = useShell();
  const { t } = useT();
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [drill, setDrill] = useState<Drill | null>(initialDrill);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Tab switches are written into the URL with replaceState (no history
  // spam): /projects/:id?tab=tests. "summary" is the default and stays
  // query-free, so the plain project URL always opens the overview.
  // A drill adds ?sub=<kind>:<id> on top of the current tab.
  function setTab(next: Tab) {
    setTabState(next);
    setDrill(null);
    try {
      const url = new URL(window.location.href);
      if (next === "summary") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      url.searchParams.delete("sub");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    } catch {
      /* URL api unavailable — tab still switches, just not recorded */
    }
  }

  function openDrill(kind: DrillKind, id: string) {
    setDrill((current) => ({ kind, id, prev: current }));
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("sub", `${kind}:${id}`);
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    } catch {
      /* URL api unavailable — drill still opens */
    }
  }

  function closeDrill() {
    setDrill((current) => {
      const prev = current?.prev ?? null;
      try {
        const url = new URL(window.location.href);
        if (prev) url.searchParams.set("sub", `${prev.kind}:${prev.id}`);
        else url.searchParams.delete("sub");
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      } catch {
        /* URL api unavailable — drill still closes */
      }
      return prev;
    });
  }

  // Project-scoped drill callbacks: every row/link inside this page lands
  // here instead of the sidebar's global run/issue/suite routes. Live rows
  // get the same stop button as the global runs list.
  const runColumns = useRunColumns((run) => openDrill("run", run.id), { omitProject: true, onCancel: (run) => cancelRun(run.id) });
  const issueColumns = useIssueColumns((issue) => openDrill("issue", issue.id), { omitProject: true });

  const project = projectById(params.projectId ?? "");
  const projectRuns = useMemo(() => runs.filter((run) => run.projectId === params.projectId), [params.projectId, runs]);
  const projectIssues = useMemo(() => issues.filter((issue) => issue.projectId === params.projectId), [issues, params.projectId]);
  // Suites derive from the opened workspace (Rasta B) — the registry
  // subscription makes this re-render when a folder opens or closes.
  const workspace = useWorkspaceInfo(params.projectId ?? "");
  const derivedSuite = params.projectId ? derivedSuiteForProject(params.projectId) : null;

  // Per-day passed/failed for this project, last 30 days.
  const activity = useMemo(() => {
    const buckets = new Map<number, { base: number; label: string; top: number }>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    for (let offset = 29; offset >= 0; offset--) {
      const dayStart = todayStart - offset * DAY_MS;
      buckets.set(dayStart, {
        base: 0,
        label: new Date(dayStart).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        top: 0
      });
    }
    for (const run of projectRuns) {
      if (run.status !== "passed" && run.status !== "failed") continue;
      const runDay = new Date(run.startedAt);
      runDay.setHours(0, 0, 0, 0);
      const bucket = buckets.get(runDay.getTime());
      if (!bucket) continue;
      bucket.base += run.passed;
      bucket.top += run.failed;
    }
    return [...buckets.values()];
  }, [projectRuns]);

  // Same rule as the Overview chart: with no finished runs in the window the
  // columns chart would draw axes and labels but zero bars — show the empty
  // state instead.
  const hasActivity = activity.some((day) => day.base + day.top > 0);

  if (!project) {
    return (
      <section>
        <button className="tertiary-button" onClick={() => navigate("/projects")}><ArrowLeft size={16} /> {t("common.back")}</button>
        <EmptyState description={t("projects.notFound")} title={t("common.error")} />
      </section>
    );
  }

  const last30 = projectRuns.filter((run) => run.startedAt >= Date.now() - 30 * DAY_MS);
  const totalTests = last30.reduce((sum, run) => sum + run.total, 0);
  const passedTests = last30.reduce((sum, run) => sum + run.passed, 0);
  const failedTests = last30.reduce((sum, run) => sum + run.failed, 0);
  const successRate = passedTests + failedTests > 0 ? (passedTests / (passedTests + failedTests)) * 100 : 0;
  const health = healthFromRate(successRate);
  const openIssues = projectIssues.filter((issue) => issue.status !== "resolved").length;
  const latestRun = [...projectRuns].sort((a, b) => b.startedAt - a.startedAt).find((run) => run.status === "passed" || run.status === "failed");

  const tabs: { id: Tab; label: string }[] = [
    { id: "summary", label: t("projects.tabSummary") },
    { id: "runs", label: t("projects.tabRuns") },
    { id: "suites", label: t("projects.tabSuites") },
    { id: "tests", label: t("projects.tabTests") },
    { id: "issues", label: t("projects.tabIssues") },
    { id: "activity", label: t("projects.tabActivity") }
  ];

  return (
    <section>
      {/* One Back at a time: while a run/issue/suite detail is drilled in,
          only its own Back (which closes the drill) shows — two identical
          Backs stacked read as a bug. The project Back returns when the
          drill closes. */}
      {!drill ? (
        <button className="tertiary-button" onClick={() => navigate("/projects")} style={{ marginBottom: 12 }}>
          <ArrowLeft size={16} /> {t("common.back")}
        </button>
      ) : null}
      <PageHeader
        actions={(
          <>
            <button className="secondary-button" onClick={() => setFormOpen(true)}>
              <Pencil size={15} /> {t("common.edit")}
            </button>
            <button className="danger-button" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={15} /> {t("common.delete")}
            </button>
            <button className="primary-button" onClick={openNewRun}>
              <Plus size={16} /> {t("overview.newRun")}
            </button>
          </>
        )}
        subtitle={project.description}
        title={project.name}
      />

      <div className="chips" style={{ marginBottom: 16 }}>
        <span className="badge badge-neutral">
          <span className={`health-dot ${healthDotClass(health.tone)}`} />
          {t(health.labelKey)}
        </span>
        {project.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}
      </div>

      {/* A drilled detail replaces the tabs AND tab content entirely — the
          project stays the context, the sidebar is never involved. */}
      {drill ? (
        drill.kind === "run" ? (
          <RunDetailView
            onBack={closeDrill}
            onOpenIssue={(issueId) => openDrill("issue", issueId)}
            runId={drill.id}
          />
        ) : drill.kind === "issue" ? (
          <IssueDetailView
            issueId={drill.id}
            onBack={closeDrill}
            onOpenRun={(runId) => openDrill("run", runId)}
          />
        ) : (
          <SuiteDetailView
            onBack={closeDrill}
            onOpenRun={(runId) => openDrill("run", runId)}
            suiteId={drill.id}
          />
        )
      ) : (
        <>
          <Tabs active={tab} onChange={setTab} tabs={tabs} />

          {tab === "summary" ? (
        <>
          <div className="grid">
            <div className="metric"><span>{t("projects.successRate")}</span><strong className="num">{formatPercent(successRate)}</strong></div>
            <div className="metric"><span>{t("projects.tabRuns")}</span><strong className="num">{last30.length}</strong></div>
            <div className="metric"><span>{t("common.tests")}</span><strong className="num">{totalTests}</strong></div>
            <div className="metric"><span>{t("projects.openIssues")}</span><strong className="num" style={openIssues > 0 ? { color: "hsl(var(--destructive))" } : undefined}>{openIssues}</strong></div>
          </div>
          <div className="grid-2">
            <div className="panel">
              <div className="panel-head">
                <h3 className="panel-title">{t("projects.about")}</h3>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                <div className="chips">
                  <ProjectIcon icon={project.icon} />
                  <span className="chip">{`${derivedSuite ? 1 : 0} ${t("projects.suitesLabel")}`}</span>
                  <span className="chip">{`${t("projects.created")}: ${formatDate(project.createdAt)}`}</span>
                </div>
                <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{project.description}</p>
              </div>
            </div>
            <div className="panel">
              <div className="panel-head">
                <h3 className="panel-title">{t("projects.latestRun")}</h3>
              </div>
              {latestRun ? (
                <button className="health-row" onClick={() => openDrill("run", latestRun.id)}>
                  <span className="table-link" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{latestRun.name}</span>
                  <StatusBadge tone={latestRun.status === "passed" ? "passed" : "failed"}>
                    {t(latestRun.status === "passed" ? "status.passed" : "status.failed")}
                  </StatusBadge>
                  <span className="muted">{formatRelative(latestRun.startedAt)}</span>
                </button>
              ) : (
                <p className="muted">{t("projects.emptyRuns")}</p>
              )}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3 className="panel-title">{t("projects.workspace.title")}</h3>
            </div>
            {workspace ? (
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{workspace.root.split(/[\\/]/).pop() || workspace.root}</strong>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workspace.root}</div>
                </div>
                <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                  <span className="chip">{workspace.filesCount} {t("projects.workspace.filesLabel")}</span>
                  <span className="chip">{workspace.specPaths.length} {t("suite.specCount")}</span>
                  <button className="secondary-button" onClick={() => setTab("tests")}>{t("suites.openTestsTab")}</button>
                </div>
              </div>
            ) : (
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
                <p className="muted" style={{ margin: 0 }}>{t("projects.workspace.none")}</p>
                <button className="secondary-button" onClick={() => setTab("tests")}>{t("suites.openTestsTab")}</button>
              </div>
            )}
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3 className="panel-title">{t("projects.tabRuns")}</h3>
              <button className="link-button" onClick={() => setTab("runs")}>{t("common.viewAll")}</button>
            </div>
            <DataTable columns={runColumns} onRowClick={(run) => openDrill("run", run.id)} rows={projectRuns.slice(0, 6)} />
          </div>
        </>
      ) : null}

      {tab === "runs" ? (
        projectRuns.length > 0 ? (
          <DataTable columns={runColumns} onRowClick={(run) => openDrill("run", run.id)} rows={projectRuns} />
        ) : (
          <EmptyState
            action={<button className="secondary-button" onClick={() => setTab("tests")}>{t("suites.openTestsTab")}</button>}
            description={t("projects.emptyRuns")}
            title={t("projects.tabRuns")}
          />
        )
      ) : null}

      {tab === "suites" ? (
        derivedSuite ? (
          <DataTable
            columns={[
              {
                key: "name",
                header: t("common.name"),
                render: (suite) => (
                  <span style={{ display: "grid", gap: 2 }}>
                    <span className="table-link">{suite.name}</span>
                    <span className="muted" style={{ fontSize: 12.5 }}>{suite.description}</span>
                  </span>
                )
              },
              { key: "status", header: t("common.status"), render: (suite) => <SuiteStatusBadge label={t(suite.status === "active" ? "suite.active" : suite.status === "draft" ? "suite.draft" : "suite.archived")} status={suite.status} /> },
              { key: "owner", header: t("common.owner"), render: (suite) => suite.owner },
              { key: "updated", header: t("suite.lastUpdated"), render: (suite) => formatRelative(suite.lastUpdatedAt) }
            ]}
            onRowClick={(suite) => openDrill("suite", suite.id)}
            rows={[derivedSuite]}
          />
        ) : (
          <EmptyState
            action={<button className="secondary-button" onClick={() => setTab("tests")}>{t("suites.openTestsTab")}</button>}
            description={t("suites.noneDerivedDesc")}
            title={t("suites.noneDerivedTitle")}
          />
        )
      ) : null}

      {tab === "tests" ? <ProjectTestsTab project={project} /> : null}

      {tab === "issues" ? (
        projectIssues.length > 0 ? (
          <DataTable columns={issueColumns} onRowClick={(issue) => openDrill("issue", issue.id)} rows={projectIssues} />
        ) : (
          <EmptyState
            action={<button className="secondary-button" onClick={() => setTab("tests")}>{t("suites.openTestsTab")}</button>}
            description={t("issues.empty")}
            title={t("projects.tabIssues")}
          />
        )
      ) : null}

      {tab === "activity" ? (
        hasActivity ? (
          <ChartCard
            description={t("overview.activity.desc")}
            legend={<ChartLegend items={[{ color: "var(--chart-failed)", label: t("common.failed") }, { color: "var(--chart-context)", label: t("common.passed") }]} />}
            table={{
              head: [t("common.date"), t("common.passed"), t("common.failed")],
              rows: [...activity].reverse().map((day) => [day.label, String(day.base), String(day.top)])
            }}
            title={t("overview.activity.title")}
          >
            <StackedColumns
              ariaLabel={`${project.name} ${t("overview.activity.title")}`}
              baseLabel={t("common.passed")}
              data={activity}
              topLabel={t("common.failed")}
            />
          </ChartCard>
        ) : (
          <EmptyState
            action={<button className="secondary-button" onClick={() => setTab("tests")}>{t("suites.openTestsTab")}</button>}
            description={t("overview.activity.emptyDesc")}
            title={t("overview.activity.emptyTitle")}
          />
        )
      ) : null}
        </>
      )}

      {formOpen ? <ProjectFormModal onClose={() => setFormOpen(false)} project={project} /> : null}
      {confirmingDelete ? (
        <ConfirmDialog
          confirmLabel={t("common.delete")}
          message={`${project.name} — ${t("projects.deleteConfirm")}`}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            deleteProject(project.id);
            navigate("/projects");
          }}
          title={t("projects.deleteTitle")}
        />
      ) : null}
    </section>
  );
}
