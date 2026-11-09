import { AlertTriangle, Home, RotateCw } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useT } from "../../lib/i18n/LocalizationProvider";

/** Card shown when a routed page throws while rendering. Details stay in
 *  the console -- users get plain language plus two ways out. */
function ErrorFallbackCard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useT();
  return (
    <section className="route-error" role="alert">
      <AlertTriangle size={28} aria-hidden />
      <h2>{t("error.boundary.title")}</h2>
      <p>{t("error.boundary.desc")}</p>
      <div className="actions">
        <button className="primary-button" onClick={() => window.location.reload()}>
          <RotateCw size={16} /> {t("error.boundary.reload")}
        </button>
        <button
          className="secondary-button"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("/");
          }}
        >
          <Home size={16} /> {t("notFound.home")}
        </button>
      </div>
    </section>
  );
}

type BoundaryProps = { children: ReactNode; onNavigate: (path: string) => void };
type BoundaryState = { error: unknown };

/** Route-level crash guard. Rendered by AppShell with `key={activePath}`, so
 *  navigating to another page remounts it and clears the error state. The
 *  gateway-load banner and skeleton gate live outside this boundary and keep
 *  their own behavior. */
export class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Console only -- no error reporting service exists in this app, and the
    // full stack + component stack is exactly what a future edit needs.
    console.error("[TestPilot] Page crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error !== undefined) {
      return <ErrorFallbackCard onNavigate={this.props.onNavigate} />;
    }
    return this.props.children;
  }
}
