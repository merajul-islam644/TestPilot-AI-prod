import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { activateAccount, resendActivation, validateActivation } from "../../lib/blocks/auth";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Alert } from "../../shared/ui/Alert";
import { AuthLinks, AuthShell } from "./AuthShell";

/** Public activation: an invited user finishes account setup here. The
 *  emailed code is validated BEFORE the password form renders, so a dead
 *  or expired link fails fast with a resend option instead of after the
 *  user has filled the form. */
export function ActivateAccountPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useT();
  // Read once at mount — one-shot flow page, same as reset-password.
  const [code] = useState(() => new URLSearchParams(window.location.search).get("code") ?? "");

  // Fast pre-check (public — the code itself is the credential). A response
  // that explicitly says valid:false counts as dead even on HTTP 200; the
  // SDK's shape is IAM's contract, so treat anything else as usable.
  const check = useQuery({
    enabled: code !== "",
    queryFn: () => validateActivation({ code }),
    queryKey: ["auth", "activationCheck", code],
    retry: false,
    staleTime: Infinity
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  // Resend branch state (only reachable from the invalid-code screen).
  const [resendEmail, setResendEmail] = useState("");
  const [resendPending, setResendPending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | undefined>();

  const dead = code === "" || check.isError || (check.isSuccess && (check.data as Record<string, unknown> | undefined)?.valid === false);

  async function handleActivate(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (password !== confirm) {
      setError(t("profile.passwordMismatch"));
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      await activateAccount({
        code,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        password
      });
      setDone(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function handleResend(event: React.FormEvent) {
    event.preventDefault();
    if (resendPending || !resendEmail.trim()) return;
    setResendError(undefined);
    setResendPending(true);
    try {
      await resendActivation({ email: resendEmail.trim() });
      setResent(true);
    } catch (caught) {
      setResendError((caught as Error).message);
    } finally {
      setResendPending(false);
    }
  }

  return (
    <AuthShell subtitle={t("auth.activateSubtitle")} title={t("auth.activateTitle")}>
      {done ? (
        <Alert tone="info">{t("auth.activateDone")}</Alert>
      ) : dead ? (
        // The link never made it: still let the person recover — a fresh
        // code goes out to the account's email.
        <div style={{ display: "grid", gap: 12 }}>
          <Alert tone="warn">{code === "" ? t("auth.activateMissingCode") : t("auth.activateInvalid")}</Alert>
          {resent ? (
            <Alert tone="info">{t("auth.resent")}</Alert>
          ) : (
            <form onSubmit={handleResend} style={{ display: "grid", gap: 12 }}>
              <p style={{ fontWeight: 600, margin: 0 }}>{t("auth.activateResendTitle")}</p>
              <p style={{ margin: 0 }}>{t("auth.activateResendSubtitle")}</p>
              {resendError ? <Alert tone="error">{resendError}</Alert> : null}
              <label className="form-field">
                <span>{t("common.email")}</span>
                <input autoComplete="email" onChange={(event) => setResendEmail(event.target.value)} required type="email" value={resendEmail} />
              </label>
              <button className="primary-button auth-submit" disabled={resendPending} type="submit">
                {resendPending ? t("common.loading") : t("auth.resend")}
              </button>
            </form>
          )}
        </div>
      ) : (
        <form onSubmit={handleActivate} style={{ display: "grid", gap: 12 }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <label className="form-field">
            <span>{t("profile.firstName")}</span>
            <input autoComplete="given-name" onChange={(event) => setFirstName(event.target.value)} type="text" value={firstName} />
          </label>
          <label className="form-field">
            <span>{t("profile.lastName")}</span>
            <input autoComplete="family-name" onChange={(event) => setLastName(event.target.value)} type="text" value={lastName} />
          </label>
          <label className="form-field">
            <span>{t("profile.newPassword")}</span>
            <input autoComplete="new-password" autoFocus onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          <label className="form-field">
            <span>{t("profile.confirmPassword")}</span>
            <input autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} required type="password" value={confirm} />
          </label>
          <button className="primary-button auth-submit" disabled={pending} type="submit">
            {pending ? t("common.loading") : t("auth.activateSubmit")}
          </button>
        </form>
      )}
      <AuthLinks>
        <button className="link-button" onClick={() => onNavigate("/login")} type="button">{t("auth.back")}</button>
      </AuthLinks>
    </AuthShell>
  );
}
