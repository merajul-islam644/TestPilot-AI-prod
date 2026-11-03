import { useShell } from "../../app/layout/ShellContext";
import { useRoute } from "../../app/router/routes";
import type { RunStatus } from "../../lib/demo/data";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { PageHeader } from "../../shared/ui/PageHeader";
import { RunStatusBadge } from "../../shared/ui/StatusBadge";

const STATUS_ROWS: { descKey: TranslationKey; status: RunStatus }[] = [
  { status: "passed", descKey: "help.statuses.runPassed" },
  { status: "failed", descKey: "help.statuses.runFailed" },
  { status: "running", descKey: "help.statuses.runRunning" },
  { status: "pending", descKey: "help.statuses.runPending" },
  { status: "cancelled", descKey: "help.statuses.runCancelled" }
];

const SHORTCUTS: { descKey: TranslationKey; keys: string }[] = [
  { keys: "Ctrl K", descKey: "help.shortcut.palette" },
  { keys: "↑ ↓", descKey: "help.shortcut.navigate" },
  { keys: "↵", descKey: "help.shortcut.select" },
  { keys: "Esc", descKey: "help.shortcut.close" }
];

const FAQ: { a: TranslationKey; q: TranslationKey }[] = [
  { q: "help.faq.q1", a: "help.faq.a1" },
  { q: "help.faq.q2", a: "help.faq.a2" },
  { q: "help.faq.q3", a: "help.faq.a3" },
  { q: "help.faq.q4", a: "help.faq.a4" }
];

const RUN_STATUS_KEYS: Record<RunStatus, TranslationKey> = {
  passed: "status.passed",
  failed: "status.failed",
  running: "status.running",
  pending: "status.pending",
  cancelled: "status.cancelled"
};

export function HelpPage() {
  const { t } = useT();
  const { navigate } = useRoute();
  const { openNewRun } = useShell();
  const modifier = /mac|iphone|ipad/i.test(navigator.platform) ? "⌘" : "Ctrl";

  return (
    <section>
      <PageHeader subtitle={t("help.subtitle")} title={t("help.title")} />

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">{t("help.start.title")}</h3>
          </div>
          <ol className="help-steps">
            <li>
              <span className="step-num" aria-hidden="true">1</span>
              <div>
                <h4>{t("help.start.one.title")}</h4>
                <p>{t("help.start.one.desc")}</p>
                <button className="tertiary-button" onClick={() => navigate("/projects")}>{t("nav.projects")}</button>
              </div>
            </li>
            <li>
              <span className="step-num" aria-hidden="true">2</span>
              <div>
                <h4>{t("help.start.two.title")}</h4>
                <p>{t("help.start.two.desc")}</p>
                <button className="tertiary-button" onClick={() => navigate("/suites")}>{t("nav.suites")}</button>
              </div>
            </li>
            <li>
              <span className="step-num" aria-hidden="true">3</span>
              <div>
                <h4>{t("help.start.three.title")}</h4>
                <p>{t("help.start.three.desc")}</p>
                <button className="tertiary-button" onClick={openNewRun}>{t("command.startRun")}</button>
              </div>
            </li>
          </ol>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">{t("help.statuses.title")}</h3>
          </div>
          <div className="help-status-list">
            {STATUS_ROWS.map((row) => (
              <div className="help-status-row" key={row.status}>
                <RunStatusBadge label={t(RUN_STATUS_KEYS[row.status])} status={row.status} />
                <span className="muted">{t(row.descKey)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">{t("help.shortcuts.title")}</h3>
          </div>
          <table>
            <tbody>
              {SHORTCUTS.map((shortcut) => (
                <tr key={shortcut.descKey}>
                  <td><kbd>{shortcut.keys.replace("Ctrl", modifier)}</kbd></td>
                  <td>{t(shortcut.descKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">{t("help.faq.title")}</h3>
          </div>
          {FAQ.map((entry) => (
            <details className="raw-details" key={entry.q}>
              <summary>{t(entry.q)}</summary>
              <p>{t(entry.a)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
