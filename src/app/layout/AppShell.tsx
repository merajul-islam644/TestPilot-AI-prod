import { FlaskConical, PanelLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { primaryNavItems, secondaryNavItems } from "./navItems";
import { NotificationsMenu } from "./NotificationsMenu";
import { SidebarUser } from "./SidebarUser";
import { ShellContext } from "./ShellContext";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { CommandPalette } from "./CommandPalette";
import { NewRunModal } from "../../features/runs/NewRunModal";
import { projects } from "../../lib/demo/data";
import { reloadDomain, useDemoState } from "../../lib/demo/store";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { bootstrapWorkspaceInfos, resetWorkspaceBootstrap } from "../../shared/workspaceBootstrap";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { RouteErrorBoundary } from "../../shared/ui/ErrorFallback";
import { useWorkspaceName } from "../../shared/useWorkspaceName";

const COLLAPSED_KEY = "blocks-app:sidebar-collapsed";
const MOBILE_QUERY = "(max-width: 880px)";

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

export function AppShell({ activePath, children, onNavigate }: { activePath: string; children: ReactNode; onNavigate: (path: string) => void }) {
  const isMobile = useIsMobile();
  const [collapsedPref, setCollapsedPref] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "true");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newRunOpen, setNewRunOpen] = useState(false);
  const { t } = useT();
  const workspaceName = useWorkspaceName();
  // The shell mounts before any route, so this is where the domain load is
  // guaranteed to start -- and where a failed load surfaces globally.
  const { status } = useDemoState();
  // On narrow screens the sidebar is always the icon-only rail below --
  // no separate hamburger/drawer/scrim needed, and no dead-end state where
  // nothing on screen can bring navigation back.
  const collapsed = collapsedPref || isMobile;

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsedPref));
  }, [collapsedPref]);

  // Suites derive from each project's opened workspace (the per-browser
  // registry, written by the Tests tab). A browser that never mounted a
  // Tests tab has no registry row for its remembered folders, so once the
  // domain catalog is ready, re-derive the runner-mode ones straight from
  // disk -- suites views and the New Run modal are not blank in fresh
  // browsers. Reset clears the registry but keeps the saved roots, hence
  // the re-arm on "loading".
  useEffect(() => {
    if (status === "loading") {
      resetWorkspaceBootstrap();
      return;
    }
    if (status !== "ready") return;
    void bootstrapWorkspaceInfos(projects.map((project) => project.id));
  }, [status]);

  // The one global shortcut: command palette (⌘K / Ctrl+K).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const shell = useMemo(() => ({
    openNewRun: () => setNewRunOpen(true),
    openProjectTests: (projectId: string) => onNavigate(`/projects/${projectId}?tab=tests`)
  }), [onNavigate]);

  function isActive(href: string): boolean {
    return href === "/" ? activePath === "/" : activePath === href || activePath.startsWith(`${href}/`);
  }

  const renderItem = (item: (typeof primaryNavItems)[number]) => (
    <a
      key={item.href}
      href={item.href}
      data-tooltip={t(item.labelKey)}
      className={isActive(item.href) ? "active" : ""}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(item.href);
      }}
    >
      <item.icon size={18} />
      {collapsed ? null : <span>{t(item.labelKey)}</span>}
    </a>
  );

  return (
    <ShellContext.Provider value={shell}>
      <div className="shell">
        <aside className={collapsed ? "collapsed" : ""}>
          <div className="sidebar-header">
            {collapsed ? (
              <span className="brand-mark"><FlaskConical size={16} /></span>
            ) : (
              <a className="brand" href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}>
                <span className="brand-mark"><FlaskConical size={16} /></span>
                <span>{workspaceName || t("app.name")}</span>
              </a>
            )}
            {/* Only shown while expanded -- once minimized the toggle lives in
               the topbar's left edge, where there is room for it. */}
            {collapsed ? null : (
              <button className="icon-button sidebar-collapse-toggle" onClick={() => setCollapsedPref((value) => !value)} aria-label={t("shell.collapseSidebar")}>
                <PanelLeft size={16} />
              </button>
            )}
          </div>
          <nav aria-label={t("app.name")}>
            {primaryNavItems.map(renderItem)}
            <div className="nav-divider" role="presentation" />
            {secondaryNavItems.map(renderItem)}
          </nav>
          <div className="sidebar-footer">
            <SidebarUser collapsed={collapsed} onNavigate={onNavigate} />
          </div>
        </aside>
        <div className="content">
          <header className="topbar">
            {/* Command palette stays reachable via ⌘K / Ctrl+K -- there is
               deliberately no visible search trigger in the topbar. */}
            {/* While the sidebar is minimized its expand toggle sits at the
               topbar's left edge; on mobile the rail is always collapsed and
               there is nothing to toggle, so it never renders there. */}
            {collapsed && !isMobile ? (
              <button className="icon-button sidebar-expand-toggle" onClick={() => setCollapsedPref(false)} aria-label={t("shell.expandSidebar")}>
                <PanelLeft size={16} />
              </button>
            ) : null}
            <div className="topbar-spacer" />
            <NotificationsMenu />
            <ThemeToggle />
            <LanguageSwitcher />
            <UserMenu onNavigate={onNavigate} />
          </header>
          <main>
            {status === "error" ? (
              <div className="load-error-banner" role="alert">
                <span>{t("common.dataLoad")}</span>
                <button className="load-error-retry" onClick={() => void reloadDomain()}>{t("common.retry")}</button>
              </div>
            ) : null}
            {/* Global loading gate: until the gateway load resolves, every
               routed page would render its empty state -- show a skeleton
               shaped like the active route instead. resetDemoData() also
               flips status back to loading, so the wipe is covered too. */}
            {status === "loading" ? (
              <PageSkeleton ariaLabel={t("common.loading")} path={activePath} />
            ) : (
              /* Crash guard around the routed page. Keyed on the path so a
                 navigation remounts it -- a crash on one page never poisons
                 the next. The banner + skeleton above stay outside it. */
              <RouteErrorBoundary key={activePath} onNavigate={onNavigate}>
                {children}
              </RouteErrorBoundary>
            )}
          </main>
        </div>
      </div>
      {newRunOpen ? <NewRunModal onClose={() => setNewRunOpen(false)} /> : null}
      <CommandPalette onClose={() => setPaletteOpen(false)} onNavigate={onNavigate} open={paletteOpen} />
    </ShellContext.Provider>
  );
}
