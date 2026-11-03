import { Camera, Clock, Mail, RefreshCw, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useRef } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../../app/providers/AuthProvider";
import { blocksConfig } from "../../lib/blocks/config";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ChipList } from "../../shared/ui/Chip";
import { JsonPanel } from "../../shared/ui/JsonPanel";
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
  const profile = me.data?.data;
  const name = userDisplayName(profile);
  const initials = userInitials(profile);
  const issuedAt = typeof claims?.iat === "number" ? new Date((claims.iat as number) * 1000) : undefined;
  const expiresAt = typeof claims?.exp === "number" ? new Date((claims.exp as number) * 1000) : undefined;
  const loading = me.isLoading;

  // The upload input lives next to the avatar: pick -> downscale -> Storage
  // -> UserPreference, all inside the useAvatar mutations.
  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) upload(file);
    event.target.value = "";
  }

  return (
    <section>
      <PageHeader
        title={t("profile.title")}
        subtitle={t("profile.subtitle")}
        actions={<ActionButton variant="icon" onClick={() => me.refetch()} title="Refresh profile" icon={<RefreshCw size={18} />} />}
      />

      <div className="panel profile-hero">
        {/* The whole photo opens the picker; the camera button stays the
            keyboard/AT-visible control. Buttons inside stop the bubble. */}
        <div
          className="profile-hero-avatar"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            if (!isBusy) fileInput.current?.click();
          }}
        >
          {loading ? (
            <Skeleton className="skeleton-avatar-lg" />
          ) : (
            <UserAvatar initials={initials} size="xl" url={avatar?.url} />
          )}
          {!loading ? (
            <>
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

        <div className="profile-heading">
          {loading ? <Skeleton className="skeleton-line-lg" /> : <h3>{name || (me.isError ? t("profile.sessionUnavailable") : t("profile.unknown"))}</h3>}
          {!loading && profile?.email ? <span className="muted"><Mail size={14} /> {profile.email}</span> : null}
          <div className="chips">
            <StatusPill tone={me.isSuccess ? "good" : "warn"}>
              {me.isSuccess ? t("profile.authenticated") : t("profile.sessionUnavailable")}
            </StatusPill>
            {!loading && profile?.roles?.[0] ? <span className="chip">{capitalize(profile.roles[0])}</span> : null}
          </div>
        </div>

        <div className="profile-facts">
          <Fact icon={<UserRound size={14} />} label={t("profile.userId")} loading={loading} value={profile?.itemId} />
          <Fact icon={<Clock size={14} />} label={t("profile.signedIn")} loading={loading} value={issuedAt?.toLocaleString()} />
          <Fact icon={<Clock size={14} />} label={t("profile.sessionExpires")} loading={loading} value={expiresAt?.toLocaleString()} />
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-title"><UserRound size={16} /><span>{t("profile.account")}</span></div>
          {loading ? <Skeleton className="skeleton-line" /> : (
            <div className="profile-facts">
              <Fact icon={<UserRound size={14} />} label={t("profile.userId")} value={profile?.itemId} />
              <Fact icon={<ShieldCheck size={14} />} label={t("profile.tenant")} value={blocksConfig.xBlocksKey} />
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title"><ShieldCheck size={16} /><span>{t("profile.session")}</span></div>
          {loading ? <Skeleton className="skeleton-line" /> : (
            <div className="profile-facts">
              <Fact icon={<Clock size={14} />} label={t("profile.signedIn")} value={issuedAt?.toLocaleTimeString()} />
              <Fact icon={<Clock size={14} />} label={t("profile.sessionExpires")} value={expiresAt?.toLocaleTimeString()} />
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><ShieldCheck size={16} /><span>{t("profile.roles")}</span></div>
        {loading ? <Skeleton className="skeleton-line" /> : <ChipList empty={t("profile.noRoles")} items={profile?.roles} />}
      </div>

      <div className="panel">
        <div className="panel-title"><ShieldCheck size={16} /><span>{`${t("profile.permissions")} (${profile?.permissions?.length ?? 0})`}</span></div>
        {loading ? <Skeleton className="skeleton-line" /> : <ChipList empty={t("profile.noPermissions")} items={profile?.permissions} />}
      </div>

      <details className="raw-details">
        <summary>{t("profile.raw")}</summary>
        <JsonPanel value={profile ?? me.error ?? me.data} />
      </details>
    </section>
  );
}

function Fact({ icon, label, loading, value }: { icon: ReactNode; label: string; loading?: boolean; value?: string }) {
  return (
    <div className="fact-row">
      <span className="fact-label">{icon}<span>{label}</span></span>
      {loading ? <Skeleton className="skeleton-line" /> : <strong className="fact-value mono">{value || "—"}</strong>}
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
