import { FlaskConical } from "lucide-react";
import { APP_NAME } from "../../app/appName";

/**
 * Boot/auth loading screen — shown before the session resolves (guards,
 * OIDC callback), so there is no shell yet. Speaks the app's own loading
 * language instead of a lone spinner: the sidebar's brand tile + name, and
 * one shimmer bar from the same skeleton system the routed pages use.
 */
export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-brand-block">
        <span className="brand-mark loading-brand-mark"><FlaskConical size={20} /></span>
        <span className="loading-app-name">{APP_NAME}</span>
        <span className="skeleton skel-line loading-line" aria-hidden="true" />
      </div>
    </div>
  );
}
