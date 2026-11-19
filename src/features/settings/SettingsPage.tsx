import { useState } from "react";
import { Bell, Check, Palette, ShieldCheck } from "lucide-react";
import { useTheme } from "../../app/providers/ThemeProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Switch } from "../../shared/ui/Switch";
import { MfaPolicyAdmin } from "../mfa/MfaPolicyAdmin";
import { MfaSection } from "../mfa/MfaSection";

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

/** Section header: icon tile + title + one-line description. */
function SectionHead({ descKey, icon: Icon, labelKey }: { descKey: TranslationKey; icon: typeof ShieldCheck; labelKey: TranslationKey }) {
  const { t } = useT();
  return (
    <header className="settings-section-head">
      <span className="settings-section-icon"><Icon size={17} /></span>
      <div>
        <h3>{t(labelKey)}</h3>
        <p>{t(descKey)}</p>
      </div>
    </header>
  );
}

export function SettingsPage() {
  const { t } = useT();
  const { preference, setPreference } = useTheme();

  const [notifyFailedRuns, setNotifyFailedRuns] = useLocalFlag("testpilot:notif:failedRuns", true);
  const [notifyDigest, setNotifyDigest] = useLocalFlag("testpilot:notif:digest", true);
  const [notifyAssigned, setNotifyAssigned] = useLocalFlag("testpilot:notif:assigned", true);

  return (
    <section>
      {/* No subtitle: settings.subtitle is a TENANT-wide dictionary key, so
          the shared localization store leaked another of the user's apps'
          copy here ("Mess, meal, and account preferences"). The title alone
          says everything a settings page needs. */}
      <PageHeader title={t("settings.title")} />

      {/* Single-scroll settings: each preference area is its own headed card
          in one column — no rail, no tab switching, everything on one page. */}
      <div className="settings-stack">
        <div className="settings-section">
          <SectionHead descKey="settings.sectionDesc.security" icon={ShieldCheck} labelKey="settings.section.security" />
          <div className="settings-card">
            {/* MFA renders free-form sections (not SettingRows), so it rides
                in a padded body — otherwise its text would hug the card
                borders, unlike the row-based cards beside it. */}
            <div className="settings-card-body">
              <MfaSection />
              <MfaPolicyAdmin />
            </div>
          </div>
        </div>

        <div className="settings-section">
          <SectionHead descKey="settings.sectionDesc.notifications" icon={Bell} labelKey="settings.section.notifications" />
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
        </div>

        <div className="settings-section">
          <SectionHead descKey="settings.sectionDesc.appearance" icon={Palette} labelKey="settings.section.appearance" />
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
        </div>
      </div>
    </section>
  );
}
