// Bottom panel, VS Code style: a left tab strip (Output / Test
// Results), right-side actions (clear output, maximize, close), a
// chronological runner log with auto-scroll, and per-case results
// under a pass/fail summary strip.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eraser, Power, TerminalSquare, X } from "lucide-react";
import { toast } from "sonner";
import { useT } from "../../../lib/i18n/LocalizationProvider";
import { useRoute } from "../../../app/router/routes";
import type { PlaywrightRunOutcome } from "../../../lib/demo/store";
import { DataTable } from "../../../shared/ui/DataTable";
import { Select } from "../../../shared/ui/select";
import { StatusBadge } from "../../../shared/ui/StatusBadge";
import { formatMs } from "../../../lib/format";
import type { PanelTab } from "../state/workbenchStore";
import { readStoredShell, writeStoredShell, TerminalView } from "./TerminalView";
import { fetchRunnerPairCode } from "../../../lib/runner/client";

type ShellDescriptor = { id: string; label: string; available: boolean; resolvedPath: string | null };

export function BottomPanel({ tab, projectId, root, outputLines, onClearOutput, onOpenFolder, opening, maximized, onToggleMaximize, outcome, runnerOnline, runnerUrl, onTabChange, onClose }: {
  tab: PanelTab;
  /** Terminals are scoped per project — each project gets its own shell. */
  projectId: string;
  /** The open workspace's root — its real disk path when the folder
   *  came through the agent (runner), or just its name for a browser
   *  picker (FSA) workspace. The terminal watches it: a folder change
   *  restarts the shell in the new root, Lattice-style. */
  root: string | null;
  /** Opens the folder dialog (hook openFolder) — the terminal's
   *  no-folder gate button and, well, the Explorer's too. */
  onOpenFolder: () => void;
  /** True while a folder open is in flight. */
  opening: boolean;
  /** Chronological runner log lines ([HH:MM:SS] prefixed). */
  outputLines: string[];
  onClearOutput: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  outcome: PlaywrightRunOutcome | undefined;
  runnerOnline: boolean | undefined;
  runnerUrl: string;
  onTabChange: (tab: PanelTab) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const { navigate } = useRoute();
  const logRef = useRef<HTMLDivElement>(null);
  // Shell picker (panel header, next to the runner badge): the catalog
  // comes from the runner so the dropdown is honest about what's
  // installed here; the user's pick persists in localStorage.
  const [shells, setShells] = useState<ShellDescriptor[]>([]);
  const [shell, setShell] = useState<string>(() => readStoredShell() ?? "");
  // "Stop server" (terminal tab, next to the badge): the counterpart of
  // the ConnectCard's "Start server" — both live where the user already
  // manages the terminal. Two-step arm so a stray click can't kill a
  // terminal running `npm run dev`: first click arms, second (within
  // 3s) fires the agent's pairing-gated shutdown endpoint; the
  // liveness probe flips the UI back to offline once it's gone.
  const [armStop, setArmStop] = useState(false);
  const armTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
  }, []);
  async function stopServer() {
    if (!armStop) {
      setArmStop(true);
      armTimerRef.current = window.setTimeout(() => setArmStop(false), 3000);
      return;
    }
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    setArmStop(false);
    const code = await fetchRunnerPairCode();
    if (!code) {
      toast.error("Could not reach the server to stop it", { description: "It may already be off — the status flips within a few seconds." });
      return;
    }
    try {
      const response = await fetch(`${runnerUrl}/api/shutdown`, {
        body: JSON.stringify({ code }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      toast.success("Server stopped");
    } catch {
      toast.error("Could not stop the server", { description: "It may already be off — the status flips within a few seconds." });
    }
  }

  useEffect(() => {
    let cancelled = false;
    // The agent often comes online AFTER this panel mounted (the
    // ConnectCard flow). runnerOnline sits in the deps so the flip
    // re-runs the fetch — otherwise a catalog fetch that failed at
    // mount would leave the picker on "Loading…" forever.
    if (runnerOnline === false) return;
    void fetch(`${runnerUrl}/api/terminal/shells`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { shells?: ShellDescriptor[] } | null) => {
        if (cancelled || !body?.shells) return;
        const list = body.shells;
        setShells(list);
        // Keep the persisted pick when it still exists; otherwise fall
        // back to the first installed shell (CMD here).
        setShell((current) => {
          if (current && list.some((s) => s.id === current && s.available)) return current;
          const first = list.find((s) => s.available);
          return first?.id ?? "";
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runnerUrl, runnerOnline]);

  function onShellChange(id: string) {
    setShell(id);
    writeStoredShell(id);
  }

  // Keep the newest log line in view, like a terminal.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [outputLines]);

  const hasOutcome = outcome !== undefined;

  return (
    <section aria-label="Panel" className={`wb-panel${maximized ? " maximized" : ""}`}>
      <div className="wb-panel-head">
        <span className="wb-panel-tabs">
          <button
            className={`wb-panel-tab${tab === "output" ? " active" : ""}`}
            onClick={() => onTabChange("output")}
            type="button"
          >
            Output
          </button>
          <button
            className={`wb-panel-tab${tab === "results" ? " active" : ""}`}
            onClick={() => onTabChange("results")}
            type="button"
          >
            {t("tests.results")}
            {hasOutcome ? (
              <span className="wb-panel-tab-count">{outcome?.run.total}</span>
            ) : null}
          </button>
          <button
            className={`wb-panel-tab${tab === "terminal" ? " active" : ""}`}
            onClick={() => onTabChange("terminal")}
            type="button"
          >
            <span className="wb-panel-tab-ico"><TerminalSquare size={12} /></span>
            Terminal
          </button>
        </span>
        <span className="wb-panel-side">
          {tab === "terminal" && runnerOnline === true ? (
            <button
              className={`wb-panel-stop${armStop ? " armed" : ""}`}
              onClick={() => void stopServer()}
              title={armStop ? "Click again to stop — any running terminal session will end" : "Stop the local server (the terminal's engine)"}
              type="button"
            >
              <Power size={12} />
              {armStop ? "Stop server — sure?" : "Stop server"}
            </button>
          ) : null}
          {runnerOnline !== undefined ? (
            <span
              className={`badge ${runnerOnline ? "badge-passed" : "badge-neutral"}`}
              title={runnerOnline ? runnerUrl : "Optional local helper — only the integrated terminal needs it. This workspace reads and writes files through the browser."}
            >
              <span className={`health-dot ${runnerOnline ? "ok" : ""}`} />
              {runnerOnline ? t("tests.runnerOnline") : t("tests.runnerOff")}
            </span>
          ) : null}
          {tab === "output" ? (
            <button aria-label="Clear output" className="wb-icon-btn" disabled={outputLines.length === 0} onClick={onClearOutput} title="Clear output" type="button">
              <Eraser size={13} />
            </button>
          ) : null}
          {/* Shell picker only when a workspace is open — with no folder
              no shell exists, so a shell choice would be a lie. */}
          {tab === "terminal" && runnerOnline !== false && root !== null ? (
            <Select
              ariaLabel="Shell"
              items={[
                ...(shells.length === 0 ? [{ value: "", label: "Loading…" }] : []),
                ...shells.map((s) => ({
                  value: s.id,
                  label: s.available ? s.label : `${s.label} (not installed)`,
                  disabled: !s.available
                }))
              ]}
              onChange={onShellChange}
              size="sm"
              title="Shell"
              value={shell}
            />
          ) : null}
          <button aria-label={maximized ? "Restore panel size" : "Maximize panel"} className="wb-icon-btn" onClick={onToggleMaximize} title={maximized ? "Restore panel size" : "Maximize panel"} type="button">
            {maximized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button aria-label="Close panel" className="wb-icon-btn" onClick={onClose} title="Close panel" type="button">
            <X size={13} />
          </button>
        </span>
      </div>

      <div className="wb-panel-body">
        {tab === "output" ? (
          <div className="wb-output" ref={logRef}>
            {outputLines.length === 0 ? (
              <p className="wb-output-hint muted">
                Runner output appears here. Start a run from the Run view (or the Run button) — progress, summaries and errors land in this log.
                Runner: <span className="mono">{runnerUrl}</span>
              </p>
            ) : (
              <pre className="wb-output-log">
                {outputLines.map((line) => (
                  <span className={line.includes("✖") ? "wb-output-line error" : line.includes("✔") ? "wb-output-line ok" : "wb-output-line"} key={line}>
                    {line}
                    {"\n"}
                  </span>
                ))}
              </pre>
            )}
          </div>
        ) : tab === "terminal" ? (
          <TerminalView onOpenFolder={onOpenFolder} opening={opening} projectId={projectId} root={root} runnerOnline={runnerOnline} runnerUrl={runnerUrl} shellId={shell} />
        ) : hasOutcome && outcome ? (
          <div className="wb-results">            <div className="wb-results-summary">
              <span className="wb-results-pill pass">✓ {outcome.run.passed} passed</span>
              <span className={`wb-results-pill ${outcome.run.failed > 0 ? "fail" : "neutral"}`}>✗ {outcome.run.failed} failed</span>
              <span className="wb-results-pill neutral">{outcome.run.total} total</span>
              <span className="wb-results-pill neutral">{formatMs(outcome.run.durationSec * 1000)}</span>
            </div>
            <DataTable
              columns={[
                { key: "case", header: t("run.caseColumn"), render: (entry) => <span className="mono">{entry.name}</span> },
                {
                  key: "result",
                  header: t("common.status"),
                  render: (entry) => (
                    <StatusBadge tone={entry.status === "failed" ? "failed" : entry.status === "skipped" ? "neutral" : "passed"}>
                      {t(entry.status === "passed" ? "status.passed" : entry.status === "failed" ? "status.failed" : "status.skipped")}
                    </StatusBadge>
                  )
                },
                { align: "end", key: "duration", header: t("common.duration"), render: (entry) => formatMs(entry.durationMs) }
              ]}
              onRowClick={(entry) => entry.runId && navigate(`/runs/${entry.runId}`)}
              rows={outcome.cases}
            />
          </div>
        ) : (
          <p className="wb-output-hint muted">No run yet — results land here after you press Run.</p>
        )}
      </div>
    </section>
  );
}
