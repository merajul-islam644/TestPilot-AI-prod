import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Alert } from "../../shared/ui/Alert";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { RequirePermission } from "../../shared/ui/RequirePermission";
import { Switch } from "../../shared/ui/Switch";
import { saveMfaConfig } from "../../lib/blocks/mfa";
import { useRoles } from "../users/useUsers";
import { mfaTypeFromName, useTenantMfaConfig, type TenantMfaPolicy } from "./useMfa";

// Tenant-wide MFA policy. Reading it needs `blocks-iam::iam::mfa-configs`,
// saving needs `blocks-iam::iam::mutate-mfa-configs` — the panel hides for
// users without the read, and the save button degrades to a note without the
// write. The save request takes the WRITE shape (`enableMfa`, `userMfaType`
// integers) while the read returns method NAMES — mfaTypeFromName maps
// between them. IAM MERGES the save into the stored policy, but we send the
// full body anyway so the confirm dialog is an honest summary of the result.

const READ_PERMISSION = "blocks-iam::iam::mfa-configs";
const WRITE_PERMISSION = "blocks-iam::iam::mutate-mfa-configs";

function sameSet(a: string[], b: string[]): boolean {
  return [...a].sort().join(",") === [...b].sort().join(",");
}

function toggle(list: string[], slug: string): string[] {
  return list.includes(slug) ? list.filter((entry) => entry !== slug) : [...list, slug];
}

function methodsOf(names: string[]): number[] {
  return [...new Set(names.map((name) => mfaTypeFromName(name)).filter((n): n is number => n !== undefined))].sort();
}

function PolicyForm({ policy }: { policy: TenantMfaPolicy }) {
  const { t } = useT();
  const roles = useRoles();

  const [enabled, setEnabled] = useState(policy.enabled);
  const [requireForAll, setRequireForAll] = useState(policy.requireForAll);
  const [allowOptOut, setAllowOptOut] = useState(policy.allowOptOut);
  const [allowBackupCodes, setAllowBackupCodes] = useState(policy.allowBackupCodes);
  const [backupCodesCount, setBackupCodesCount] = useState(String(policy.backupCodesCount || 10));
  const [methods, setMethods] = useState<number[]>(() => methodsOf(policy.allowedMethodNames));
  const [requiredRoles, setRequiredRoles] = useState<string[]>(policy.requiredRoles);
  const [exemptRoles, setExemptRoles] = useState<string[]>(policy.exemptRoles);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const changes = useMemo(() => {
    const lines: string[] = [];
    const onOff = (on: boolean) => (on ? t("common.on") : t("common.off"));
    if (enabled !== policy.enabled) lines.push(`${t("mfa.policy.enableMfa")}: ${onOff(enabled)}`);
    if (requireForAll !== policy.requireForAll) lines.push(`${t("mfa.policy.requireAll")}: ${onOff(requireForAll)}`);
    if (methods.join(",") !== methodsOf(policy.allowedMethodNames).join(",")) {
      const labels = methods.map((n) => (n === 1 ? t("mfa.methodTotp") : n === 2 ? t("mfa.methodEmail") : String(n)));
      lines.push(`${t("mfa.policy.allowedMethods")}: ${labels.length > 0 ? labels.join(", ") : t("common.none")}`);
    }
    if (!sameSet(requiredRoles, policy.requiredRoles)) {
      lines.push(`${t("mfa.policy.requiredRoles")}: ${requiredRoles.length > 0 ? requiredRoles.join(", ") : t("common.none")}`);
    }
    if (!sameSet(exemptRoles, policy.exemptRoles)) {
      lines.push(`${t("mfa.policy.exemptRoles")}: ${exemptRoles.length > 0 ? exemptRoles.join(", ") : t("common.none")}`);
    }
    if (allowOptOut !== policy.allowOptOut) lines.push(`${t("mfa.policy.allowOptOut")}: ${onOff(allowOptOut)}`);
    if (allowBackupCodes !== policy.allowBackupCodes) lines.push(`${t("mfa.policy.allowBackup")}: ${onOff(allowBackupCodes)}`);
    if (allowBackupCodes && Number(backupCodesCount) !== policy.backupCodesCount) {
      lines.push(`${t("mfa.policy.backupCount")}: ${backupCodesCount}`);
    }
    return lines;
  }, [allowBackupCodes, allowOptOut, backupCodesCount, enabled, exemptRoles, methods, policy, requireForAll, requiredRoles, t]);

  const changed = changes.length > 0;
  const noMethodsWarning = enabled && methods.length === 0;

  async function save() {
    if (pending) return;
    setPending(true);
    try {
      await saveMfaConfig({
        allowBackupCodes,
        allowUserOptOut: allowOptOut,
        backupCodesCount: Number(backupCodesCount) || 0,
        enableMfa: enabled,
        mfaExemptRoles: exemptRoles,
        mfaRequiredRoles: requiredRoles,
        requireMfaForAllUsers: requireForAll,
        userMfaType: methods
      });
      toast(t("mfa.policy.saved"));
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setPending(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="policy-editor">
      <div className="settings-row">
        <div>
          <strong>{t("mfa.policy.enableMfa")}</strong>
          <p>{t("mfa.policy.enableHint")}</p>
        </div>
        <Switch checked={enabled} label={t("mfa.policy.enableMfa")} onChange={setEnabled} />
      </div>

      <div className="settings-row">
        <div>
          <strong>{t("mfa.policy.requireAll")}</strong>
          <p>{t("mfa.policy.requireAllHint")}</p>
        </div>
        <Switch checked={requireForAll} label={t("mfa.policy.requireAll")} onChange={setRequireForAll} />
      </div>

      <div className="settings-section">
        <h4>{t("mfa.policy.allowedMethods")}</h4>
        <p>{t("mfa.policy.methodsHint")}</p>
        <div className="policy-methods">
          <label className="policy-check">
            <input
              checked={methods.includes(1)}
              onChange={() => setMethods((list) => (list.includes(1) ? list.filter((n) => n !== 1) : [...list, 1].sort()))}
              type="checkbox"
            />
            {t("mfa.methodTotp")}
          </label>
          <label className="policy-check">
            <input
              checked={methods.includes(2)}
              onChange={() => setMethods((list) => (list.includes(2) ? list.filter((n) => n !== 2) : [...list, 2].sort()))}
              type="checkbox"
            />
            {t("mfa.methodEmail")}
          </label>
        </div>
        <p className="field-hint">{t("mfa.policy.smsUnavailable")}</p>
        {noMethodsWarning ? <Alert tone="warn">{t("mfa.policy.noMethodsWarning")}</Alert> : null}
      </div>

      <div className="settings-section">
        <h4>{t("mfa.policy.requiredRoles")}</h4>
        <p>{t("mfa.policy.rolesHint")}</p>
        <RoleChips onToggle={(slug) => setRequiredRoles((list) => toggle(list, slug))} roles={roles.roles} selected={requiredRoles} />
        <h4 style={{ marginTop: 14 }}>{t("mfa.policy.exemptRoles")}</h4>
        <p>{t("mfa.policy.exemptHint")}</p>
        <RoleChips onToggle={(slug) => setExemptRoles((list) => toggle(list, slug))} roles={roles.roles} selected={exemptRoles} />
      </div>

      <div className="settings-row">
        <div>
          <strong>{t("mfa.policy.allowOptOut")}</strong>
          <p>{t("mfa.policy.optOutHint")}</p>
        </div>
        <Switch checked={allowOptOut} label={t("mfa.policy.allowOptOut")} onChange={setAllowOptOut} />
      </div>

      <div className="settings-row">
        <div>
          <strong>{t("mfa.policy.allowBackup")}</strong>
          <p>{t("mfa.policy.backupHint")}</p>
        </div>
        <Switch checked={allowBackupCodes} label={t("mfa.policy.allowBackup")} onChange={setAllowBackupCodes} />
      </div>

      {allowBackupCodes ? (
        <div className="form-field" style={{ maxWidth: 160 }}>
          <label htmlFor="backup-count">{t("mfa.policy.backupCount")}</label>
          <input
            id="backup-count"
            inputMode="numeric"
            max={20}
            min={1}
            onChange={(event) => setBackupCodesCount(event.target.value.replace(/\D/g, ""))}
            value={backupCodesCount}
          />
        </div>
      ) : null}

      <RequirePermission fallback={<p className="field-hint">{t("mfa.policy.readOnly")}</p>} permission={WRITE_PERMISSION}>
        <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
          <button className="primary-button" disabled={!changed || pending} onClick={() => setConfirmOpen(true)} type="button">
            {t("common.save")}
          </button>
          {changed ? <span className="muted">{t("mfa.policy.changedCount").replace("{count}", String(changes.length))}</span> : null}
        </div>
      </RequirePermission>

      {confirmOpen ? (
        <ConfirmDialog
          confirmLabel={t("common.save")}
          message={changes.join(" • ")}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void save()}
          title={t("mfa.policy.confirmTitle")}
        />
      ) : null}
    </div>
  );
}

function RoleChips({ onToggle, roles, selected }: { onToggle: (slug: string) => void; roles: { name: string; slug: string }[]; selected: string[] }) {
  const { t } = useT();
  if (roles.length === 0) return <p className="field-hint">{t("mfa.policy.noRoles")}</p>;
  return (
    <div className="chips">
      {roles.map((role) => {
        const on = selected.includes(role.slug);
        return (
          <button
            className={`chip chip-toggle ${on ? "chip-on" : ""}`}
            key={role.slug}
            onClick={() => onToggle(role.slug)}
            title={role.slug}
            type="button"
          >
            {role.name || role.slug}
          </button>
        );
      })}
    </div>
  );
}

export function MfaPolicyAdmin() {
  const { t } = useT();
  const policy = useTenantMfaConfig();

  return (
    <div className="panel mfa-policy-panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{t("mfa.policy.title")}</h3>
          <p className="panel-desc">{t("mfa.policy.subtitle")}</p>
        </div>
      </div>
      <RequirePermission fallback={<p className="muted">{t("mfa.policy.unavailable")}</p>} permission={READ_PERMISSION}>
        {policy.isLoading ? (
          <p className="muted">{t("common.loading")}</p>
        ) : policy.isError || !policy.policy ? (
          <p className="muted">{t("mfa.policy.unavailable")}</p>
        ) : (
          <PolicyForm key={policy.dataUpdatedAt} policy={policy.policy} />
        )}
      </RequirePermission>
    </div>
  );
}
