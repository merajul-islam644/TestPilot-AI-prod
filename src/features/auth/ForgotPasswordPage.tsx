import { useState } from "react";
import { recoverPassword } from "../../lib/blocks/auth";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Alert } from "../../shared/ui/Alert";
import { AuthLinks, AuthShell } from "./AuthShell";

/** Public "forgot password": collect the account email, let IAM send the
 *  recovery link. Success stays vague on purpose — the response never
 *  confirms whether the address exists, so neither does this page. */
export function ForgotPasswordPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !email.trim()) return;
    setError(undefined);
    setPending(true);
    try {
      await recoverPassword({ email: email.trim() });
      setSent(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell subtitle={t("auth.forgotSubtitle")} title={t("auth.forgotTitle")}>
      {sent ? (
        <Alert tone="info">{t("auth.forgotSent")}</Alert>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <label className="form-field">
            <span>{t("common.email")}</span>
            <input
              autoComplete="email"
              autoFocus
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <button className="primary-button auth-submit" disabled={pending} type="submit">
            {pending ? t("common.loading") : t("auth.forgotSubmit")}
          </button>
        </form>
      )}
      <AuthLinks>
        <button className="link-button" onClick={() => onNavigate("/login")} type="button">{t("auth.back")}</button>
      </AuthLinks>
    </AuthShell>
  );
}
