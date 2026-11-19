import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Modal } from "../../shared/ui/Modal";

/** The agent-facing contract this prompt points at. Lives next to the
 *  reference e2e/ suite so it can never drift from what actually runs. */
export const BOOTSTRAP_DOC_URL =
  "https://raw.githubusercontent.com/merajul-islam644/TestPilot-AI-prod/main/e2e/BOOTSTRAP.md";

// Same shape as the Blocks OS portal's bootstrap dialog: one copyable
// sentence the user pastes into a coding agent sitting in their own repo.
// The linked document carries both paths — scaffolding a fresh suite and
// consciously conforming an existing one — so a single prompt serves both.
export function BootstrapModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  const lead = t("suites.bootstrapPromptLead");
  const tail = t("suites.bootstrapPromptTail");
  const prompt = `${lead} ${BOOTSTRAP_DOC_URL} ${tail}`;

  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success(t("toast.bootstrapCopied"));
    } catch {
      toast.error(t("toast.bootstrapCopyFailed"));
    }
  }

  return (
    <Modal onClose={onClose} title={t("suites.bootstrapTitle")}>
      <div className="bootstrap-body">
        <p className="bootstrap-prompt">
          {lead}{" "}
          <a href={BOOTSTRAP_DOC_URL} target="_blank" rel="noreferrer">
            {BOOTSTRAP_DOC_URL}
          </a>{" "}
          {tail}
        </p>
        <p className="muted bootstrap-hint">{t("suites.bootstrapHint")}</p>
        <div className="bootstrap-actions">
          <a
            className="link-button"
            href={BOOTSTRAP_DOC_URL}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} /> {t("common.viewDoc")}
          </a>
          <button className="primary-button" onClick={() => void copyInstructions()} type="button">
            {copied ? t("suites.bootstrapCopiedLabel") : t("suites.bootstrapCopy")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
