// Terminal panel tab — a real shell (node-pty on the runner) streamed to
// xterm.js over WebSocket, mirroring Lattice's TerminalPanel design:
//
//   • On mount the xterm instance opens a WS to
//     /api/terminal/shell?shellId=…&cols=…&rows=… (cwd defaults to the
//     app root server-side). Keystrokes (onData) → base64 `input`
//     frames; PTY bytes → `output` frames → term.write — full ANSI
//     colors, cursor, and interactive apps included.
//   • ResizeObserver → FitAddon → `resize` frames keep cols/rows in sync.
//   • Shell switch (header dropdown) tears down the WS and reopens with
//     the new shellId; the xterm instance (and its scrollback) resets.
//   • Scrollback persists to localStorage via SerializeAddon, so a
//     refresh or panel toggle doesn't wipe the buffer.
//   • The PTY itself is NOT killed on WS close — the runner keeps it
//     alive keyed by cwd+terminalId, so `npm run dev` survives a
//     remount. Only a real shell exit (exit / Ctrl+C) ends it.

import { useEffect, useRef, useState } from "react";
import { Check, Copy, FolderOpen, Power, TerminalSquare } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { fetchRunnerPairCode } from "../../../lib/runner/client";
import { readSavedRoot } from "../data/useTestWorkspace";

export type ShellId = string;

// localStorage keys — versioned like Lattice's so a schema change can migrate.
const SHELL_STORAGE_KEY = "wb-term-shell";
const SCROLLBACK_KEY = "wb-term-scrollback.v1";
const SCROLLBACK_SAVE_DEBOUNCE_MS = 250;

// Match the IDE chrome (Lattice's DEFAULT_FG/BG) — a near-black surface
// with a soft off-white foreground; every other color arrives as real
// ANSI from the PTY.
const DEFAULT_FG = "#e4e4e7";
const DEFAULT_BG = "#18181b";

export function readStoredShell(): ShellId | null {
  try {
    return localStorage.getItem(SHELL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredShell(id: ShellId): void {
  try {
    localStorage.setItem(SHELL_STORAGE_KEY, id);
  } catch {
    /* private mode — the picker just resets on reload */
  }
}

type TermFrame =
  | { type: "started"; shell: string; cwd: string; pid: number; resumed: boolean }
  | { type: "output"; data: string }
  | { type: "exit"; code: number | null; signal?: string; reason?: string }
  | { type: "pong"; ts: number }
  | { type: "error"; message: string };

function b64Decode(s: string): string {
  try {
    return atob(s);
  } catch {
    return "";
  }
}
function b64Encode(s: string): string {
  try {
    return btoa(s);
  } catch {
    return "";
  }
}

/** The one-liner that starts the agent on any machine (npm installs it
 *  straight from the public repo — no clone, no checkout). */
const CONNECT_COMMAND = "npx -y github:merajul-islam644/TestPilot-AI-prod#path:runner";

/** The terminal tab's offline state — an onboarding card, not an error:
 *  a website can never open a shell by itself, so the card hands the
 *  user the one command that starts the agent on THEIR machine. The
 *  "Start server" button fires the agent's registered protocol handler
 *  (testpilot-runner://) — after the user has run the command below
 *  once, this button alone starts the agent; Windows just asks for
 *  permission. The liveness probe retries every few seconds, so the
 *  panel pairs with the agent automatically the moment it's up. */
function ConnectCard({ runnerUrl }: { runnerUrl: string }) {
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONNECT_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refused — the text stays selectable */
    }
  };
  const startServer = () => {
    setStarting(true);
    // Windows shows its own confirm dialog here; the probe flips the
    // panel to connected once the agent is up. On machines where the
    // protocol isn't registered yet (first time), nothing happens —
    // the command below stays the first-time path.
    try {
      window.location.href = "testpilot-runner://start";
    } catch {
      /* unknown protocol — some browsers just ignore it */
    }
    window.setTimeout(() => setStarting(false), 6000);
  };
  return (
    <div className="wb-connect">
      <TerminalSquare className="wb-connect-icon" size={20} />
      <p className="wb-connect-title">Connect this machine</p>
      <button className="wb-connect-start" disabled={starting} onClick={startServer} title="Starts the local agent through the testpilot-runner:// handler (registered on first run)" type="button">
        <Power size={13} />
        {starting ? "Starting server…" : "Start server"}
      </button>
      <p className="wb-connect-body">
        The terminal is a real shell on your machine — no website can open
        one by itself. Run the command below once (PowerShell or CMD) to
        register it; after that this button alone starts the server:
      </p>
      <div className="wb-connect-cmd">
        <code>{CONNECT_COMMAND}</code>
        <button className="wb-icon-btn wb-connect-copy" onClick={() => void copy()} title="Copy command" type="button">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <p className="wb-connect-note">
        Have the repo instead? <code>npm start</code> inside <code>runner/</code> works the same
        (<span className="mono">{runnerUrl}</span>). Checking every few seconds…
      </p>
    </div>
  );
}

/** The terminal tab with the server up but NO folder open: a gate, not
 *  a shell. A shell always starts in SOME directory — with no workspace
 *  that would be the runner's own install path, which is pure noise.
 *  So no folder → no shell at all; opening one (the agent's native
 *  dialog → real disk path) starts the shell right there. */
function NoWorkspaceGate({ onOpenFolder, opening }: { onOpenFolder: () => void; opening: boolean }) {
  return (
    <div className="wb-connect">
      <TerminalSquare className="wb-connect-icon" size={20} />
      <p className="wb-connect-title">No folder open</p>
      <button className="wb-connect-start" disabled={opening} onClick={onOpenFolder} title="Opens the folder dialog — the shell starts inside the folder you pick" type="button">
        <FolderOpen size={13} />
        {opening ? "Opening…" : "Open Folder"}
      </button>
      <p className="wb-connect-body">
        The terminal runs inside the folder you open — nothing starts until
        then. The folder dialog is the agent's native one, so the shell gets
        the folder's real disk path.
      </p>
    </div>
  );
}

function readScrollback(projectId: string): string | null {
  try {
    return localStorage.getItem(`${SCROLLBACK_KEY}:${projectId}`);
  } catch {
    return null;
  }
}

function writeScrollback(projectId: string, data: string): void {
  try {
    localStorage.setItem(`${SCROLLBACK_KEY}:${projectId}`, data);
  } catch {
    /* quota / private mode — best effort */
  }
}

function dropScrollback(projectId: string): void {
  try {
    localStorage.removeItem(`${SCROLLBACK_KEY}:${projectId}`);
  } catch {
    /* */
  }
}

/** VS Code parity: the shell starts in the OPEN WORKSPACE folder — but
 *  only when its disk path is actually known, i.e. a workspace opened
 *  through the agent's own folder dialog (mode "runner"). A browser
 *  picker (FSA) workspace never reveals its path — the browser hides it
 *  for security — so those shells start at the app root. Read fresh on
 *  every connect so a newly opened workspace applies from the next
 *  terminal (re)connect on. */
function terminalCwdParam(projectId: string): string {
  const saved = readSavedRoot(projectId);
  if (!saved || saved.mode !== "runner") return "";
  return `&cwd=${encodeURIComponent(saved.root)}`;
}

export function TerminalView({ runnerUrl, runnerOnline, shellId, projectId, root, onOpenFolder, opening }: {
  runnerUrl: string;
  runnerOnline: boolean | undefined;
  shellId: ShellId;
  /** Terminals are project-scoped: shell process and scrollback are
   *  keyed by project so two projects never share a session. */
  projectId: string;
  /** The open workspace's root (real disk path for agent-picked
   *  folders). A change restarts the shell in the new root; null means
   *  no folder at all — the gate shows and NO shell spawns. */
  root: string | null;
  /** Opens the folder dialog (the hook's openFolder — with the agent
   *  up that is the native OS dialog). */
  onOpenFolder: () => void;
  /** True while a folder open is in flight (disables the gate's button). */
  opening: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const serializeRef = useRef<SerializeAddon | null>(null);
  const handleRef = useRef<WebSocket | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  // Tracks the previous shellId so the WS effect can tell "first open"
  // from "shell switch" (the latter resets the buffer).
  const prevShellRef = useRef<string | null>(null);
  // Tracks the previous workspace root so opening a different folder
  // restarts the shell in the NEW root — Lattice parity (VS Code also
  // restarts its terminals when the workspace changes). undefined
  // means "this effect hasn't run yet".
  const prevRootRef = useRef<string | null | undefined>(undefined);
  // The offline ConnectCard renders no xterm container — the mount
  // effect must re-run (and create it) when the agent comes online.
  const offline = runnerOnline === false;
  // Same trick for the no-folder gate: it also renders no container, so
  // the mount effect re-runs (and creates xterm) when a folder opens.
  const hasWorkspace = root !== null;

  // Mount xterm ONCE; the WS effect below owns connect/reconnect.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "block",
      convertEol: false,
      allowProposedApi: true,
      theme: {
        background: DEFAULT_BG,
        foreground: DEFAULT_FG,
        cursor: DEFAULT_FG,
        cursorAccent: DEFAULT_BG,
        selectionBackground: "#3f3f46"
      },
      scrollback: 5000
    });
    const fit = new FitAddon();
    const serialize = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(serialize);
    term.open(container);

    termRef.current = term;
    fitRef.current = fit;
    serializeRef.current = serialize;

    // Restore the saved buffer one frame after open(): term.write walks
    // into viewport internals that need a tick to initialize.
    const saved = readScrollback(projectId);
    const raf = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0);
    raf(() => {
      try {
        fit.fit();
        if (saved) term.write(saved);
      } catch {
        dropScrollback(projectId);
      }
    });

    // Keep cols/rows in sync with the panel's pixel size. Debounced: the
    // panel animates its height (maximize/restore), and resizing the PTY
    // on every animation frame makes the shell repaint its prompt over
    // and over — the "log climbs one line per click" bug.
    let resizeTimer: number | null = null;
    let sentCols = 0;
    let sentRows = 0;
    const ro = new ResizeObserver(() => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        try {
          fit.fit();
          if (term.cols > 0 && term.rows > 0 && (term.cols !== sentCols || term.rows !== sentRows)) {
            sentCols = term.cols;
            sentRows = term.rows;
            handleRef.current?.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
          }
        } catch {
          /* container detached */
        }
      }, 200);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      // Final serialize — captures output that arrived after the last
      // debounced save. Skip empty buffers (StrictMode double-mount would
      // clobber the saved scrollback with "").
      try {
        const data = serialize.serialize();
        if (data.length > 0) writeScrollback(projectId, data);
      } catch {
        /* */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      serializeRef.current = null;
    };
    // projectId keys the scrollback record — a different project is a
    // different terminal identity. `offline`/`hasWorkspace` re-run the
    // mount when the ConnectCard or the no-folder gate hands the slot
    // back to the real xterm container.
  }, [projectId, offline, hasWorkspace]);

  // Connect / reconnect whenever the runner URL, project, the picked
  // shell, or the workspace root changes. First run (mount) goes through
  // the same path as a switch.
  useEffect(() => {
    // No open folder → NO shell anywhere. A shell must start in some
    // directory and with no workspace that would be the runner's own
    // install path — pure noise, so nothing spawns (the gate explains).
    // Checked BEFORE the term lookup: the gate renders no container, so
    // waiting for `term` here would skip the folder-close stop entirely.
    if (root === null) {
      // Folder just closed? Stop its shell and drop its buffer — the
      // gate replaces the terminal and nothing should keep running.
      const closingFolder = prevRootRef.current !== undefined && prevRootRef.current !== null;
      prevRootRef.current = root;
      handleRef.current?.close();
      handleRef.current = null;
      if (closingFolder) {
        void fetch(`${runnerUrl}/api/terminal/stop`, {
          body: JSON.stringify({ projectId, terminalId: "main" }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        }).catch(() => undefined);
        dropScrollback(projectId);
      }
      return;
    }
    const term = termRef.current;
    // Empty shellId = the shell catalog hasn't loaded yet.
    if (!term || runnerOnline === false || !shellId) return;

    const isShellSwitch = prevShellRef.current !== null && prevShellRef.current !== shellId;
    prevShellRef.current = shellId;
    // A different folder means a different working directory: the old
    // PTY must be stopped, or the server's registry would reattach us
    // to the shell still sitting in the previous folder. A first mount
    // (undefined → whatever) never tears down — a page refresh must
    // reattach to its running shell, keeping the session.
    const isRootChange = prevRootRef.current !== undefined && prevRootRef.current !== root;
    prevRootRef.current = root;

    let disposed = false;
    const dataSubs: { dispose(): void }[] = [];
    // Close whatever handle the previous effect run left behind.
    handleRef.current?.close();
    handleRef.current = null;

    const scheduleSave = () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        const addon = serializeRef.current;
        if (!addon) return;
        try {
          const data = addon.serialize();
          if (data.length > 0) writeScrollback(projectId, data);
        } catch {
          /* addon not in a serializable state */
        }
      }, SCROLLBACK_SAVE_DEBOUNCE_MS);
    };

    /** Stops the old PTY on a shell switch, then opens the new WS. */
    async function connect(term: Terminal) {
      if (isShellSwitch || isRootChange) {
        // New shell OR new folder = new PTY. Stop the running one first,
        // or the registry would just reattach us to the old shell (still
        // sitting in the previous folder). The scrollback dies with it:
        // drop the persisted buffer and clear the canvas.
        try {
          await fetch(`${runnerUrl}/api/terminal/stop`, {
            body: JSON.stringify({ projectId, terminalId: "main" }),
            headers: { "Content-Type": "application/json" },
            method: "POST"
          });
        } catch {
          /* best effort — the server reaps stale records anyway */
        }
        if (disposed) return;
        dropScrollback(projectId);
        term.reset();
      }

      const wsUrl = `${runnerUrl.replace(/^http/, "ws")}/api/terminal/shell?projectId=${encodeURIComponent(projectId)}&shellId=${encodeURIComponent(shellId)}&cols=${term.cols}&rows=${term.rows}${terminalCwdParam(projectId)}`;
      // The agent gates the shell WS behind its pairing code (WebSocket
      // has no CORS) — fetch it fresh on every connect so an agent
      // restart with a new code still pairs. Unreachable or older agent
      // → connect without one (the agent refuses it only when it has one).
      const pairCode = await fetchRunnerPairCode();
      if (disposed) return;
      const ws = new WebSocket(pairCode ? `${wsUrl}&code=${encodeURIComponent(pairCode)}` : wsUrl);
      if (disposed) {
        ws.close();
        return;
      }
      handleRef.current = ws;

      ws.onmessage = (event) => {
        let frame: TermFrame;
        try {
          frame = JSON.parse(String(event.data)) as TermFrame;
        } catch {
          return;
        }
        switch (frame.type) {
          case "started":
            // Focus so keystrokes land here without an extra click.
            term.focus();
            break;
          case "output":
            term.write(b64Decode(frame.data));
            scheduleSave();
            break;
          case "exit": {
            const notice = frame.code === 0
              ? "\r\n\u001b[2m[Process completed]\u001b[0m\r\n"
              : "\r\n\u001b[31m[Process exited with code " + (frame.code ?? "?") + "]\u001b[0m\r\n";
            term.write(notice);
            scheduleSave();
            break;
          }
          case "error":
            term.write("\r\n\u001b[31m[Terminal error] " + frame.message + "\u001b[0m\r\n");
            break;
          default:
            break;
        }
      };

      // A refused pairing (agent restarted → new code) or a dead agent
      // lands here — say so instead of a silent black screen.
      ws.onclose = () => {
        if (!disposed) term.write("\r\n\u001b[2m[Terminal disconnected — it reconnects on the next tab open]\u001b[0m\r\n");
      };

      // Keystrokes → PTY stdin (base64 keeps arbitrary bytes lossless).
      dataSubs.push(term.onData((data) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: "input", data: b64Encode(data) }));
      }));
    }

    void connect(term);

    return () => {
      disposed = true;
      for (const sub of dataSubs) sub.dispose();
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      handleRef.current?.close();
      handleRef.current = null;
    };
  }, [runnerUrl, shellId, runnerOnline, projectId, root]);

  if (offline) {
    return <ConnectCard runnerUrl={runnerUrl} />;
  }
  if (!hasWorkspace) {
    return <NoWorkspaceGate onOpenFolder={onOpenFolder} opening={opening} />;
  }

  return (
    <div className="wb-term">
      {/* Padding keeps xterm's text off the panel borders; the canvas
          fills the slot and FitAddon matches rows/cols to it. */}
      <div className="wb-term-host" ref={containerRef} />
    </div>
  );
}
