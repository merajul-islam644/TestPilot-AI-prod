import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Play, Search } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { derivedSuiteForProject, projectById } from "../../lib/demo/data";
import type { RunStatus } from "../../lib/demo/data";
import { cancelRun, runPlaywrightTests, useActiveRunnerRun, useDemoState } from "../../lib/demo/store";
import { RUNNER_MAX_FILES } from "../../lib/runner/client";
import { localFolder } from "../../lib/workspace/localFolder";
import type { FolderNode } from "../../lib/workspace/localFolder";
import { collectImportedHelpers, isRunnableSpecPath } from "../../lib/workspace/importFiles";
import { useSpecBlocks } from "../../lib/workspace/useSpecBlocks";
import { useWorkspaceInfo } from "../../shared/workspaceRegistry";
import { useWorkspaceBinding } from "../../shared/useWorkspaceBinding";
import { getDefaultEnvironment } from "../../shared/useWorkspaceName";
import { DEFAULT_BASE_URL, readSavedRoot, readSavedSettings } from "../workbench/data/useTestWorkspace";
import { formatDate, formatPercent, formatRelative } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { ChartCard, ChartLegend } from "../../shared/charts/ChartCard";
import { StackedColumns } from "../../shared/charts/StackedColumns";
import { DataTable } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { Breadcrumb } from "../../shared/ui/Breadcrumb";
import { CaseTree } from "../../shared/ui/CaseTree";
import { Select } from "../../shared/ui/select";
import { StatusBadge, SuiteStatusBadge } from "../../shared/ui/StatusBadge";
import { Tabs } from "../../shared/ui/Tabs";
import { ProjectTestsTab } from "./ProjectTestsTab";
// The detail VIEWS (not the route pages) are imported here on purpose:
// the route pages pull in app/router/routes.tsx, which imports this page
// back — importing them here would close a circular module graph and
// vite would full-reload the page on every HMR update inside the cycle
// (which used to kill an in-flight run dispatch).
import { IssueDetailView } from "../issues/IssueDetailView";
import { useIssueColumns } from "../issues/issueColumns";
import { RunDetailView } from "../runs/RunDetailView";
import { RUN_STATUS_KEYS, useRunColumns } from "../runs/runColumns";
import { SuiteDetailView } from "../suites/SuiteDetailView";
import { ProjectIcon } from "./ProjectIcon";

type Tab = "summary" | "runs" | "suites" | "tests" | "issues" | "activity";
const TAB_IDS: Tab[] = ["tests", "summary", "suites", "runs", "issues", "activity"];
const DAY_MS = 86_400_000;
/** The runner refuses files over its per-file cap (mirrors NewRunModal). */
const RUNNER_FILE_CAP = 200_000;

/** In-context drill-down: opens run/issue/suite detail INSIDE the project
 *  page — never the sidebar's global pages. A linked list so Back walks
 *  out one level at a time (issue → run → list). */
type DrillKind = "run" | "issue" | "suite";
type Drill = { kind: DrillKind; id: string; prev: Drill | null };
const DRILL_KINDS: DrillKind[] = ["run", "issue", "suite"];

/** The active tab lives in the URL (?tab=…), so a refresh or a shared
 *  link reopens the same view. Unknown/missing param → Playwright Editor:
 *  the first tab, where the day-to-day authoring happens. */
function initialTab(): Tab {
  try {
    const param = new URLSearchParams(window.location.search).get("tab");
    return TAB_IDS.includes(param as Tab) ? (param as Tab) : "tests";
  } catch {
    return "tests";
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
  const { t } = useT();
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [drill, setDrill] = useState<Drill | null>(initialDrill);
  const [startingRun, setStartingRun] = useState(false);
  // This page IS the project scope, so its Run Tests skips the global
  // modal and dispatches this project's Playwright specs straight away.
  // It can only do that with an open runner-mode folder holding specs —
  // anything else (no folder, browser-picked folder, zero specs) keeps the
  // button disabled with the reason on hover.
  const localWorkspace = useWorkspaceInfo(params.projectId ?? "");
  // A browser that never opened the folder falls back to the gateway binding
  // (published by whichever browser did open it): same suite spec list, read
  // through the same runner on this machine. Run dispatch stays local-only —
  // canRunDirect still requires THIS browser's saved root below.
  const binding = useWorkspaceBinding(params.projectId ?? "", !localWorkspace);
  const workspaceInfo = localWorkspace ?? (binding?.root ? {
    root: binding.root,
    filesCount: binding.specPaths?.length ?? 0,
    specPaths: binding.specPaths ?? [],
    updatedAt: 0
  } : null);
  const activeRunnerRun = useActiveRunnerRun();
  const savedRoot = params.projectId ? readSavedRoot(params.projectId) : null;
  const canRunDirect = Boolean(
    savedRoot?.root
    && savedRoot.mode === "runner"
    && workspaceInfo
    && workspaceInfo.specPaths.length > 0
  );
  const runInFlight = activeRunnerRun?.projectId === params.projectId;

  // Static spec parse of the open runner-mode folder — this is what the
  // suites tab previews (every block and step, before anything runs) and
  // what a live run's tree hydrates against.
  const runnerRoot = savedRoot?.mode === "runner"
    ? savedRoot.root
    : savedRoot
      ? null
      : binding?.mode === "runner" && binding.root ? binding.root : null;
  const specPaths = useMemo(() => workspaceInfo?.specPaths ?? [], [workspaceInfo]);
  const blocks = useSpecBlocks(runnerRoot, specPaths);

  // Tab switches are written into the URL with replaceState (no history
  // spam): /projects/:id?tab=summary. "tests" (Playwright Editor) is the
  // first tab and the default, so it stays query-free — the plain project
  // URL opens the editor where the day-to-day work happens.
  // A drill adds ?sub=<kind>:<id> on top of the current tab.
  function setTab(next: Tab) {
    setTabState(next);
    setDrill(null);
    try {
      const url = new URL(window.location.href);
      if (next === "tests") url.searchParams.delete("tab");
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
  // Runs-tab filters — the global runs page's search + status pattern minus
  // the project select, because this page already IS the project scope.
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatus | "">("");
  const [runQuery, setRunQuery] = useState("");
  const filteredRuns = useMemo(() => projectRuns.filter((run) => {
    if (runStatusFilter && run.status !== runStatusFilter) return false;
    if (runQuery && !`${run.name} ${run.id}`.toLowerCase().includes(runQuery.toLowerCase())) return false;
    return true;
  }), [projectRuns, runQuery, runStatusFilter]);
  // Suites derive from the opened workspace (Rasta B) — the registry
  // subscription makes this re-render when a folder opens or closes. In a
  // browser without the folder, workspaceInfo carries the gateway binding.
  const workspace = workspaceInfo;
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
  const openIssues = projectIssues.filter((issue) => issue.status !== "resolved").length;
  const latestRun = [...projectRuns].sort((a, b) => b.startedAt - a.startedAt).find((run) => run.status === "passed" || run.status === "failed");

  const tabs: { id: Tab; label: string }[] = [
    { id: "tests", label: t("projects.tabTests") },
    { id: "summary", label: t("projects.tabSummary") },
    { id: "suites", label: t("projects.tabSuites") },
    { id: "runs", label: t("projects.tabRuns") },
    { id: "issues", label: t("projects.tabIssues") },
    { id: "activity", label: t("projects.tabActivity") }
  ];

  // Direct dispatch: the New Run modal's submit minus the form — this page
  // already knows the project. Reads the specs through the runner, hands
  // them to the store, then lands on the editor tab so the live milestones
  // are visible immediately.
  async function runProjectSpecs() {
    if (!project) return;
    const root = savedRoot?.root;
    const specPaths = workspaceInfo?.specPaths ?? [];
    if (!canRunDirect || startingRun || !root || specPaths.length === 0) return;
    setStartingRun(true);
    try {
      // Specs share the file budget with the code files they import — the
      // same shape the editor's dispatch sends. Specs-only starved the
      // helper set once: a spec's "../../support/test-base" import cannot
      // resolve when the helper never lands in the temp project, and the
      // runner answers 422 "could not load the specs". Helpers are now
      // discovered by FOLLOWING the specs' relative imports (transitively),
      // not by taking the first N code files alphabetically — a branch
      // switch that adds directories sorting before `support/` used to
      // starve the real helpers. `root` rides along so workspace .env
      // values reach the runner from disk (never app state).
      const selected = specPaths.slice(0, RUNNER_MAX_FILES);
      const files: { name: string; content: string }[] = [];
      for (const path of selected) {
        const content = await localFolder.readUserFile({ root, path });
        if (content !== null) files.push({ name: path, content });
      }
      const helperBudget = Math.max(0, RUNNER_MAX_FILES - files.length);
      if (helperBudget > 0) {
        const { tree } = await localFolder.listTree({ root });
        const walk = (nodes: FolderNode[]): string[] =>
          nodes.flatMap((node) => (node.kind === "dir" && node.children ? walk(node.children) : [node.path]));
        const helperPaths = await collectImportedHelpers({
          specPaths: selected,
          knownPaths: walk(tree),
          budget: helperBudget,
          read: (path) => localFolder.readUserFile({ root, path })
        });
        for (const path of helperPaths) {
          const content = await localFolder.readUserFile({ root, path });
          if (content && content.length > 0 && content.length <= RUNNER_FILE_CAP) files.push({ name: path, content });
        }
      }
      const sendable = files.filter((file) => file.content.length <= RUNNER_FILE_CAP);
      if (sendable.length === 0) {
        toast.error(t("tests.noSpecs"));
        setStartingRun(false);
        return;
      }
      const baseURL = readSavedSettings(project.id)?.baseURL || DEFAULT_BASE_URL;
      void runPlaywrightTests({
        projectId: project.id,
        environment: getDefaultEnvironment(),
        baseURL,
        root,
        files: sendable
      }).catch((error: unknown) => {
        // The dispatch already created a Running record, so this failure must
        // surface: a silent catch here once ate the runner's "could not load
        // the specs" 422 and the run just sat there with nothing to explain it.
        // A user cancel is not a failure — the runner answers the cancelled
        // dispatch with its own "Run cancelled" rejection and the store has
        // already parked the row, so no error toast (same policy as the
        // workbench console's cancel branch).
        const message = error instanceof Error ? error.message : String(error);
        if (/\bcancel/i.test(message)) return;
        toast.error(t("toast.runnerFailed"), {
          description: message.slice(0, 400)
        });
      });
      setStartingRun(false);
      setTab("tests");
    } catch (error) {
      toast.error(t("toast.runnerFailed"), {
        description: error instanceof Error ? error.message.slice(0, 200) : undefined
      });
      setStartingRun(false);
    }
  }

  // Trail labels for the drilled run/issue — resolved here so the JSX
  // below stays flat; the id is the fallback while a record is missing.
  const drilledRun = drill?.kind === "run" ? runs.find((entry) => entry.id === drill.id) : undefined;
  const drilledIssue = drill?.kind === "issue" ? issues.find((entry) => entry.id === drill.id) : undefined;

  return (
    <section>
      {/* One Back at a time: while a run/issue/suite detail is drilled in,
          only its own Back (which closes the drill) shows — two identical
          Backs stacked read as a bug. The project Back returns when the
          drill closes. */}
      {/* Same breadcrumb system as the other menus: Projects › <project>,
          rendered inside the section so the left edge aligns. It replaces
          the old back arrow + repeated heading on the top level; while a
          drill is open nothing shows here — the drill carries its own
          titlebar, and the project name already rides in its chips. */}
      {!drill ? (
        <Breadcrumb
          items={[
            { label: t("nav.projects"), onClick: () => navigate("/projects") },
            { label: project.name }
          ]}
        />
      ) : null}

      {/* A drilled detail replaces the tabs AND tab content entirely — the
          project stays the context, the sidebar is never involved. */}
      {drill ? (
        drill.kind === "run" ? (
          <RunDetailView
            /* Same breadcrumb system as the sidebar routes: the trail is
                <project> › <run> — the first crumb walks back to the tabs
                (closeDrill), so the back arrow + repeated heading go away
                and only the start time + cancel remain on the row. */
            crumbs={[
              { label: project.name, onClick: closeDrill },
              { label: drilledRun?.name ?? drill.id }
            ]}
            hideHeader
            onBack={closeDrill}
            onOpenIssue={(issueId) => openDrill("issue", issueId)}
            runId={drill.id}
          />
        ) : drill.kind === "issue" ? (
          <IssueDetailView
            /* <project> › <issue title> — same system: the first crumb is
                the way back to the tabs, the titlebar yields to the trail,
                and the id + status actions stay pinned to the right. */
            crumbs={[
              { label: project.name, onClick: closeDrill },
              { label: drilledIssue?.title ?? drill.id }
            ]}
            hideHeader
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
          {/* The project's primary action lives at TAB level — same row as
              the strip, right-aligned — not floating in the page header.
              Project-scoped: no modal, it runs this project's specs
              directly, and stays disabled until a folder is open. */}
          <Tabs
            active={tab}
            actions={(
              <button
                className="primary-button"
                disabled={!canRunDirect || startingRun || runInFlight}
                onClick={() => void runProjectSpecs()}
                title={!canRunDirect ? (savedRoot?.mode === "fsa" ? t("newRun.fsaHint") : t("projects.runDirectHint")) : undefined}
                type="button"
              >
                <Play size={16} /> {startingRun ? t("newRun.starting") : t("overview.newRun")}
              </button>
            )}
            onChange={setTab}
            tabs={tabs}
          />

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
          {/* Stacked full-width panels flow inside one gap — .panel has no
              margin of its own, so siblings would otherwise touch. */}
          <div className="stack">
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
            <DataTable columns={runColumns} fixed onRowClick={(run) => openDrill("run", run.id)} rows={projectRuns.slice(0, 6)} />
          </div>
          </div>
        </>
      ) : null}

      {tab === "runs" ? (
        projectRuns.length > 0 ? (
          <>
            <div className="toolbar">
              <label className="search-box">
                <Search size={15} />
                <input onChange={(event) => setRunQuery(event.target.value)} placeholder={t("runs.searchPlaceholder")} value={runQuery} />
              </label>
              <div className="toolbar-actions">
                <Select
                  ariaLabel={t("common.status")}
                  items={[
                    { value: "", label: t("runs.filterStatus") },
                    ...(Object.keys(RUN_STATUS_KEYS) as RunStatus[]).map((status) => ({ value: status, label: t(RUN_STATUS_KEYS[status]) }))
                  ]}
                  onChange={(value) => setRunStatusFilter(value as RunStatus | "")}
                  value={runStatusFilter}
                />
              </div>
            </div>
            {filteredRuns.length > 0 ? (
              <DataTable columns={runColumns} fixed onRowClick={(run) => openDrill("run", run.id)} rows={filteredRuns} />
            ) : (
              <EmptyState description={t("common.notFound")} title={t("runs.empty")} />
            )}
          </>
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
          <>
            {/* Suite hero + recent runs flow inside one gap (see .stack). */}
            <div className="stack">
            {/* Suite hero: what the derived suite IS (specs + folder) and its
                two actions. Run suite reuses the tab-level direct dispatch,
                so it obeys the same disabled rules as Run Tests. */}
            <div className="panel">
              <div className="suite-hero">
                <div style={{ minWidth: 0 }}>
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <h3 className="suite-hero-name">{derivedSuite.name}</h3>
                    <SuiteStatusBadge label={t("suite.active")} status={derivedSuite.status} />
                  </div>
                  <p className="muted" style={{ margin: "4px 0 10px" }}>{derivedSuite.description}</p>
                  <div className="chips">
                    <span className="chip">{t("common.owner")}: {derivedSuite.owner}</span>
                    <span className="chip">{t("suite.lastUpdated")}: {formatRelative(derivedSuite.lastUpdatedAt)}</span>
                  </div>
                </div>
                <div style={{ alignItems: "center", display: "flex", flexShrink: 0, flexWrap: "wrap", gap: 8 }}>
                  <button className="secondary-button" onClick={() => setTab("tests")}>{t("suites.openTestsTab")}</button>
                  <button
                    className="primary-button"
                    disabled={!canRunDirect || startingRun || runInFlight}
                    onClick={() => void runProjectSpecs()}
                    title={!canRunDirect ? (savedRoot?.mode === "fsa" ? t("newRun.fsaHint") : t("projects.runDirectHint")) : undefined}
                    type="button"
                  >
                    <Play size={16} /> {startingRun ? t("newRun.starting") : t("suite.runNow")}
                  </button>
                </div>
              </div>
            </div>
            {/* The folder's whole suite as a tree — every block and its steps,
                visible the moment the folder opens (nothing has run yet, so
                every dot shows Not run). The run tree on the runs tab fills
                these dots in as results land. */}
            {blocks && blocks.length > 0 ? (
              <div className="panel">
                <div className="panel-head">
                  <h3 className="panel-title">{t("suite.specBlocks")}</h3>
                  <span className="muted">
                    {blocks.reduce((sum, group) => sum + group.tests.length, 0)} {t("common.tests")}
                  </span>
                </div>
                <CaseTree cases={[]} files={blocks} />
              </div>
            ) : null}
            {/* This project's runs ARE this suite's runs (one derived suite
                per project), so recent runs = the project's latest five. */}
            <div className="panel">
              <div className="panel-head">
                <h3 className="panel-title">{t("suite.recentRuns")}</h3>
                <button className="link-button" onClick={() => setTab("runs")}>{t("common.viewAll")}</button>
              </div>
              {projectRuns.length > 0 ? (
                <DataTable columns={runColumns} fixed onRowClick={(run) => openDrill("run", run.id)} rows={projectRuns.slice(0, 5)} />
              ) : (
                <p className="muted">{t("suite.noRuns")}</p>
              )}
            </div>
            </div>
          </>
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

    </section>
  );
}
