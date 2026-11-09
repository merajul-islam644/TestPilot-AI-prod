import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Modal } from "../../shared/ui/Modal";
import { derivedSuiteForProject, projects } from "../../lib/demo/data";
import type { Environment } from "../../lib/demo/data";
import { runPlaywrightTests } from "../../lib/demo/store";
import { pingRunner, RUNNER_MAX_FILES } from "../../lib/runner/client";
import { localFolder } from "../../lib/workspace/localFolder";
import { DEFAULT_BASE_URL, readSavedRoot, readSavedSettings } from "../../features/workbench/data/useTestWorkspace";
import { useShell } from "../../app/layout/ShellContext";
import { getDefaultEnvironment } from "../../shared/useWorkspaceName";
import { useWorkspaceInfo } from "../../shared/workspaceRegistry";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { Select } from "../../shared/ui/select";

/** The runner refuses files over its per-file cap (mirrors useTestWorkspace.run). */
const RUNNER_FILE_CAP = 200_000;

const ENVIRONMENTS: Environment[] = ["production", "staging", "sandbox"];
const ENV_KEYS: Record<Environment, TranslationKey> = {
  production: "env.production",
  staging: "env.staging",
  sandbox: "env.sandbox"
};

export function NewRunModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const { openProjectTests } = useShell();
  const [projectId, setProjectId] = useState("");
  const [suiteId, setSuiteId] = useState("");
  const [environment, setEnvironment] = useState<Environment | "">(getDefaultEnvironment());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [starting, setStarting] = useState(false);
  // null = probe in flight; false = the local runner is down, which blocks
  // starting (there is no simulated fallback to fall back to anymore).
  const [runnerUp, setRunnerUp] = useState<boolean | null>(null);

  // Suites derive from the opened workspace (Rasta B): one "Playwright tests"
  // suite per project, or none — and then the escape hatch below applies.
  const workspaceInfo = useWorkspaceInfo(projectId);
  const derivedSuite = useMemo(
    () => (projectId ? derivedSuiteForProject(projectId) : null),
    [projectId, workspaceInfo]
  );
  // A project with no suite used to dead-end here: a disabled select, a
  // blocked submit, no exit. The workbench is where tests come from, so send
  // the user there instead.
  const noSuites = Boolean(projectId) && !derivedSuite;
  // The modal reads specs through the runner transport, so only runner-mode
  // workspaces can run from here. An FSA workspace's files sit behind a
  // browser permission handle only the Tests tab can touch — route runs
  // for those back to the workbench.
  const saved = projectId ? readSavedRoot(projectId) : null;
  const runnerWorkspace = saved?.mode === "runner";
  const fsaWorkspace = Boolean(projectId) && !noSuites && saved?.mode === "fsa";
  const valid = Boolean(projectId && suiteId && environment);
  const canStart = valid && Boolean(derivedSuite) && runnerWorkspace && runnerUp !== false && !starting;

  // The derived suite is the only choice — preselect it so starting a run
  // never needs a pointless click.
  useEffect(() => {
    if (projectId && derivedSuite && !suiteId) setSuiteId(derivedSuite.id);
  }, [derivedSuite, projectId, suiteId]);

  // One liveness probe per modal mount; the start path re-reads files anyway,
  // so a runner that dies between probe and submit surfaces there.
  useEffect(() => {
    let live = true;
    void pingRunner().then((up) => {
      if (live) setRunnerUp(up);
    });
    return () => {
      live = false;
    };
  }, []);

  async function handleSubmit() {
    if (!valid) {
      setAttempted(true);
      return;
    }
    if (!canStart) return;
    const root = saved?.root;
    const specPaths = workspaceInfo?.specPaths ?? [];
    if (!root || specPaths.length === 0) return;
    setStarting(true);
    try {
      const selected = specPaths.slice(0, RUNNER_MAX_FILES);
      const files: { name: string; content: string }[] = [];
      for (const path of selected) {
        const content = await localFolder.readUserFile({ root, path });
        if (content !== null) files.push({ name: path, content });
      }
      const oversized = files.filter((file) => file.content.length > RUNNER_FILE_CAP);
      const sendable = files.filter((file) => file.content.length <= RUNNER_FILE_CAP);
      if (sendable.length === 0) {
        toast.error(t("tests.noSpecs"));
        setStarting(false);
        return;
      }
      if (oversized.length > 0) {
        toast.info(`${oversized.length} file(s) over the runner's 200 KB cap were skipped`);
      }
      const baseURL = readSavedSettings(projectId)?.baseURL || DEFAULT_BASE_URL;
      // The run row appears in Test runs immediately (running); this modal's
      // job ends at dispatch — progress and the completion toast come from
      // the store, independent of this dialog.
      void runPlaywrightTests({
        projectId,
        name,
        environment: environment as Environment,
        baseURL,
        files: sendable
      }).catch(() => undefined);
      onClose();
    } catch (error) {
      // Spec reads failed — the runner most likely dropped offline between
      // the probe and this submit.
      toast.error(t("toast.runnerFailed"), {
        description: error instanceof Error ? error.message.slice(0, 200) : undefined
      });
      setStarting(false);
    }
  }

  return (
    <Modal onClose={onClose} title={t("newRun.title")}>
      <p className="modal-sub">{t("newRun.desc")}</p>
      <div className="form-grid">
        <label className="form-field">
          <span>{t("newRun.project")} <span className="req">*</span></span>
          <Select
            className="w-full"
            items={[
              { value: "", label: t("newRun.selectProject") },
              ...projects.map((project) => ({ value: project.id, label: project.name }))
            ]}
            onChange={(value) => {
              setProjectId(value);
              setSuiteId("");
            }}
            value={projectId}
          />
        </label>
        <label className="form-field">
          <span>{t("newRun.suite")} <span className="req">*</span></span>
          {noSuites ? (
            <div style={{ border: "1px dashed hsl(var(--border))", borderRadius: 8, display: "grid", gap: 10, padding: "12px 14px" }}>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{t("newRun.noSuitesHint")}</p>
              <button
                className="secondary-button"
                onClick={() => {
                  openProjectTests(projectId);
                  onClose();
                }}
              >
                {t("newRun.openWorkbench")}
              </button>
            </div>
          ) : (
            <Select
              className="w-full"
              disabled={!projectId}
              items={[
                { value: "", label: t("newRun.selectSuite") },
                ...(derivedSuite ? [{ value: derivedSuite.id, label: `${derivedSuite.name} (${derivedSuite.description})` }] : [])
              ]}
              onChange={setSuiteId}
              value={suiteId}
            />
          )}
        </label>
        <label className="form-field">
          <span>{t("newRun.env")} <span className="req">*</span></span>
          <Select
            className="w-full"
            items={[
              { value: "", label: t("newRun.selectEnv") },
              ...ENVIRONMENTS.map((env) => ({ value: env, label: t(ENV_KEYS[env]) }))
            ]}
            onChange={(value) => setEnvironment(value as Environment)}
            value={environment}
          />
        </label>
        <label className="form-field">
          <span>{t("newRun.name")} <span className="field-hint">({t("common.optional")})</span></span>
          <input onChange={(event) => setName(event.target.value)} placeholder={t("newRun.namePlaceholder")} value={name} />
        </label>
        <label className="form-field" style={{ gridColumn: "1 / -1" }}>
          <span>{t("newRun.description")} <span className="field-hint">({t("common.optional")})</span></span>
          <textarea onChange={(event) => setDescription(event.target.value)} placeholder={t("newRun.descriptionPlaceholder")} value={description} />
        </label>
        {fsaWorkspace ? (
          <div style={{ gridColumn: "1 / -1", border: "1px dashed hsl(var(--border))", borderRadius: 8, display: "grid", gap: 10, padding: "12px 14px" }}>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{t("newRun.fsaHint")}</p>
            <button
              className="secondary-button"
              onClick={() => {
                openProjectTests(projectId);
                onClose();
              }}
            >
              {t("newRun.openWorkbench")}
            </button>
          </div>
        ) : null}
        {runnerUp === false && !noSuites && !fsaWorkspace ? (
          <p style={{ gridColumn: "1 / -1", margin: 0, color: "hsl(var(--destructive))", fontSize: 13 }}>{t("newRun.runnerOffHint")}</p>
        ) : null}
        {attempted && !valid ? (
          <p className="field-error" style={{ gridColumn: "1 / -1", margin: 0, color: "hsl(var(--destructive))", fontSize: 13 }}>{t("newRun.validation")}</p>
        ) : null}
        <div className="form-actions">
          <button className="secondary-button" disabled={starting} onClick={onClose}>{t("common.cancel")}</button>
          <button className="primary-button" disabled={!canStart} onClick={() => void handleSubmit()}>
            {starting ? t("newRun.starting") : t("newRun.start")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
