import { useQuery } from "@tanstack/react-query";
import { Activity, LogIn } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";
import { fetchLoginOptions } from "../../lib/blocks/auth";
import { isLoginConfigured } from "../../lib/blocks/config";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Alert } from "../../shared/ui/Alert";
import { AuthLinks } from "./AuthShell";

// The tenant's login-method list is loosely typed (IAM's contract) — the
// only question this page needs answered is "does this method appear at
// all", so a serialized scan is honest here.
function supportsMethod(options: Record<string, unknown>[] | undefined, loaded: boolean, needles: string[]): boolean {
  if (!loaded || !options || options.length === 0) return true; // discovery unavailable — keep the standard links
  const haystack = JSON.stringify(options).toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

export function LoginPage({ onNavigate, returnTo }: { onNavigate: (path: string) => void; returnTo?: string }) {
  const { login } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { t } = useT();
  const configured = isLoginConfigured();

  // Login options discovery: only offer self-service links for methods IAM
  // actually supports. A failed discovery falls OPEN (links stay) — a
  // broken call must never hide the recovery paths.
  const options = useQuery({
    queryFn: () => fetchLoginOptions(),
    queryKey: ["auth", "loginOptions"],
    retry: false,
    staleTime: 10 * 60_000
  });
  const hasPassword = supportsMethod(options.data, options.isSuccess, ["password"]);

  async function handleLogin() {
    setError(undefined);
    setPending(true);
    try {
      await login(returnTo);
    } catch (caught) {
      setError((caught as Error).message);
      setPending(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand"><span className="brand-mark"><Activity size={18} /></span><span>{t("app.name")}</span></div>
        <h2>{t("auth.welcome")}</h2>
        <p>{t("auth.subtitle")}</p>
        {!configured ? (
          <Alert tone="warn">
            {t("auth.notConfigured")} <code>{window.location.origin}/login/callback</code>
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <button className="primary-button auth-submit" disabled={!configured || pending} onClick={handleLogin}>
          <LogIn size={18} /> {pending ? t("auth.redirecting") : t("auth.continue")}
        </button>
        <AuthLinks>
          {hasPassword ? <button className="link-button" onClick={() => onNavigate("/forgot-password")} type="button">{t("auth.forgot")}</button> : null}
          <button className="link-button" onClick={() => onNavigate("/activate")} type="button">{t("auth.haveCode")}</button>
          <span>{t("auth.noAccount")}</span>
          <button className="link-button" onClick={() => onNavigate("/signup")} type="button">{t("auth.createAccount")}</button>
        </AuthLinks>
      </div>
    </div>
  );
}
