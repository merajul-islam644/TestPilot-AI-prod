import { useMemo, useState } from "react";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useRoute } from "../../app/router/routes";
import { projects, suitesForProject } from "../../lib/demo/data";
import type { Project } from "../../lib/demo/data";
import { buildDailyActivity, buildProjectStats } from "../../lib/demo/data";
import { formatPercent, formatRelative, healthDotClass, healthFromRate } from "../../lib/format";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { deleteProject, useDemoState } from "../../lib/demo/store";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Sparkline } from "../../shared/charts/Sparkline";
import { ProjectFormModal } from "./ProjectFormModal";
import { ProjectIcon } from "./ProjectIcon";

export function ProjectsPage() {
  const { runs } = useDemoState();
  const { navigate } = useRoute();
  const { t } = useT();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | undefined>(undefined);
  const [deleting, setDeleting] = useState<Project | undefined>(undefined);

  const stats = useMemo(() => buildProjectStats(runs, 30), [runs]);
  const statsById = useMemo(() => new Map(stats.map((stat) => [stat.projectId, stat])), [stats]);

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }

  function openEdit(project: Project) {
    setEditing(project);
    setFormOpen(true);
  }

  return (
    <section>
      <PageHeader
        actions={(
          <button className="primary-button" onClick={openCreate}>
            <Plus size={16} /> {t("projects.new")}
          </button>
        )}
        subtitle={t("projects.subtitle")}
        title={t("projects.title")}
      />

      {projects.length === 0 ? (
        <EmptyState description={t("projects.subtitle")} title={t("projects.title")} />
      ) : (
        <div className="cards-grid">
          {projects.map((project) => {
            const stat = statsById.get(project.id);
            const rate = stat?.successRate ?? 0;
            const health = healthFromRate(rate);
            // 12-day pass-rate trend for the tile sparkline.
            const projectActivity = buildDailyActivity(runs.filter((run) => run.projectId === project.id), 12);
            const trend = projectActivity
              .filter((day) => day.passed + day.failed > 0)
              .map((day) => (day.passed / (day.passed + day.failed)) * 100);

            return (
              // A div rather than a button: the card carries edit/delete
              // buttons of its own, and interactive elements must not nest.
              <div
                className="panel project-card"
                key={project.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/projects/${project.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/projects/${project.id}`);
                }}
              >
                <div className="project-card-head">
                  <ProjectIcon icon={project.icon} />
                  <span className="project-card-name">{project.name}</span>
                  <span className={`health-dot ${healthDotClass(health.tone)}`} title={t(health.labelKey)} />
                </div>
                <p className="project-card-desc">{project.description}</p>
                <div className="project-card-stats">
                  <span className="project-card-rate">{formatPercent(rate)}</span>
                  <span className="muted">{`${stat?.runs ?? 0} ${t("projects.runsLabel")}`}</span>
                  <span className="muted">{`${suitesForProject(project.id).length} ${t("projects.suitesLabel")}`}</span>
                </div>
                <div className="project-card-foot">
                  {trend.length >= 2 ? <Sparkline values={trend.slice(-12)} /> : <span />}
                  <span className="muted">{`${t("projects.lastActivity")}: ${formatRelative(stat?.lastActivity ?? project.createdAt)}`}</span>
                  <ChevronRight size={15} style={{ color: "hsl(var(--muted-foreground))" }} />
                </div>
                <div className="project-card-actions">
                  <button
                    className="icon-button"
                    title={t("common.edit")}
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(project);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button"
                    title={t("common.delete")}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleting(project);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleting ? (
        <ConfirmDialog
          confirmLabel={t("common.delete")}
          message={`${deleting.name} — ${t("projects.deleteConfirm")}`}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => {
            deleteProject(deleting.id);
            setDeleting(undefined);
          }}
          title={t("projects.deleteTitle")}
        />
      ) : null}
      {formOpen ? <ProjectFormModal onClose={() => { setFormOpen(false); setEditing(undefined); }} project={editing} /> : null}
    </section>
  );
}
