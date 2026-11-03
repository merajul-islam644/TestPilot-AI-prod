import { useEffect } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../providers/AuthProvider";
import { LoadingScreen } from "../../shared/ui/LoadingScreen";

type GuardProps = { children: ReactNode; onNavigate: (path: string) => void };

// currentPath is passed in from router state rather than read live from
// window.location.pathname: under StrictMode's dev-only double-invoked
// effects, the first invocation's pushState() already mutates
// window.location before the second invocation runs, which would nest the
// returnTo query param (e.g. /login?returnTo=%2Flogin) if read live here.
export function RequireAuth({ children, currentPath, onNavigate }: GuardProps & { currentPath: string }) {
  const { status } = useAuth();

  useEffect(() => {
    if (status === "unauthenticated") {
      onNavigate(`/login?returnTo=${encodeURIComponent(currentPath)}`);
    }
  }, [currentPath, status, onNavigate]);

  if (status !== "authenticated") return <LoadingScreen />;
  return <>{children}</>;
}

export function RedirectIfAuthenticated({ children, onNavigate }: GuardProps) {
  const { status } = useAuth();

  useEffect(() => {
    if (status === "authenticated") onNavigate("/");
  }, [status, onNavigate]);

  if (status === "loading" || status === "authenticated") return <LoadingScreen />;
  return <>{children}</>;
}
