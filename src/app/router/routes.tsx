import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { RouteContext, type RouteParams, type RouteState } from "./routeContext";
export { useRoute } from "./routeContext";
import { AppShell } from "../layout/AppShell";
import { RedirectIfAuthenticated, RequireAuth } from "./guards";
import { CallbackPage } from "../../features/auth/CallbackPage";
import { ErrorPage } from "../../features/auth/ErrorPage";
import { LoginPage } from "../../features/auth/LoginPage";
import { NotFoundPage } from "../../features/auth/NotFoundPage";
import { ActivateAccountPage } from "../../features/auth/ActivateAccountPage";
import { ForgotPasswordPage } from "../../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../../features/auth/ResetPasswordPage";
import { SignupPage } from "../../features/auth/SignupPage";
import { OverviewPage } from "../../features/overview/OverviewPage";
import { ProjectsPage } from "../../features/projects/ProjectsPage";
import { ProjectDetailPage } from "../../features/projects/ProjectDetailPage";
import { RunsPage } from "../../features/runs/RunsPage";
import { RunDetailPage } from "../../features/runs/RunDetailPage";
import { SuitesPage } from "../../features/suites/SuitesPage";
import { SuiteDetailPage } from "../../features/suites/SuiteDetailPage";
import { IssuesPage } from "../../features/issues/IssuesPage";
import { IssueDetailPage } from "../../features/issues/IssueDetailPage";
import { ReportsPage } from "../../features/reports/ReportsPage";
import { SettingsPage } from "../../features/settings/SettingsPage";
import { HelpPage } from "../../features/help/HelpPage";
import { ProfilePage } from "../../features/profile/ProfilePage";
import { UsersPage } from "../../features/users/UsersPage";

type RouteDef = { component: ComponentType; params: string[]; segments: string[] };

// ":name" segments become params, handed to the page through useRoute().
const routes: RouteDef[] = [
  { component: OverviewPage, params: [], segments: [] },
  { component: ProjectsPage, params: [], segments: ["projects"] },
  { component: ProjectDetailPage, params: ["projectId"], segments: ["projects", ":projectId"] },
  { component: RunsPage, params: [], segments: ["runs"] },
  { component: RunDetailPage, params: ["runId"], segments: ["runs", ":runId"] },
  { component: SuitesPage, params: [], segments: ["suites"] },
  { component: SuiteDetailPage, params: ["suiteId"], segments: ["suites", ":suiteId"] },
  { component: IssuesPage, params: [], segments: ["issues"] },
  { component: IssueDetailPage, params: ["issueId"], segments: ["issues", ":issueId"] },
  { component: ReportsPage, params: [], segments: ["reports"] },
  { component: SettingsPage, params: [], segments: ["settings"] },
  { component: UsersPage, params: [], segments: ["users"] },
  { component: HelpPage, params: [], segments: ["help"] },
  { component: ProfilePage, params: [], segments: ["profile"] },
  { component: ErrorPage, params: [], segments: ["error"] }
];

function matchRoute(pathname: string): { component: ComponentType; params: RouteParams } | undefined {
  const segments = pathname.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.segments.length !== segments.length) continue;
    const params: RouteParams = {};
    let matched = true;
    route.segments.forEach((segment, index) => {
      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeURIComponent(segments[index] ?? "");
      } else if (segment !== segments[index]) {
        matched = false;
      }
    });
    if (matched) return { component: route.component, params };
  }
  return undefined;
}

export function AppRouter() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [search, setSearch] = useState(() => window.location.search);

  useEffect(() => {
    const onPopState = () => {
      setPath(window.location.pathname);
      setSearch(window.location.search);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    const [nextPathname = "/", queryString = ""] = nextPath.split("?");
    window.history.pushState({}, "", nextPath);
    setPath(nextPathname);
    setSearch(queryString ? `?${queryString}` : "");
  }, []);

  const match = useMemo(() => matchRoute(path), [path]);
  const routeState = useMemo<RouteState>(() => ({ navigate, params: match?.params ?? {}, path }), [match, navigate, path]);

  if (path === "/login/callback") {
    return <CallbackPage onNavigate={navigate} />;
  }

  if (path === "/login") {
    const returnTo = new URLSearchParams(search).get("returnTo") || undefined;
    return (
      <RedirectIfAuthenticated onNavigate={navigate}>
        <LoginPage onNavigate={navigate} returnTo={returnTo} />
      </RedirectIfAuthenticated>
    );
  }

  // Public account self-service flows — standalone screens like the login
  // page, deliberately NOT guarded: they're reached from email links that
  // may be clicked while another tab is still signed in, and the flows
  // themselves are IAM-gated (each carries its own emailed credential).
  if (path === "/forgot-password") return <ForgotPasswordPage onNavigate={navigate} />;
  if (path === "/reset-password") return <ResetPasswordPage onNavigate={navigate} />;
  if (path === "/activate") return <ActivateAccountPage onNavigate={navigate} />;
  if (path === "/signup") return <SignupPage onNavigate={navigate} />;

  return (
    <RouteContext.Provider value={routeState}>
      {match ? (
        <RequireAuth currentPath={path} onNavigate={navigate}>
          <AppShell activePath={path} onNavigate={navigate}>
            <match.component />
          </AppShell>
        </RequireAuth>
      ) : (
        <NotFoundPage onNavigate={navigate} />
      )}
    </RouteContext.Provider>
  );
}
