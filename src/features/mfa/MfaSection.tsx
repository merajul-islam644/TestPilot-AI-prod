import QRCode from "qrcode";
import { Copy, Download, KeyRound, Mail, RefreshCw, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { Alert } from "../../shared/ui/Alert";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Modal } from "../../shared/ui/Modal";
import {
  MFA_TYPE,
  buildOtpauthUri,
  disableMfa,
  generateBackupCodes,
  parseTotpSetup,
  setMfaMethod,
  totpSetup,
  totpVerifySetup
} from "../../lib/blocks/mfa";
import { backupCodesRemaining, useBackupCodesRemaining, useMyMfaStatus, useTenantMfaConfig } from "./useMfa";

function methodLabel(method: number, t: (key: TranslationKey) => string): string {
  if (method === MFA_TYPE.TOTP) return t("mfa.methodTotp");
  if (method === MFA_TYPE.EMAIL) return t("mfa.methodEmail");
  if (method === MFA_TYPE.SMS) return t("mfa.methodSms");
  if (method === MFA_TYPE.WHATSAPP) return t("mfa.methodWhatsapp");
  return t("mfa.methodNone");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// --- One-time backup-code display --------------------------------------------
// These codes exist in state for as long as this modal is open, then they are
// gone — IAM never returns them again, so nothing here persists them.

function FreshCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const { t } = useT();

  function download() {
    const blob = new Blob([codes.join("\r\n")], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "testpilot-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <Modal onClose={onClose} title={t("mfa.backup.generatedTitle")}>
      <Alert tone="warn">{t("mfa.backup.onceWarning")}</Alert>
      <div className="backup-codes-grid">
        {codes.map((code) => <code key={code}>{code}</code>)}
      </div>
      <p className="field-hint">{t("mfa.backup.singleUseHint")}</p>
      <div className="modal-actions">
        <button className="secondary-button" onClick={() => { void copyText(codes.join("\n")); toast(t("mfa.backup.copied")); }} type="button">
          <Copy size={15} /> {t("mfa.backup.copyAll")}
        </button>
        <button className="secondary-button" onClick={download} type="button">
          <Download size={15} /> {t("mfa.backup.download")}
        </button>
        <button className="primary-button" onClick={onClose} type="button">{t("mfa.backup.savedDone")}</button>
      </div>
    </Modal>
  );
}

// --- TOTP enrollment wizard ----------------------------------------------------

function TotpWizard({ onClose }: { onClose: (enrolled: boolean) => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<ReturnType<typeof parseTotpSetup> | undefined>();
  const [qrSrc, setQrSrc] = useState<string | undefined>();
  const [setupError, setSetupError] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  // totp.setup() is an authentication protocol step — fire it exactly once
  // per wizard open, never speculatively.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const payload = parseTotpSetup(await totpSetup());
        setSetup(payload);
        const uri = payload.otpauthUri ?? (payload.secret ? buildOtpauthUri(payload.secret, "") : undefined);
        if (payload.qrImageSrc) setQrSrc(payload.qrImageSrc);
        else if (uri) setQrSrc(await QRCode.toDataURL(uri, { margin: 1, width: 200 }));
      } catch (caught) {
        setSetupError((caught as Error).message);
      }
    })();
  }, []);

  async function confirm() {
    if (!setup || pending) return;
    setPending(true);
    try {
      await totpVerifySetup(code.trim());
      toast(t("mfa.totp.activated"));
      // verify-setup activates TOTP server-side; pull fresh me() + backup state.
      await queryClient.invalidateQueries({ queryKey: ["iam", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["iam", "mfa", "backup-codes"] });
      onClose(true);
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={() => onClose(false)} title={t("mfa.totp.title")}>
      {setupError ? (
        <Alert tone="error">{setupError}</Alert>
      ) : !setup ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <>
          <p>{t("mfa.totp.scanHint")}</p>
          <div className="qr-box">
            {qrSrc ? <img alt={t("mfa.totp.qrAlt")} src={qrSrc} /> : <span className="muted">{t("mfa.totp.qrMissing")}</span>}
          </div>
          {setup.secret ? (
            <div className="manual-secret">
              <span className="field-hint">{t("mfa.totp.manualSecret")}</span>
              <div className="manual-secret-row">
                <code>{setup.secret}</code>
                <button
                  aria-label={t("common.copy")}
                  className="icon-button"
                  onClick={() => { void copyText(setup.secret as string); toast(t("mfa.backup.copied")); }}
                  type="button"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          ) : null}
          <div className="form-field">
            <label htmlFor="totp-code">{t("mfa.totp.codeLabel")}</label>
            <input
              autoComplete="one-time-code"
              id="totp-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              value={code}
            />
          </div>
        </>
      )}
      <div className="modal-actions">
        <button className="secondary-button" onClick={() => onClose(false)} type="button">{t("common.cancel")}</button>
        <button className="primary-button" disabled={!setup || code.trim().length !== 6 || pending} onClick={() => void confirm()} type="button">
          {pending ? t("common.loading") : t("mfa.totp.verify")}
        </button>
      </div>
    </Modal>
  );
}

// --- Self-service MFA section ---------------------------------------------------

export function MfaSection() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const status = useMyMfaStatus();
  const policy = useTenantMfaConfig();
  const backup = useBackupCodesRemaining();

  const [totpOpen, setTotpOpen] = useState(false);
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [backupConfirmOpen, setBackupConfirmOpen] = useState(false);
  const [freshCodes, setFreshCodes] = useState<string[] | undefined>();
  const [pending, setPending] = useState(false);

  const remaining = backupCodesRemaining(backup);
  // When the policy can't be read (no mfa-configs permission) these default
  // to "offer it" — IAM enforces the real rules server-side and its error
  // surfaces in the toast, so the UI never blocks on a read it can't have.
  const emailAllowed = !policy.policy || policy.policy.allowedMethodNames.some((name) => /email/i.test(name));
  const totpAllowed = !policy.policy || policy.policy.allowedMethodNames.some((name) => /totp/i.test(name));
  const optOutBlocked = policy.policy ? !policy.policy.allowOptOut : false;
  const backupBlocked = useMemo(() => {
    const message = (backup.error as Error | null)?.message ?? "";
    return /backup_codes_disabled/i.test(message);
  }, [backup.error]);

  function refreshAll() {
    void queryClient.invalidateQueries({ queryKey: ["iam", "me"] });
    void queryClient.invalidateQueries({ queryKey: ["iam", "mfa", "backup-codes"] });
  }

  async function activateEmail() {
    if (pending) return;
    setPending(true);
    try {
      await setMfaMethod(MFA_TYPE.EMAIL);
      toast(t("mfa.email.activated"));
      refreshAll();
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setPending(false);
      setEmailConfirmOpen(false);
    }
  }

  async function confirmDisable() {
    if (pending) return;
    setPending(true);
    try {
      await disableMfa();
      toast(t("mfa.disabled"));
      refreshAll();
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setPending(false);
      setDisabling(false);
    }
  }

  async function confirmGenerateCodes() {
    if (pending) return;
    setPending(true);
    try {
      const payload = await generateBackupCodes();
      // IAM returns the codes under a loosely named key — take the first
      // value that is a non-empty string array.
      const list = Object.values(payload).find((value) =>
        Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string")
      ) as string[] | undefined;
      if (!list || list.length === 0) throw new Error(t("mfa.backup.emptyResponse"));
      setFreshCodes(list);
      refreshAll();
    } catch (caught) {
      toast.error((caught as Error).message);
    } finally {
      setPending(false);
      setBackupConfirmOpen(false);
    }
  }

  return (
    <>
      <div className="settings-section">
        <h4><ShieldCheck size={16} /> {t("mfa.selfTitle")}</h4>
        <p>{t("mfa.selfHint")}</p>
        {!status.ready ? (
          <p className="muted">{t("common.loading")}</p>
        ) : (
          <>
            <div className="mfa-status-row">
              <span className={`chip ${status.enabled ? "chip-good" : ""}`}>
                {status.enabled ? t("mfa.statusOn") : t("mfa.statusOff")}
              </span>
              <span className="muted">{methodLabel(status.method, t)}</span>
              <button aria-label={t("common.refresh")} className="icon-button" onClick={refreshAll} type="button">
                <RefreshCw size={15} />
              </button>
            </div>

            <div className="mfa-actions">
              {!status.enabled && totpAllowed ? (
                <button className="primary-button" onClick={() => setTotpOpen(true)} type="button">
                  <Smartphone size={16} /> {t("mfa.enrollTotp")}
                </button>
              ) : null}
              {!status.enabled && emailAllowed ? (
                <button className="secondary-button" onClick={() => setEmailConfirmOpen(true)} type="button">
                  <Mail size={16} /> {t("mfa.enrollEmail")}
                </button>
              ) : null}
              {status.enabled && status.method === MFA_TYPE.TOTP && emailAllowed ? (
                <button className="secondary-button" onClick={() => setEmailConfirmOpen(true)} type="button">
                  <Mail size={16} /> {t("mfa.switchToEmail")}
                </button>
              ) : null}
              {status.enabled && status.method === MFA_TYPE.EMAIL && totpAllowed ? (
                <button className="secondary-button" onClick={() => setTotpOpen(true)} type="button">
                  <Smartphone size={16} /> {t("mfa.switchToTotp")}
                </button>
              ) : null}
              {status.enabled && !optOutBlocked ? (
                <button className="danger-button" onClick={() => setDisabling(true)} type="button">
                  <ShieldOff size={16} /> {t("mfa.disable")}
                </button>
              ) : null}
            </div>
            {status.enabled && optOutBlocked ? <p className="field-hint">{t("mfa.optOutBlocked")}</p> : null}
            {!status.enabled && !totpAllowed && !emailAllowed ? (
              <p className="field-hint">{t("mfa.noMethodsOffered")}</p>
            ) : null}
          </>
        )}
      </div>

      {status.enabled ? (
        <div className="settings-section">
          <h4><KeyRound size={16} /> {t("mfa.backup.title")}</h4>
          <p>{t("mfa.backup.hint")}</p>
          {backup.isError && !backupBlocked ? <Alert tone="info">{t("mfa.backup.countUnavailable")}</Alert> : null}
          {backupBlocked ? <Alert tone="info">{t("mfa.backup.disabledByPolicy")}</Alert> : null}
          <div className="mfa-actions">
            {remaining !== undefined ? (
              <span className="muted">{t("mfa.backup.remaining").replace("{count}", String(remaining))}</span>
            ) : null}
            {!backupBlocked ? (
              <button className="secondary-button" onClick={() => setBackupConfirmOpen(true)} type="button">
                <KeyRound size={16} /> {t("mfa.backup.generate")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {totpOpen ? <TotpWizard onClose={(enrolled) => { setTotpOpen(false); if (enrolled) refreshAll(); }} /> : null}

      {emailConfirmOpen ? (
        <ConfirmDialog
          confirmLabel={t("mfa.email.confirmLabel")}
          message={status.enabled ? t("mfa.email.switchMessage") : t("mfa.email.enrollMessage")}
          onCancel={() => setEmailConfirmOpen(false)}
          onConfirm={() => void activateEmail()}
          title={t("mfa.email.title")}
        />
      ) : null}

      {disabling ? (
        <ConfirmDialog
          confirmLabel={t("mfa.disable")}
          message={t("mfa.disableMessage")}
          onCancel={() => setDisabling(false)}
          onConfirm={() => void confirmDisable()}
          title={t("mfa.disableTitle")}
        />
      ) : null}

      {backupConfirmOpen ? (
        <ConfirmDialog
          confirmLabel={t("mfa.backup.generate")}
          message={t("mfa.backup.confirmMessage")}
          onCancel={() => setBackupConfirmOpen(false)}
          onConfirm={() => void confirmGenerateCodes()}
          title={t("mfa.backup.confirmTitle")}
        />
      ) : null}

      {freshCodes ? <FreshCodesModal codes={freshCodes} onClose={() => setFreshCodes(undefined)} /> : null}
    </>
  );
}
