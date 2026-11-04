import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useTheme } from "../../app/providers/ThemeProvider";
import { useRoute } from "../../app/router/routes";
import { resetDemoData } from "../../lib/demo/store";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { getDefaultEnvironment, setDefaultEnvironment, setWorkspaceName, useWorkspaceName } from "../../shared/useWorkspaceName";
import type { DefaultEnvironment } from "../../shared/useWorkspaceName";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Segmented } from "../../shared/ui/Segmented";
import type { SegmentOption } from "../../shared/ui/Segmented";
import { Select } from "../../shared/ui/select";
import { Switch } from "../../shared/ui/Switch";
import { useCurrentUser, userDisplayName, userInitials } from "../profile/useCurrentUser";

type Section = "general" | "workspace" | "profile" | "notifications" | "appearance";

const SECTION_KEYS: Record<Section, TranslationKey> = {
  general: "settings.section.general",
  workspace: "settings.section.workspace",
  profile: "settings.section.profile",
  notifications: "settings.section.notifications",
  appearance: "settings.section.appearance"
};

const SECTIONS: Section[] = ["general", "workspace", "profile", "notifications", "appearance"];

const MEMBERS: { name: string; roleKey: TranslationKey }[] = [
  { name: "Maya Lindqvist", roleKey: "settings.role.owner" },
  { name: "Tomas Rivera", roleKey: "settings.role.member" },
  { name: "Priya Nair", roleKey: "settings.role.member" },
  { name: "Jonas Weber", roleKey: "settings.role.member" },
  { name: "Amara Osei", roleKey: "settings.role.viewer" },
  { name: "Liu Wei", roleKey: "settings.role.viewer" }
];

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

export function SettingsPage() {
  const { t, language, languages, setLanguage } = useT();
  const { navigate } = useRoute();
  const { preference, setPreference } = useTheme();
  const me = useCurrentUser();
  const profile = me.data?.data;
  const workspaceName = useWorkspaceName();

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

  const themeOptions: SegmentOption<"system" | "light" | "dark">[] = [
    { id: "system", label: t("settings.appearance.system") },
    { id: "light", label: t("settings.appearance.light") },
    { id: "dark", label: t("settings.appearance.dark") }
  ];

  function handleSave() {
    setWorkspaceName(nameDraft.trim() || "TestPilot AI");
    setDefaultEnvironment(envDraft);
    setSavedFlash(true);
  }

  return (
    <section>
      <PageHeader subtitle={t("settings.subtitle")} title={t("settings.title")} />

      <div className="settings-grid">
        <nav aria-label={t("settings.title")} className="settings-nav">
          {SECTIONS.map((entry) => (
            <button className={entry === section ? "on" : ""} key={entry} onClick={() => setSection(entry)}>
              {t(SECTION_KEYS[entry])}
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          {section === "general" ? (
            <>
              <div className="settings-section">
                <h4>{t("settings.general.name")}</h4>
                <p>{t("settings.general.nameHint")}</p>
                <div className="form-field" style={{ maxWidth: 320 }}>
                  <input onChange={(event) => setNameDraft(event.target.value)} value={nameDraft} />
                </div>
              </div>
              <div className="settings-section">
                <h4>{t("settings.general.language")}</h4>
                <p>{t("settings.general.languageHint")}</p>
                <div className="form-field" style={{ maxWidth: 320 }}>
                  <Select
                    className="w-full"
                    items={(languages.length > 0 ? languages : [{ code: language, isDefault: true, name: language }]).map((entry) => ({ value: entry.code, label: entry.name }))}
                    onChange={setLanguage}
                    value={language}
                  />
                </div>
              </div>
              <div className="settings-section">
                <h4>{t("settings.general.env")}</h4>
                <p>{t("settings.general.envHint")}</p>
                <div className="form-field" style={{ maxWidth: 320 }}>
                  <Select
                    className="w-full"
                    items={ENV_OPTIONS.map((option) => ({ value: option.id, label: t(option.labelKey) }))}
                    onChange={(value) => setEnvDraft(value as DefaultEnvironment)}
                    value={envDraft}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button className="primary-button" onClick={handleSave}>{t("common.save")}</button>
                {savedFlash ? <span className="alert alert-success" style={{ padding: "6px 10px" }}>{t("settings.general.saved")}</span> : null}
              </div>
            </>
          ) : null}

          {section === "workspace" ? (
            <>
              <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("common.name")}</th>
                      <th scope="col">{t("settings.workspace.role")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MEMBERS.map((member) => (
                      <tr key={member.name}>
                        <td>{member.name}</td>
                        <td><span className="chip">{t(member.roleKey)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="field-hint">{t("settings.workspace.manage")}</p>
            </>
          ) : null}

          {section === "profile" ? (
            <div className="profile-card">
              <span className="avatar avatar-lg">{userInitials(profile)}</span>
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

          {section === "notifications" ? (
            <>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.notifications.failedRuns")}</strong>
                  <p>{t("settings.notifications.failedRunsHint")}</p>
                </div>
                <Switch checked={notifyFailedRuns} label={t("settings.notifications.failedRuns")} onChange={setNotifyFailedRuns} />
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.notifications.digest")}</strong>
                  <p>{t("settings.notifications.digestHint")}</p>
                </div>
                <Switch checked={notifyDigest} label={t("settings.notifications.digest")} onChange={setNotifyDigest} />
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.notifications.assigned")}</strong>
                  <p>{t("settings.notifications.assignedHint")}</p>
                </div>
                <Switch checked={notifyAssigned} label={t("settings.notifications.assigned")} onChange={setNotifyAssigned} />
              </div>
            </>
          ) : null}

          {section === "appearance" ? (
            <>
              <div className="settings-section">
                <h4>{t("settings.appearance.theme")}</h4>
                <p>{t("settings.appearance.themeHint")}</p>
                <Segmented onChange={setPreference} options={themeOptions} value={preference} />
              </div>
              <p className="field-hint">{t("settings.appearance.motion")}</p>
            </>
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
