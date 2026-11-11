import { Camera, Check, Clock, Copy, KeyRound, LogOut, Mail, Pencil, RefreshCw, ShieldCheck, Trash2, UserRound, Users } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "../../app/providers/AuthProvider";
import { changePassword, logoutAllDevices } from "../../lib/blocks/auth";
import { blocksClient } from "../../lib/blocks/client";
import { blocksConfig } from "../../lib/blocks/config";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ChipList } from "../../shared/ui/Chip";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Modal } from "../../shared/ui/Modal";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { StatusPill } from "../../shared/ui/StatusPill";
import { UserAvatar } from "../../shared/ui/UserAvatar";
import { useAvatar } from "./useAvatar";
import { useCurrentUser, userDisplayName, userInitials } from "./useCurrentUser";
import { Alert } from "../../shared/ui/Alert";

export function ProfilePage() {
  const me = useCurrentUser();
  const { claims, logout, refresh } = useAuth();
  const { t } = useT();
  const { avatar, isBusy, upload, remove } = useAvatar();
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const profile = me.data?.data;

  // --- Self-service state: profile edit, password change, session teardown.
  const [editing, setEditing] = useState(false);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>();

  const [confirmAll, setConfirmAll] = useState(false);
  const [signOutAllPending, setSignOutAllPending] = useState(false);
  const name = userDisplayName(profile);
  const initials = userInitials(profile);
  const issuedAt = typeof claims?.iat === "number" ? new Date((claims.iat as number) * 1000) : undefined;
  const expiresAt = typeof claims?.exp === "number" ? new Date((claims.exp as number) * 1000) : undefined;
  const orgId = typeof claims?.org_id === "string" ? (claims.org_id as string) : undefined;
  const loading = me.isLoading;
  const authenticated = me.isSuccess;

  // The upload input lives next to the avatar: pick -> downscale -> Storage
  // -> UserPreference, all inside the useAvatar mutations.
  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) upload(file);
    event.target.value = "";
  }

  async function copyUserId() {
    const id = profile?.itemId;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      toast(t("toast.copied"));
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied -- silently keep the id selectable.
    }
  }

  function openEdit() {
    setEditFirst(profile?.firstName ?? "");
    setEditLast(profile?.lastName ?? "");
    setEditing(true);
  }

  // iam.updateMe resolves the user from the token — never a user id here.
  // Names trim to "" when cleared: the sparse contract keeps omitted
  // values, so an intentional clear must still send the field.
  async function saveProfile() {
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      await blocksClient.iam.updateMe({ firstName: editFirst.trim(), lastName: editLast.trim() });
      await me.refetch();
      toast(t("common.saved"));
      setEditing(false);
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (passwordPending) return;
    if (newPassword !== confirmPassword) {
      setPasswordError(t("profile.passwordMismatch"));
      return;
    }
    setPasswordError(undefined);
    setPasswordPending(true);
    try {
      // Current + new — IAM verifies the current password and enforces the
      // tenant's policy on the new one; its errors surface as-is.
      await changePassword({ newPassword, oldPassword: currentPassword });
      toast(t("profile.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (caught) {
      setPasswordError((caught as Error).message);
    } finally {
      setPasswordPending(false);
    }
  }

  // "Sign out everywhere": logoutAll invalidates every session server-side,
  // then the normal logout clears this app's local state, then refresh()
  // lets RequireAuth bounce to /login — no manual navigation needed.
  async function signOutEverywhere() {
    if (signOutAllPending) return;
    setSignOutAllPending(true);
    setConfirmAll(false);
    try {
      await logoutAllDevices();
      toast(t("profile.signedOutEverywhere"));
    } catch {
      // IAM may already have ended the sessions — keep tearing down locally.
    }
    try {
      await logout();
    } finally {
      setSignOutAllPending(false);
      await refresh();
    }
  }

  return (
    <section>
      <PageHeader
        title={t("profile.title")}
        subtitle={t("profile.subtitle")}
        actions={
          <>
            <ActionButton icon={<Pencil size={16} />} onClick={openEdit} title={t("profile.editAction")} variant="icon" />
            <ActionButton icon={<RefreshCw size={18} />} onClick={() => me.refetch()} title="Refresh profile" variant="icon" />
          </>
        }
      />

      <div className="panel identity-hero">
        <div className="identity-body">
          {/* The whole photo opens the picker; the camera button stays the
              keyboard/AT-visible control. Buttons inside stop the bubble.
              The dot on the photo mirrors the session pill. */}
          <div
            className={isBusy ? "identity-avatar is-busy" : "identity-avatar"}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              if (!isBusy) fileInput.current?.click();
            }}
          >
            {loading ? (
              <Skeleton className="skeleton-avatar-hero" />
            ) : (
              <UserAvatar initials={initials} size="xl" url={avatar?.url} />
            )}
            {!loading ? (
              <>
                <span className={authenticated ? "identity-dot" : "identity-dot warn"} aria-hidden="true" />
                <button
                  aria-label={t("profile.avatar.change")}
                  className="avatar-edit"
                  disabled={isBusy}
                  onClick={() => fileInput.current?.click()}
                  title={t("profile.avatar.change")}
                  type="button"
                >
                  <Camera size={15} />
                </button>
                {avatar && !isBusy ? (
                  <button
                    aria-label={t("profile.avatar.remove")}
                    className="avatar-remove"
                    onClick={remove}
                    title={t("profile.avatar.remove")}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </>
            ) : null}
            <input accept="image/*" hidden onChange={onPickFile} ref={fileInput} type="file" />
          </div>

          <div className="identity-main">
            {loading ? <Skeleton className="skeleton-line-lg" /> : (
              <h3 className="identity-name">{name || (me.isError ? t("profile.sessionUnavailable") : t("profile.unknown"))}</h3>
            )}
            {!loading && profile?.email ? <span className="muted"><Mail size={14} /> {profile.email}</span> : null}
            <div className="chips">
              <StatusPill tone={authenticated ? "good" : "warn"}>
                {authenticated ? t("profile.authenticated") : t("profile.sessionUnavailable")}
              </StatusPill>
              {!loading && profile?.roles?.[0] ? <span className="chip">{capitalize(profile.roles[0])}</span> : null}
            </div>
          </div>
        </div>

        {/* ID-card footer: the stable identifiers live on the hero itself,
            so the panels below can carry access and session detail. */}
        {!loading && (profile?.itemId || blocksConfig.xBlocksKey) ? (
          <div className="identity-foot">
            {profile?.itemId ? (
              <span className="identity-foot-item">
                <span className="identity-foot-label">{t("profile.userId")}</span>
                <span className="mono">{profile.itemId}</span>
                <button
                  aria-label={t("profile.copyId")}
                  className="identity-copy"
                  onClick={copyUserId}
                  title={t("profile.copyId")}
                  type="button"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </span>
            ) : null}
            {blocksConfig.xBlocksKey ? (
              <span className="identity-foot-item">
                <span className="identity-foot-label">{t("profile.tenantShort")}</span>
                <span className="mono">{blocksConfig.xBlocksKey}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid-2 profile-grid">
        <div className="panel">
          <div className="panel-title"><ShieldCheck size={16} /><span>{t("profile.access")}</span></div>
          {loading ? <Skeleton className="skeleton-line" /> : (
            <>
              <p className="identity-group-label">{t("profile.roles")}</p>
              <ChipList empty={t("profile.noRoles")} items={profile?.roles} />
              <p className="identity-group-label">{t("profile.permissions")}</p>
              <ChipList empty={t("profile.noPermissions")} items={profile?.permissions} />
            </>
          )}
        </div>

        <div className="panel">
          <div className="panel-title"><Clock size={16} /><span>{t("profile.session")}</span></div>
          {loading ? <Skeleton className="skeleton-line" /> : (
            <>
              {issuedAt ? <Fact icon={<Clock size={14} />} label={t("profile.signedIn")} value={issuedAt.toLocaleString()} /> : null}
              {expiresAt ? <Fact icon={<Clock size={14} />} label={t("profile.sessionExpires")} value={expiresAt.toLocaleString()} /> : null}
              {orgId ? <Fact icon={<Users size={14} />} label={t("profile.org")} value={orgId} /> : null}
              {!issuedAt && !expiresAt ? <p className="identity-note muted">{t("profile.sessionTimesUnavailable")}</p> : null}
              <div className="identity-note" style={{ borderTop: "1px solid hsl(var(--border))", marginTop: 10, paddingTop: 12 }}>
                <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>{t("profile.signOutEverywhereHint")}</p>
                <button
                  className="secondary-button"
                  disabled={signOutAllPending}
                  onClick={() => setConfirmAll(true)}
                  type="button"
                >
                  <LogOut size={14} /> {t("profile.signOutEverywhere")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Account security: the signed-in password change sits apart from the
          identity cards — it acts on the credential, not the profile. */}
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-title"><KeyRound size={16} /><span>{t("profile.changePassword")}</span></div>
        <form onSubmit={submitPassword} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
          {passwordError ? <Alert tone="error">{passwordError}</Alert> : null}
          <label className="form-field">
            <span>{t("profile.currentPassword")}</span>
            <input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} />
          </label>
          <label className="form-field">
            <span>{t("profile.newPassword")}</span>
            <input autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} />
          </label>
          <label className="form-field">
            <span>{t("profile.confirmPassword")}</span>
            <input autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
          </label>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{t("profile.changePasswordHint")}</p>
          <div>
            <button className="primary-button" disabled={passwordPending} type="submit">
              {passwordPending ? t("common.loading") : t("profile.changePassword")}
            </button>
          </div>
        </form>
      </div>

      {editing ? (
        <Modal onClose={() => setEditing(false)} title={t("profile.editTitle")}>
          <div style={{ display: "grid", gap: 12 }}>
            <label className="form-field">
              <span>{t("profile.firstName")}</span>
              <input autoFocus onChange={(event) => setEditFirst(event.target.value)} type="text" value={editFirst} />
            </label>
            <label className="form-field">
              <span>{t("profile.lastName")}</span>
              <input onChange={(event) => setEditLast(event.target.value)} type="text" value={editLast} />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setEditing(false)} type="button">{t("common.cancel")}</button>
              <button className="primary-button" disabled={savingProfile} onClick={() => void saveProfile()} type="button">
                {savingProfile ? t("common.loading") : t("common.save")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {confirmAll ? (
        <ConfirmDialog
          confirmLabel={t("profile.signOutEverywhere")}
          message={t("profile.signOutEverywhereHint")}
          onCancel={() => setConfirmAll(false)}
          onConfirm={() => void signOutEverywhere()}
          title={t("profile.signOutEverywhereTitle")}
        />
      ) : null}
    </section>
  );
}

/** A label/value row that only renders when there is something to show --
    an empty "—" row is noise, not information. */
function Fact({ icon, label, value }: { icon: ReactNode; label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="fact-row">
      <span className="fact-label">{icon}<span>{label}</span></span>
      <strong className="fact-value mono">{value}</strong>
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
