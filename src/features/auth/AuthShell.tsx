import { Activity } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../../lib/i18n/LocalizationProvider";

/** The standalone account-page shell — same brand row, card and screen as
 *  the login page, shared by every public self-service flow (signup,
 *  activation, recovery) so they all read as one family. */
export function AuthShell({ children, subtitle, title }: { children: ReactNode; subtitle: string; title: string }) {
  const { t } = useT();
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand"><span className="brand-mark"><Activity size={18} /></span><span>{t("app.name")}</span></div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

/** The muted footer links row under an auth card's main action. */
export function AuthLinks({ children }: { children: ReactNode }) {
  return <div className="auth-links">{children}</div>;
}
