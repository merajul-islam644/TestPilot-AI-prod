import { useState } from "react";
import { signup } from "../../lib/blocks/auth";
import { useSignupSettings } from "../organizations/useOrganizationsAdmin";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Alert } from "../../shared/ui/Alert";
import { AuthLinks, AuthShell } from "./AuthShell";

/** Public self-signup. IAM owns account-creation rules (duplicate email,
 *  password policy, tenant signup policy) — its response/errors surface
 *  as-is; success routes to activation, which the confirmation email
 *  drives. The public signup policy is read first: when the tenant turned
 *  email+password signup off, the form yields to a notice. A failed policy
 *  read falls OPEN (same rule as login options) — a broken call must never
 *  hide the form. */
export function SignupPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useT();
  const policy = useSignupSettings();
  // Both switches matter: the tenant master (`isSignUpEnable`) and the
  // email+password method (`isEmailPasswordSignUpEnabled`) — this form only
  // covers the email+password path.
  const signupClosed = policy.settings
    ? !policy.settings.isSignUpEnable || !policy.settings.isEmailPasswordSignUpEnabled
    : false;
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
      await signup({
        email: email.trim(),
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

  return (
    <AuthShell subtitle={t("auth.signupSubtitle")} title={t("auth.signupTitle")}>
      {done ? (
        <Alert tone="info">{t("auth.signupDone")}</Alert>
      ) : signupClosed ? (
        <Alert tone="info">{t("auth.signupDisabled")}</Alert>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <label className="form-field">
            <span>{t("common.email")}</span>
            <input autoComplete="email" autoFocus onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <label className="form-field">
              <span>{t("profile.firstName")}</span>
              <input autoComplete="given-name" onChange={(event) => setFirstName(event.target.value)} type="text" value={firstName} />
            </label>
            <label className="form-field">
              <span>{t("profile.lastName")}</span>
              <input autoComplete="family-name" onChange={(event) => setLastName(event.target.value)} type="text" value={lastName} />
            </label>
          </div>
          <label className="form-field">
            <span>{t("common.password")}</span>
            <input autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          <label className="form-field">
            <span>{t("profile.confirmPassword")}</span>
            <input autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} required type="password" value={confirm} />
          </label>
          <button className="primary-button auth-submit" disabled={pending} type="submit">
            {pending ? t("common.loading") : t("auth.signupSubmit")}
          </button>
        </form>
      )}
      <AuthLinks>
        <span>{t("auth.haveAccount")}</span>
        <button className="link-button" onClick={() => onNavigate("/login")} type="button">{t("auth.back")}</button>
      </AuthLinks>
    </AuthShell>
  );
}
