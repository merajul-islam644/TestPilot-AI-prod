import { Camera, Clock, Mail, RefreshCw, ShieldCheck, Trash2, UserRound, Users, Copy, Check } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "../../app/providers/AuthProvider";
import { blocksConfig } from "../../lib/blocks/config";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ChipList } from "../../shared/ui/Chip";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { StatusPill } from "../../shared/ui/StatusPill";
import { UserAvatar } from "../../shared/ui/UserAvatar";
import { useAvatar } from "./useAvatar";
import { useCurrentUser, userDisplayName, userInitials } from "./useCurrentUser";

export function ProfilePage() {
  const me = useCurrentUser();
  const { claims } = useAuth();
  const { t } = useT();
  const { avatar, isBusy, upload, remove } = useAvatar();
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const profile = me.data?.data;
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

  return (
    <section>
      <PageHeader
        title={t("profile.title")}
        subtitle={t("profile.subtitle")}
        actions={<ActionButton variant="icon" onClick={() => me.refetch()} title="Refresh profile" icon={<RefreshCw size={18} />} />}
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
            </>
          )}
        </div>
      </div>
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
