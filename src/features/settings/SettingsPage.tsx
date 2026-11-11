import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  Bell,
  Building2,
  Check,
  CircleUserRound,
  Palette,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";
import { useTheme } from "../../app/providers/ThemeProvider";
import { useRoute } from "../../app/router/routes";
import { resetDemoData } from "../../lib/demo/store";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { getDefaultEnvironment, setDefaultEnvironment, setWorkspaceName, useWorkspaceName } from "../../shared/useWorkspaceName";
import type { DefaultEnvironment } from "../../shared/useWorkspaceName";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Select } from "../../shared/ui/select";
import { Switch } from "../../shared/ui/Switch";
import { UserAvatar } from "../../shared/ui/UserAvatar";
import { MfaPolicyAdmin } from "../mfa/MfaPolicyAdmin";
import { MfaSection } from "../mfa/MfaSection";
import { useAvatar } from "../profile/useAvatar";
import { useCurrentUser, userDisplayName, userInitials } from "../profile/useCurrentUser";

type Section = "general" | "workspace" | "profile" | "security" | "notifications" | "appearance";

// One meta record per section drives BOTH the rail and the content header,
// so a section's face (icon + title + description) is identical everywhere
// it appears and a new section is a single entry to add.
const SECTION_META: Record<Section, {
  descKey: TranslationKey;
  icon: LucideIcon;
  labelKey: TranslationKey;
}> = {
  general: { descKey: "settings.sectionDesc.general", icon: SlidersHorizontal, labelKey: "settings.section.general" },
  workspace: { descKey: "settings.sectionDesc.workspace", icon: Building2, labelKey: "settings.section.workspace" },
  profile: { descKey: "settings.sectionDesc.profile", icon: CircleUserRound, labelKey: "settings.section.profile" },
  security: { descKey: "settings.sectionDesc.security", icon: ShieldCheck, labelKey: "settings.section.security" },
  notifications: { descKey: "settings.sectionDesc.notifications", icon: Bell, labelKey: "settings.section.notifications" },
  appearance: { descKey: "settings.sectionDesc.appearance", icon: Palette, labelKey: "settings.section.appearance" }
};

const SECTIONS: Section[] = ["general", "workspace", "profile", "security", "notifications", "appearance"];

const ENV_OPTIONS = [
  { id: "production" as const, labelKey: "env.production" as TranslationKey },
  { id: "staging" as const, labelKey: "env.staging" as TranslationKey },
  { id: "sandbox" as const, labelKey: "env.sandbox" as TranslationKey }
];

function useLocalFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => (localStorage.getItem(key) === null ? initial : localStorage.getItem(key) === "true"));
  const update = (next: boolean) => {
    localStorage.setItem(key, String(next));
    setValue(next);
  };
  return [value, update];
}

/** One labelled setting inside a card: title + hint on the left, the control
 *  on the right. Every section composes these, so the page has a single
 *  reading rhythm. */
function SettingRow({ control, hint, title }: { control: React.ReactNode; hint: string; title: string }) {
  return (
    <div className="settings-card-row">
      <div className="settings-card-copy">
        <strong>{title}</strong>
        <p>{hint}</p>
      </div>
      <div className="settings-control">{control}</div>
    </div>
  );
}

export function SettingsPage() {
  const { t, language, languages, setLanguage } = useT();
  const { navigate } = useRoute();
  const { preference, setPreference } = useTheme();
  const me = useCurrentUser();
  const profile = me.data?.data;
  const workspaceName = useWorkspaceName();
  const { avatar } = useAvatar();

  const [section, setSection] = useState<Section>("general");
  const [nameDraft, setNameDraft] = useState(workspaceName || "TestPilot AI");
  const [envDraft, setEnvDraft] = useState<DefaultEnvironment>(() => getDefaultEnvironment());
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [notifyFailedRuns, setNotifyFailedRuns] = useLocalFlag("testpilot:notif:failedRuns", true);
  const [notifyDigest, setNotifyDigest] = useLocalFlag("testpilot:notif:digest", true);
  const [notifyAssigned, setNotifyAssigned] = useLocalFlag("testpilot:notif:assigned", true);

  useEffect(() => {
    if (!savedFlash) return;
    const id = window.setTimeout(() => setSavedFlash(false), 2500);
    return () => window.clearTimeout(id);
  }, [savedFlash]);

  function handleSave() {
    setWorkspaceName(nameDraft.trim() || "TestPilot AI");
    setDefaultEnvironment(envDraft);
    setSavedFlash(true);
  }

  const ActiveIcon = SECTION_META[section].icon;
  const activeEnvLabel = ENV_OPTIONS.find((option) => option.id === envDraft)?.labelKey;

  return (
    <section>
      <PageHeader subtitle={t("settings.subtitle")} title={t("settings.title")} />

      <div className="settings-shell">
        <aside className="settings-rail">
          <div className="settings-identity">
            <UserAvatar initials={userInitials(profile)} size="sm" url={avatar?.url} />
            <div className="settings-identity-copy">
              <strong>{userDisplayName(profile) || (me.isLoading ? "…" : "—")}</strong>
              <span className="settings-identity-mail">{profile?.email ?? " "}</span>
            </div>
          </div>
          <nav aria-label={t("settings.title")} className="settings-rail-nav">
            {SECTIONS.map((id) => {
              const meta = SECTION_META[id];
              const Icon = meta.icon;
              return (
                <button
                  aria-current={id === section ? "true" : undefined}
                  className={id === section ? "on" : ""}
                  key={id}
                  onClick={() => setSection(id)}
                >
                  <Icon size={15} />
                  <span className="settings-rail-text">
                    <span className="settings-rail-label">{t(meta.labelKey)}</span>
                    <span className="settings-rail-desc">{t(meta.descKey)}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="settings-content">
          <header className="settings-head">
            <span className="settings-head-icon"><ActiveIcon size={17} /></span>
            <div>
              <h3>{t(SECTION_META[section].labelKey)}</h3>
              <p>{t(SECTION_META[section].descKey)}</p>
            </div>
          </header>

          {section === "general" ? (
            <div className="settings-card">
              <SettingRow
                control={<input onChange={(event) => setNameDraft(event.target.value)} value={nameDraft} />}
                hint={t("settings.general.nameHint")}
                title={t("settings.general.name")}
              />
              <SettingRow
                control={(
                  <Select
                    items={(languages.length > 0 ? languages : [{ code: language, isDefault: true, name: language }]).map((entry) => ({ value: entry.code, label: entry.name }))}
                    onChange={setLanguage}
                    value={language}
                  />
                )}
                hint={t("settings.general.languageHint")}
                title={t("settings.general.language")}
              />
              <SettingRow
                control={(
                  <Select
                    items={ENV_OPTIONS.map((option) => ({ value: option.id, label: t(option.labelKey) }))}
                    onChange={(value) => setEnvDraft(value as DefaultEnvironment)}
                    value={envDraft}
                  />
                )}
                hint={t("settings.general.envHint")}
                title={t("settings.general.env")}
              />
              <div className="settings-card-footer">
                {savedFlash ? <span className="alert alert-success">{t("settings.general.saved")}</span> : null}
                <button className="primary-button" onClick={handleSave}>{t("common.save")}</button>
              </div>
            </div>
          ) : null}

          {section === "workspace" ? (
            <div className="settings-card">
              <SettingRow
                control={<span className="chip">{workspaceName || "TestPilot AI"}</span>}
                hint={t("settings.general.nameHint")}
                title={t("settings.general.name")}
              />
              <SettingRow
                control={<span className="chip">{activeEnvLabel ? t(activeEnvLabel) : "—"}</span>}
                hint={t("settings.general.envHint")}
                title={t("settings.general.env")}
              />
              <SettingRow
                control={(
                  <button className="secondary-button" onClick={() => navigate("/users")}>
                    {t("settings.workspace.openUsers")} <ArrowUpRight size={14} />
                  </button>
                )}
                hint={t("settings.workspace.manage")}
                title={t("settings.workspace.members")}
              />
            </div>
          ) : null}

          {section === "profile" ? (
            <div className="profile-card">
              <UserAvatar initials={userInitials(profile)} size="lg" url={avatar?.url} />
              <div className="profile-heading">
                <h3>{userDisplayName(profile) || (me.isLoading ? t("common.loading") : "—")}</h3>
                {profile?.email ? <span className="muted">{profile.email}</span> : null}
                <p className="field-hint" style={{ margin: 0 }}>{t("settings.profile.hint")}</p>
                <div>
                  <button className="secondary-button" onClick={() => navigate("/profile")}>
                    {t("settings.profile.viewFull")} <ArrowUpRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {section === "security" ? (
            <>
              <MfaSection />
              <MfaPolicyAdmin />
            </>
          ) : null}

          {section === "notifications" ? (
            <div className="settings-card">
              <SettingRow
                control={<Switch checked={notifyFailedRuns} label={t("settings.notifications.failedRuns")} onChange={setNotifyFailedRuns} />}
                hint={t("settings.notifications.failedRunsHint")}
                title={t("settings.notifications.failedRuns")}
              />
              <SettingRow
                control={<Switch checked={notifyDigest} label={t("settings.notifications.digest")} onChange={setNotifyDigest} />}
                hint={t("settings.notifications.digestHint")}
                title={t("settings.notifications.digest")}
              />
              <SettingRow
                control={<Switch checked={notifyAssigned} label={t("settings.notifications.assigned")} onChange={setNotifyAssigned} />}
                hint={t("settings.notifications.assignedHint")}
                title={t("settings.notifications.assigned")}
              />
            </div>
          ) : null}

          {section === "appearance" ? (
            <div className="settings-card">
              <div className="settings-card-row settings-card-row-stack">
                <div className="settings-card-copy">
                  <strong>{t("settings.appearance.theme")}</strong>
                  <p>{t("settings.appearance.themeHint")}</p>
                </div>
                <div aria-label={t("settings.appearance.theme")} className="theme-previews" role="radiogroup">
                  {(["system", "light", "dark"] as const).map((choice) => {
                    const selected = preference === choice;
                    return (
                      <button
                        aria-checked={selected}
                        className="theme-preview"
                        key={choice}
                        onClick={() => setPreference(choice)}
                        role="radio"
                        type="button"
                      >
                        {selected ? <Check className="theme-preview-check" size={14} /> : null}
                        <span aria-hidden className={`theme-preview-mini is-${choice}`}>
                          {choice === "system" ? (
                            <>
                              <span className="theme-half is-light-half">
                                <span className="theme-mini-side" /><span className="theme-mini-line is-accent" /><span className="theme-mini-line" />
                              </span>
                              <span className="theme-half is-dark-half">
                                <span className="theme-mini-side" /><span className="theme-mini-line is-accent" /><span className="theme-mini-line" />
                              </span>
                            </>
                          ) : (
                            <span className={`theme-half ${choice === "light" ? "is-light-half" : "is-dark-half"}`}>
                              <span className="theme-mini-side" /><span className="theme-mini-line is-accent" /><span className="theme-mini-line" />
                            </span>
                          )}
                        </span>
                        <span className="theme-preview-label">{t(`settings.appearance.${choice}` as TranslationKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="settings-card-footer">
                <p className="field-hint" style={{ margin: 0 }}>{t("settings.appearance.motion")}</p>
              </div>
            </div>
          ) : null}

          <div className="panel danger-zone">
            <div className="panel-head">
              <div>
                <h3 className="panel-title" style={{ color: "hsl(var(--destructive))" }}>{t("settings.danger.title")}</h3>
                <p className="panel-desc">{t("settings.danger.desc")}</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="danger-button" onClick={() => setConfirmingReset(true)}>{t("settings.danger.reset")}</button>
              {resetDone ? <span className="alert alert-success" style={{ padding: "6px 10px" }}>{t("settings.danger.resetDone")}</span> : null}
            </div>
          </div>
        </div>
      </div>

      {confirmingReset ? (
        <ConfirmDialog
          confirmLabel={t("settings.danger.reset")}
          message={t("settings.danger.confirmMessage")}
          onCancel={() => setConfirmingReset(false)}
          onConfirm={() => {
            resetDemoData();
            setConfirmingReset(false);
            setResetDone(true);
            window.setTimeout(() => setResetDone(false), 3000);
          }}
          title={t("settings.danger.confirmTitle")}
        />
      ) : null}
    </section>
  );
}
