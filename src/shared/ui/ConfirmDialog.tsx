import { useT } from "../../lib/i18n/LocalizationProvider";
import { Modal } from "./Modal";

export function ConfirmDialog({
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  title
}: { confirmLabel?: string; message: string; onCancel: () => void; onConfirm: () => void; title: string }) {
  const { t } = useT();
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onCancel}>{t("common.cancel")}</button>
        <button className="danger-button" onClick={onConfirm}>{confirmLabel ?? t("common.delete")}</button>
      </div>
    </Modal>
  );
}
