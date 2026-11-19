import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Bug, ChevronDown, CircleCheck, CircleX, Copy, FlaskConical, Gauge, ListChecks, ListOrdered, LoaderCircle, Play, Search } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { useIsDataViewer } from "../access/useDataViewer";
import { derivedSuiteForProject, projectById } from "../../lib/demo/data";
import type { RunStatus } from "../../lib/demo/data";
import { cancelRun, runPlaywrightTests, runnerProgressSnapshot, subscribeRunnerProgress, useActiveRunnerRun, useDemoState } from "../../lib/demo/store";
import { formatCompact, formatNumber } from "../../lib/format";
import { RUNNER_MAX_FILES, type RunnerRunProgress } from "../../lib/runner/client";
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
import { DataTable, type Column } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { Breadcrumb } from "../../shared/ui/Breadcrumb";
import { CaseError } from "../../shared/ui/CaseTree";
import { KpiCard } from "../../shared/ui/KpiCard";
import { Select } from "../../shared/ui/select";
import { IssueStatusBadge, StatusBadge, SeverityBadge, SuiteStatusBadge } from "../../shared/ui/StatusBadge";
import { Tabs } from "../../shared/ui/Tabs";
import { ProjectTestsTab } from "./ProjectTestsTab";
// The detail VIEWS (not the route pages) are imported here on purpose:
// the route pages pull in app/router/routes.tsx, which imports this page
// back — importing them here would close a circular module graph and
// vite would full-reload the page on every HMR update inside the cycle
// (which used to kill an in-flight run dispatch).
import { IssueDetailView } from "../issues/IssueDetailView";
import { ISSUE_STATUS_KEYS, SEVERITY_KEYS, useIssueColumns } from "../issues/issueColumns";
import { RunDetailView } from "../runs/RunDetailView";
import { RUN_STATUS_KEYS, useRunColumns, useRunStatsColumns } from "../runs/runColumns";
import { RunInlineRow } from "../runs/RunInlineRow";
import { PlainSpecFiles, SuiteDetailView } from "../suites/SuiteDetailView";
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
  const { runs, issues, caseResults } = useDemoState();
  const { t } = useT();
  const [tab, setTabState] = useState<Tab>(initialTab);
  // The data-viewer role has no editor: a viewer landing on ?tab=tests (or
  // the default first tab) is pushed to the summary view instead.
  const viewer = useIsDataViewer();
  useEffect(() => {
    if (viewer && tab === "tests") setTabState("summary");
  }, [tab, viewer]);
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
  // Live banner: visible on EVERY tab while this project's run executes —
  // the heartbeat (passed/failed/progress) streams from the runner's ~2s
  // /status poll.
  const projectLive = runInFlight ? activeRunnerRun : null;
  const [liveProgress, setLiveProgress] = useState(runnerProgressSnapshot());
  useEffect(() => subscribeRunnerProgress((progress: RunnerRunProgress) => setLiveProgress(progress)), []);

  // Static spec parse of the open runner-mode folder — this is what the
  // suites tab previews (every block and step, before anything runs) and
  // what a live run's tree hydrates against.
  const runnerRoot = savedRoot?.mode === "runner"
    ? savedRoot.root
    : savedRoot
      ? null
      : binding?.mode === "runner" && binding.root ? binding.root : null;
  const specPaths = useMemo(() => workspaceInfo?.specPaths ?? [], [workspaceInfo]);
  const blocks = useSpecBlocks(runnerRoot, specPaths, params.projectId);

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
  // get the same stop button as the global runs list — except for the
  // data-viewer role, which never cancels anything.
  const runColumns = useRunColumns((run) => openDrill("run", run.id), viewer
    ? { omitProject: true }
    : { omitProject: true, onCancel: (run) => cancelRun(run.id) });
  const issueColumns = useIssueColumns((issue) => openDrill("issue", issue.id), { omitProject: true });
  // The runs tab's fold rows use the FULL stats column set — the exact
  // columns the Test runs board's inner rows use — armed with the stop
  // button on live rows for non-viewers.
  const inlineRunColumns = useRunStatsColumns(viewer ? undefined : { onCancel: (run) => cancelRun(run.id) });
  // Fold state: one run unfolded at a time (runs tab); the issues tab groups
  // by run, one run group at a time, each issue unfolding its details.
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [openRunGroup, setOpenRunGroup] = useState<string | null>(null);
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  // ...with the Project column replaced by WHEN the run happened (this page
  // already names the project), Date and the tail dropped — time leads.
  const inlineColumns: Column<(typeof runs)[number]>[] = useMemo(() => {
    const [, status, total, passed, failed, duration, , rate] = inlineRunColumns;
    const started: Column<(typeof runs)[number]> = {
      key: "started",
      header: t("runs.started"),
      render: (run) => <span className="table-link">{formatRelative(run.startedAt)}</span>,
      width: "18%"
    };
    return [started, status, total, passed, failed, duration, rate].filter((col): col is NonNullable<typeof col> => Boolean(col));
  }, [inlineRunColumns, runs, t]);

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
  const failedSum = last30.reduce((sum, run) => sum + run.failed, 0);
  const passedTests = last30.reduce((sum, run) => sum + run.passed, 0);
  const failedTests = last30.reduce((sum, run) => sum + run.failed, 0);
  const successRate = passedTests + failedTests > 0 ? (passedTests / (passedTests + failedTests)) * 100 : 0;
  const openIssues = projectIssues.filter((issue) => issue.status !== "resolved").length;
  const latestRun = [...projectRuns].sort((a, b) => b.startedAt - a.startedAt).find((run) => run.status === "passed" || run.status === "failed");

  const tabs: { id: Tab; label: string }[] = [
    { id: "tests", label: t("projects.tabTests") },
    // Hardcoded label: the tenant localization store can override the
    // dictionary key — this tab's name is identity, not translatable copy.
    { id: "summary", label: "Overview" },
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
              directly, and stays disabled until a folder is open. The
              data-viewer role gets neither the Run action nor the editor
              tab — the strip shows only the read-only views. */}
          <Tabs
            active={tab}
            actions={viewer ? undefined : (
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
            tabs={viewer ? tabs.filter((entry) => entry.id !== "tests") : tabs}
          />

          {/* Live run banner: pinned above every tab while THIS project's run
              executes — streams the heartbeat (passed/failed/progress). */}
          {projectLive ? (
            <div className="panel live-run-banner">
              <LoaderCircle className="live-run-spinner" size={15} aria-hidden />
              <strong>{t("status.running")}</strong>
              <span className="muted">
                {liveProgress
                  ? `${liveProgress.passed}/${liveProgress.total} · ${liveProgress.total > 0 ? Math.round((liveProgress.completed / liveProgress.total) * 100) : 0}%`
                  : "…"}
              </span>
              <button className="secondary-button" onClick={() => setTab("runs")}>{t("common.viewAll")}</button>
            </div>
          ) : null}

          {tab === "summary" ? (
        <div className="stack">
          {/* Project hero: identity strip — icon, name, description, and the
              scope chips on the right. */}
          <div className="panel project-overview-hero">
            <ProjectIcon icon={project.icon} />
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 16, margin: "0 0 2px" }}>{project.name}</h3>
              <p className="muted" style={{ margin: 0 }}>{project.description}</p>
            </div>
            <div className="chips" style={{ marginLeft: "auto" }}>
              <span className="chip">{`${derivedSuite ? 1 : 0} ${t("projects.suitesLabel")}`}</span>
              <span className="chip">{`${t("projects.created")}: ${formatDate(project.createdAt)}`}</span>
            </div>
          </div>

          {/* The same KPI cards + activity chart the global Overview uses —
              scoped to this project's runs. */}
          {/* KPI values read from the LATEST run — not accumulated across
              runs: 10 tests run 3 times shows 10, not 30. The chart below
              carries the per-run history. */}
          <div className="kpis">
            <KpiCard icon={<ListChecks size={15} />} label={t("overview.kpi.total")} value={latestRun ? formatCompact(latestRun.total) : "0"} />
            <KpiCard icon={<CircleCheck size={15} />} label={t("overview.kpi.passed")} tone="ok" value={latestRun ? formatCompact(latestRun.passed) : "0"} />
            <KpiCard icon={<CircleX size={15} />} label={t("overview.kpi.failed")} tone="bad" value={latestRun ? formatCompact(latestRun.failed) : "0"} />
            <KpiCard icon={<Gauge size={15} />} label={t("overview.kpi.success")} value={formatPercent(successRate)} />
          </div>

          {/* Per-RUN columns: every run of the last 30 days is one stacked
              column (passed = base, failed = top), labelled with when it ran
              — a bar IS a run, nothing to decode. */}
          <div className="grid-2">
            <ChartCard
              description="One column per run — passed give the scale, failed stacks on top."
              footer={(
                <>
                  <span>{`${formatNumber(totalTests)} ${t("common.tests")}`}</span>
                  <span>{`${formatNumber(failedSum)} ${t("common.failed")}`}</span>
                </>
              )}
              legend={<ChartLegend items={[{ color: "var(--chart-failed)", label: t("common.failed") }, { color: "var(--chart-context)", label: t("common.passed") }]} />}
              table={{
                head: [t("common.date"), t("common.passed"), t("common.failed")],
                rows: [...last30].sort((a, b) => b.startedAt - a.startedAt).map((run) => [formatRelative(run.startedAt), formatNumber(run.passed), formatNumber(run.failed)])
              }}
              title={t("overview.activity.title")}
            >
              {last30.length > 0 ? (
                <StackedColumns
                  ariaLabel={t("overview.activity.title")}
                  baseLabel={t("common.passed")}
                  data={[...last30].sort((a, b) => a.startedAt - b.startedAt).map((run) => ({
                    base: run.passed,
                    label: formatRelative(run.startedAt),
                    top: run.failed
                  }))}
                  topLabel={t("common.failed")}
                />
              ) : (
                <EmptyState
                  description={t("overview.activity.emptyDesc")}
                  icon={<ListChecks size={20} />}
                  title={t("overview.activity.emptyTitle")}
                />
              )}
            </ChartCard>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3 className="panel-title">{t("overview.health.title")}</h3>
                </div>
                <button className="link-button" onClick={() => setTab("issues")}>{t("common.viewAll")}</button>
              </div>
              <div className="health-list">
                <button className="health-row" onClick={() => openDrill("run", latestRun?.id ?? "")}>
                  <span className="table-link" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{latestRun?.name ?? "—"}</span>
                  {latestRun ? (
                    <>
                      <StatusBadge tone={latestRun.status === "passed" ? "passed" : "failed"}>
                        {t(latestRun.status === "passed" ? "status.passed" : "status.failed")}
                      </StatusBadge>
                      <span className="muted">{formatRelative(latestRun.startedAt)}</span>
                    </>
                  ) : null}
                </button>
                <button className="health-row" onClick={() => setTab("issues")}>
                  <span className="table-link" style={{ flex: 1 }}>{t("projects.openIssues")}</span>
                  <strong className="num" style={openIssues > 0 ? { color: "hsl(var(--destructive))" } : undefined}>{openIssues}</strong>
                </button>
              </div>
            </div>
          </div>
          </div>
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
              <div>
              {/* Run rows fold INLINE — clicking a run opens its case tree
                  right beneath the row, exactly like the Test runs board's
                  inner rows; no drill-down needed for a quick look. The
                  LIVE run streams its spec tree in the SAME fold (shared
                  RunInlineRow with the Test runs board), so there is no
                  separate live panel above the table anymore. */}
              <div className="runs-inline">
                <div className="runs-inline-row runs-inline-head">
                  {inlineColumns.map((col) => (
                    <span
                      className={`${col.align === "end" ? "cell-end" : ""}${col.className ? ` ${col.className}` : ""}`}
                      key={col.key}
                      style={col.width ? { flex: "none", width: col.width } : undefined}
                    >
                      {col.header}
                    </span>
                  ))}
                  <span aria-hidden className="runs-inline-tail" />
                </div>
                {filteredRuns.map((run) => {
                  const open = openRun === run.id;
                  return (
                    <RunInlineRow
                      cases={caseResults.filter((entry) => entry.runId === run.id)}
                      inlineColumns={inlineColumns}
                      key={run.id}
                      onToggle={() => setOpenRun(open ? null : run.id)}
                      open={open}
                      run={run}
                    />
                  );
                })}
              </div>
              </div>
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
                {/* The suites list's own fold tree: spec-file rows with per-
                    file counts, tests and steps beneath — no pass/fail
                    anywhere (this tab shows what the suite CONTAINS). */}
                <PlainSpecFiles blocks={blocks} />
              </div>
            ) : null}
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
          /* Issues grouped BY RUN — the same fold rows as the global Issues
              page, scoped to this project: each run names itself (when it
              ran), its issues fold out beneath, each issue folding again
              into message / repro / assignee. */
          <div className="case-tree" style={{ gap: 14, padding: "4px 2px 12px" }}>
            {(() => {
              const runGroups = new Map<string, { run: typeof runs[number] | undefined; issues: typeof projectIssues }>();
              for (const issue of projectIssues) {
                const key = issue.runId ?? "";
                const group = runGroups.get(key) ?? { run: runs.find((entry) => entry.id === key), issues: [] as typeof projectIssues };
                group.issues.push(issue);
                runGroups.set(key, group);
              }
              const groups = [...runGroups.entries()]
                .map(([key, group]) => ({ key: key || "unattributed", run: group.run, issues: group.issues }))
                .sort((a, b) => (b.run?.startedAt ?? 0) - (a.run?.startedAt ?? 0));
              return groups.map(({ key, run, issues: groupIssues }) => {
                const groupOpen = openRunGroup === key;
                return (
                  <div className={`case-file${groupOpen ? "" : " collapsed"}`} key={key}>
                    <button
                      aria-expanded={groupOpen}
                      className="case-file-head"
                      onClick={() => setOpenRunGroup(groupOpen ? null : key)}
                      type="button"
                    >
                      <FlaskConical className="case-file-ico" size={13} aria-hidden />
                      <span>{run ? formatRelative(run.startedAt) : t("issues.noRun")}</span>
                      <span className="case-file-counts">
                        {run ? <StatusBadge tone={run.status === "failed" ? "failed" : run.status === "passed" ? "passed" : "running"}>{t(RUN_STATUS_KEYS[run.status])}</StatusBadge> : null}
                        <span className="muted">{`${groupIssues.length} ${t("issues.count")}`}</span>
                      </span>
                      <ChevronDown className="case-file-chevron" size={15} aria-hidden />
                    </button>
                    <div className="case-file-body">
                      <div className="case-file-body-inner">
                        <div className="issue-list">
                          {groupIssues.map((issue) => {
                            const issueOpen = openIssue === issue.id;
                            return (
                              <div className="issue-item" key={issue.id}>
                                <button
                                  aria-expanded={issueOpen}
                                  className={`issue-row${issueOpen ? " open" : ""}`}
                                  onClick={() => setOpenIssue(issueOpen ? null : issue.id)}
                                  type="button"
                                >
                                  <span className="case-title">{issue.title}</span>
                                  <span className="case-dur" style={{ display: "inline-flex", gap: 6, marginLeft: "auto" }}>
                                    <SeverityBadge label={t(SEVERITY_KEYS[issue.severity])} severity={issue.severity} />
                                    <IssueStatusBadge label={t(ISSUE_STATUS_KEYS[issue.status])} status={issue.status} />
                                  </span>
                                  <ChevronDown className="case-file-chevron" size={15} aria-hidden />
                                </button>
                                <div className={`run-inline-body${issueOpen ? " open" : ""}`}>
                                  <div className="run-inline-body-inner">
                                    <div className="issue-detail">
                                      <div className="issue-error-block">
                                        <button
                                          aria-label={t("common.copy")}
                                          className="icon-button issue-copy"
                                          onClick={() => {
                                            void navigator.clipboard.writeText(`${issue.message}\n\n${window.location.origin}`);
                                            toast(t("common.copied"));
                                          }}
                                          title={t("common.copy")}
                                          type="button"
                                        >
                                          <Copy size={14} />
                                        </button>
                                        <CaseError text={issue.message} />
                                      </div>
                                      {issue.steps.length > 0 ? (
                                        <div className="issue-repro">
                                          <strong><ListOrdered size={14} /> {t("issue.steps")}</strong>
                                          <ol>
                                            {issue.steps.map((step) => <li key={step}>{step}</li>)}
                                          </ol>
                                        </div>
                                      ) : null}
                                      {issue.assignee ? (
                                        <p className="muted" style={{ margin: 0 }}>{`${t("common.assignee")}: ${issue.assignee}`}</p>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
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
