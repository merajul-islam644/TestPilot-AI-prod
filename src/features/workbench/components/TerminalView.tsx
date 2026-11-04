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

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";

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

export function TerminalView({ runnerUrl, runnerOnline, shellId, projectId }: {
  runnerUrl: string;
  runnerOnline: boolean | undefined;
  shellId: ShellId;
  /** Terminals are project-scoped: shell process and scrollback are
   *  keyed by project so two projects never share a session. */
  projectId: string;
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
    // different terminal identity.
  }, [projectId]);

  // Connect / reconnect whenever the runner URL, project, or the picked
  // shell changes. First run (mount) goes through the same path as a switch.
  useEffect(() => {
    const term = termRef.current;
    // Empty shellId = the shell catalog hasn't loaded yet.
    if (!term || runnerOnline === false || !shellId) return;

    const isShellSwitch = prevShellRef.current !== null && prevShellRef.current !== shellId;
    prevShellRef.current = shellId;

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
      if (isShellSwitch) {
        // New shell = new PTY. Stop the running one first, or the
        // registry would just reattach us to the old shell. The scrollback
        // dies with it: drop the persisted buffer and clear the canvas.
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

      const wsUrl = `${runnerUrl.replace(/^http/, "ws")}/api/terminal/shell?projectId=${encodeURIComponent(projectId)}&shellId=${encodeURIComponent(shellId)}&cols=${term.cols}&rows=${term.rows}`;
      const ws = new WebSocket(wsUrl);
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
  }, [runnerUrl, shellId, runnerOnline, projectId]);

  if (runnerOnline === false) {
    return (
      <p className="wb-output-hint muted">
        Terminal needs the local runner (<span className="mono">{runnerUrl}</span>) and it looks offline. Start the runner, then reopen this tab.
      </p>
    );
  }

  return (
    <div className="wb-term">
      {/* Padding keeps xterm's text off the panel borders; the canvas
          fills the slot and FitAddon matches rows/cols to it. */}
      <div className="wb-term-host" ref={containerRef} />
    </div>
  );
}
