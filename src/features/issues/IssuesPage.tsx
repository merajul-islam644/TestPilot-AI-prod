import { useMemo, useState } from "react";
import { Bug, ChevronDown, Copy, FlaskConical, ListOrdered, Search } from "lucide-react";
import { toast } from "sonner";
import { projects } from "../../lib/demo/data";
import type { Issue, IssueSeverity, IssueStatus, Project } from "../../lib/demo/data";
import { formatRelative } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { CaseError } from "../../shared/ui/CaseTree";
import { useDemoState } from "../../lib/demo/store";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { IssueStatusBadge, RunStatusBadge, SeverityBadge } from "../../shared/ui/StatusBadge";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";
import { Select } from "../../shared/ui/select";
import { RUN_STATUS_KEYS } from "../runs/runColumns";
import { ISSUE_STATUS_KEYS, SEVERITY_KEYS } from "./issueColumns";

/** The issues list is PROJECT-scoped like the suites list: one collapsible
 *  row per project, summarising its issues; expanding unfolds the project's
 *  matching issues INLINE — severity + status beside each title. No
 *  navigation: the per-project board page stays reachable from elsewhere. */
type ProjectIssuesRow = { id: string; project: Project; issues: Issue[] };

/** "2 open · 1 resolved" — zero segments are dropped, a summary never
 *  advertises a state the project has not hit. */
function countSummary(counts: [string, number][]): string {
  return counts.filter(([, count]) => count > 0).map(([label, count]) => `${count} ${label}`).join(" · ");
}

export function IssuesPage() {
  const { issues, caseResults, runs } = useDemoState();
  const { t } = useT();
  const [statusFilter, setStatusFilter] = useState<IssueStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | "">("");
  const [projectFilter, setProjectFilter] = useState("");
  const [query, setQuery] = useState("");
  // Accordion: one project unfolded at a time — every row starts minimized.
  const [openProject, setOpenProject] = useState<string | null>(null);
  // One RUN group unfolded per click — the same fold rows the Test runs
  // page uses; issues unfold beneath the open run.
  const [openRunGroup, setOpenRunGroup] = useState<string | null>(null);
  // Same accordion for issues inside a project: one detail open at once.
  const [openIssue, setOpenIssue] = useState<string | null>(null);

  const filtered = useMemo(() => issues.filter((issue: Issue) => {
    if (statusFilter !== "all" && issue.status !== statusFilter) return false;
    if (severityFilter && issue.severity !== severityFilter) return false;
    if (projectFilter && issue.projectId !== projectFilter) return false;
    if (query && !`${issue.title} ${issue.id}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [issues, projectFilter, query, severityFilter, statusFilter]);

  // Issues grouped under their project, in the catalog's project order —
  // a project with no matching issues simply has no row at all.
  const rows = useMemo(() => projects
    .map((project): ProjectIssuesRow => ({
      id: `project:${project.id}`,
      project,
      issues: filtered.filter((issue) => issue.projectId === project.id)
    }))
    .filter((row) => row.issues.length > 0), [filtered]);

  // "All" leads the row — the unfiltered mix is the default view, the
  // three statuses follow in their natural order.
  const statusOptions: SegmentOption<IssueStatus | "all">[] = [
    { id: "all", label: t("common.all") },
    { id: "open", label: t("issue.open") },
    { id: "in_progress", label: t("issue.inProgress") },
    { id: "resolved", label: t("issue.resolved") }
  ];

  const statusSummary = (row: ProjectIssuesRow): string => {
    const counts = (Object.keys(ISSUE_STATUS_KEYS) as IssueStatus[]).map(
      (status): [string, number] => [t(ISSUE_STATUS_KEYS[status]), row.issues.filter((issue) => issue.status === status).length]
    );
    return countSummary(counts);
  };

  // Copies the failure + the URL of the page the failure happened on: the
  // run's matching case carries the spec file ("tests/settings.spec.ts"),
  // and the file name IS the route the test covered — so the pasted link
  // lands the reader exactly where the breakage lives.
  const copyIssue = (issue: Issue) => {
    const source = caseResults
      .filter((entry) => entry.runId === issue.runId)
      .find((entry) => entry.name === issue.title);
    const route = source?.file
      ? `/${source.file.replace(/^tests\//, "").replace(/\.spec\.(t|j)sx?$/, "")}`
      : "";
    void navigator.clipboard.writeText(`${issue.message}\n\n${window.location.origin}${route}`);
    toast(t("common.copied"));
  };

  return (
    <section>
      <PageHeader subtitle={t("issues.subtitle")} title={t("issues.title")} />

      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input onChange={(event) => setQuery(event.target.value)} placeholder={t("issues.searchPlaceholder")} value={query} />
        </label>
        <div className="toolbar-actions">
          <Select
            ariaLabel={t("common.severity")}
            items={[
              { value: "", label: t("issues.filterSeverity") },
              ...(Object.keys(SEVERITY_KEYS) as IssueSeverity[]).map((severity) => ({ value: severity, label: t(SEVERITY_KEYS[severity]) }))
            ]}
            onChange={(value) => setSeverityFilter(value as IssueSeverity | "")}
            value={severityFilter}
          />
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

      <div style={{ marginBottom: 14 }}>
        <Segmented onChange={(id) => setStatusFilter(id)} options={statusOptions} value={statusFilter} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState description={t("common.notFound")} title={t("issues.empty")} />
      ) : (
        <div className="case-tree">
          {rows.map((row) => {
            const open = openProject === row.id;
            return (
              <div className={`case-file${open ? "" : " collapsed"}`} key={row.id}>
                <button
                  aria-expanded={open}
                  className="case-file-head"
                  onClick={() => setOpenProject(open ? null : row.id)}
                  type="button"
                >
                  <Bug className="case-file-ico" size={13} aria-hidden />
                  <span>{row.project.name}</span>
                  <span className="case-file-counts">
                    <span className="muted">{statusSummary(row)}</span>
                  </span>
                  <ChevronDown className="case-file-chevron" size={15} aria-hidden />
                </button>
                <div className="case-file-body">
                  <div className="case-file-body-inner">
                    {/* Issues grouped BY RUN — the same fold rows the Test
                        runs page uses: each run is its own case-file card
                        (status badge + when it ran + issue count), one open
                        at a time, issues unfold beneath. */}
                    <div className="case-tree" style={{ gap: 14, padding: "4px 10px 12px" }}>
                    {(() => {
                      const runGroups = new Map<string, { run: typeof runs[number] | undefined; issues: Issue[] }>();
                      for (const issue of row.issues) {
                        const key = issue.runId ?? "";
                        const group = runGroups.get(key) ?? { run: runs.find((entry) => entry.id === key), issues: [] };
                        group.issues.push(issue);
                        runGroups.set(key, group);
                      }
                      const groups = [...runGroups.entries()]
                        .map(([key, group]) => ({ key: key || "unattributed", run: group.run, runIssues: group.issues }))
                        .sort((a, b) => (b.run?.startedAt ?? 0) - (a.run?.startedAt ?? 0));
                      return groups.map(({ key, run, runIssues }) => {
                        const open = openRunGroup === key;
                        return (
                          <div className={`case-file${open ? "" : " collapsed"}`} key={key}>
                            <button
                              aria-expanded={open}
                              className="case-file-head"
                              onClick={() => setOpenRunGroup(open ? null : key)}
                              type="button"
                            >
                              <FlaskConical className="case-file-ico" size={13} aria-hidden />
                              <span>{run ? formatRelative(run.startedAt) : t("issues.noRun")}</span>
                              <span className="case-file-counts">
                                {run ? <RunStatusBadge label={t(RUN_STATUS_KEYS[run.status])} status={run.status} /> : null}
                                <span className="muted">{`${runIssues.length} ${t("issues.count")}`}</span>
                              </span>
                              <ChevronDown className="case-file-chevron" size={15} aria-hidden />
                            </button>
                            <div className="case-file-body">
                              <div className="case-file-body-inner">
                                <div className="issue-list">
                                  {runIssues.map((issue) => {
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
                                              {/* The failure message renders EXACTLY like
                                                  the run views' terminal block: mono,
                                                  diagnostic lines accented — with a copy
                                                  pinned to its top-right that grabs the
                                                  error plus the page URL it broke on. */}
                                              <div className="issue-error-block">
                                                <button
                                                  aria-label={t("common.copy")}
                                                  className="icon-button issue-copy"
                                                  onClick={() => copyIssue(issue)}
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
