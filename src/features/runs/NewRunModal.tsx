import { useMemo, useState } from "react";
import { Modal } from "../../shared/ui/Modal";
import { projects, suitesForProject } from "../../lib/demo/data";
import type { Environment } from "../../lib/demo/data";
import { startRun } from "../../lib/demo/store";
import { getDefaultEnvironment } from "../../shared/useWorkspaceName";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";

const ENVIRONMENTS: Environment[] = ["production", "staging", "sandbox"];
const ENV_KEYS: Record<Environment, TranslationKey> = {
  production: "env.production",
  staging: "env.staging",
  sandbox: "env.sandbox"
};

export function NewRunModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [projectId, setProjectId] = useState("");
  const [suiteId, setSuiteId] = useState("");
  const [environment, setEnvironment] = useState<Environment | "">(getDefaultEnvironment());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [starting, setStarting] = useState(false);

  const availableSuites = useMemo(() => (projectId ? suitesForProject(projectId) : []), [projectId]);
  const valid = Boolean(projectId && suiteId && environment);

  function handleSubmit() {
    if (!valid) {
      setAttempted(true);
      return;
    }
    setStarting(true);
    // Brief handshake state so the button reads as having done something,
    // then the pending run appears at the top of Test runs immediately.
    window.setTimeout(() => {
      startRun({ projectId, suiteId, environment: environment as Environment, name, description });
      onClose();
    }, 450);
  }

  return (
    <Modal onClose={onClose} title={t("newRun.title")}>
      <p className="modal-sub">{t("newRun.desc")}</p>
      <div className="form-grid">
        <label className="form-field">
          <span>{t("newRun.project")} <span className="req">*</span></span>
          <select
            onChange={(event) => {
              setProjectId(event.target.value);
              setSuiteId("");
            }}
            value={projectId}
          >
            <option value="">{t("newRun.selectProject")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{t("newRun.suite")} <span className="req">*</span></span>
          <select disabled={!projectId} onChange={(event) => setSuiteId(event.target.value)} value={suiteId}>
            <option value="">{projectId && availableSuites.length === 0 ? t("newRun.noSuites") : t("newRun.selectSuite")}</option>
            {availableSuites.map((suite) => (
              <option key={suite.id} value={suite.id}>{suite.name}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{t("newRun.env")} <span className="req">*</span></span>
          <select onChange={(event) => setEnvironment(event.target.value as Environment)} value={environment}>
            <option value="">{t("newRun.selectEnv")}</option>
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>{t(ENV_KEYS[env])}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{t("newRun.name")} <span className="field-hint">({t("common.optional")})</span></span>
          <input onChange={(event) => setName(event.target.value)} placeholder={t("newRun.namePlaceholder")} value={name} />
        </label>
        <label className="form-field" style={{ gridColumn: "1 / -1" }}>
          <span>{t("newRun.description")} <span className="field-hint">({t("common.optional")})</span></span>
          <textarea onChange={(event) => setDescription(event.target.value)} placeholder={t("newRun.descriptionPlaceholder")} value={description} />
        </label>
        {attempted && !valid ? (
          <p className="field-error" style={{ gridColumn: "1 / -1", margin: 0, color: "hsl(var(--destructive))", fontSize: 13 }}>{t("newRun.validation")}</p>
        ) : null}
        <div className="form-actions">
          <button className="secondary-button" disabled={starting} onClick={onClose}>{t("common.cancel")}</button>
          <button className="primary-button" disabled={starting} onClick={handleSubmit}>
            {starting ? t("newRun.starting") : t("newRun.start")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
