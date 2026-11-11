import { useState } from "react";
import { resetPassword } from "../../lib/blocks/auth";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Alert } from "../../shared/ui/Alert";
import { AuthLinks, AuthShell } from "./AuthShell";

/** Public reset-password: the recovery email's link lands here with the
 *  code in the query string. The confirm-password check is UI-only — the
 *  confirm field is never sent; IAM enforces the real password policy. */
export function ResetPasswordPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useT();
  // Read once at mount: a one-shot flow page has no reason to react to
  // later URL edits.
  const [code] = useState(() => new URLSearchParams(window.location.search).get("code") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (password !== confirm) {
      setError(t("profile.passwordMismatch"));
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      await resetPassword({ code, password });
      setDone(true);
    } catch (caught) {
      // IAM's policy/token errors surface as-is — it owns the rules.
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell subtitle={t("auth.resetSubtitle")} title={t("auth.resetTitle")}>
      {done ? (
        <Alert tone="info">{t("auth.resetDone")}</Alert>
      ) : !code ? (
        <Alert tone="warn">{t("auth.resetMissingCode")}</Alert>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <label className="form-field">
            <span>{t("profile.newPassword")}</span>
            <input autoComplete="new-password" autoFocus minLength={1} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          <label className="form-field">
            <span>{t("profile.confirmPassword")}</span>
            <input autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} required type="password" value={confirm} />
          </label>
          <button className="primary-button auth-submit" disabled={pending} type="submit">
            {pending ? t("common.loading") : t("auth.resetSubmit")}
          </button>
        </form>
      )}
      <AuthLinks>
        <button className="link-button" onClick={() => onNavigate("/login")} type="button">{t("auth.back")}</button>
      </AuthLinks>
    </AuthShell>
  );
}
