// Terminal panel tab — real shells (node-pty on the runner) streamed to
// xterm.js over WebSocket, VS Code style: MULTIPLE terminals, each its
// own tab in the strip above the pane (Lattice's TerminalTabs design).
//
//   • Every tab owns one PTY on the runner, keyed
//     projectId+cwd+terminalId — so tab 1 runs `npm run dev` while tab 2
//     runs a test watch, simultaneously. The tab strip mirrors VS Code:
//     label + ✕ per tab (✕ always on the active one, hover-only on the
//     rest), middle-click closes, [+] at the end opens another.
//   • Each tab = one TerminalInstance: on mount its xterm opens a WS to
//     /api/terminal/shell?…&terminalId=…; keystrokes (onData) → base64
//     `input` frames; PTY bytes → `output` frames → term.write. Resize
//     (ResizeObserver → FitAddon) keeps cols/rows in sync per instance.
//   • INACTIVE tabs stay mounted with visibility:hidden — NOT
//     display:none — so xterm's CharSizeService keeps valid dimensions
//     and switching back needs no re-fit (Lattice's lesson).
//   • The header shell dropdown picks the shell for NEW terminals only
//     (VS Code's model); existing tabs keep the shell they were born
//     with. The tab record commits its shellId on the first `started`
//     frame, so a later dropdown change can never move an existing tab.
//   • Scrollback persists per terminal to localStorage via SerializeAddon
//     (key …:projectId:terminalId): a refresh restores the whole tab
//     list and each tab reattaches to its still-running PTY.
//   • The PTYs are NOT killed on WS close — only closing a tab (✕ /
//     middle-click), a folder switch, or a shell exit ends them.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, FolderOpen, Info, Plus, Power, TerminalSquare, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { fetchRunnerPairCode } from "../../../lib/runner/client";
import { readSavedRoot } from "../data/useTestWorkspace";

export type ShellId = string;

export type ShellDescriptor = { id: string; label: string; available: boolean; resolvedPath: string | null };

/** One tab in the strip: a stable id (the PTY's terminalId), the shell
 *  it was created with ("" until the catalog resolves it), and a display
 *  label ("Git Bash", "Git Bash (2)", …). */
type TermRecord = { id: string; shellId: ShellId; label: string };

// localStorage keys — versioned like Lattice's so a schema change can migrate.
const SHELL_STORAGE_KEY = "wb-term-shell";
const SCROLLBACK_KEY = "wb-term-scrollback.v1";
const TERM_LIST_KEY = "wb-term-list.v1";
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

function readScrollback(projectId: string, terminalId: string): string | null {
  try {
    return localStorage.getItem(`${SCROLLBACK_KEY}:${projectId}:${terminalId}`);
  } catch {
    return null;
  }
}

function writeScrollback(projectId: string, terminalId: string, data: string): void {
  try {
    localStorage.setItem(`${SCROLLBACK_KEY}:${projectId}:${terminalId}`, data);
  } catch {
    /* quota / private mode — best effort */
  }
}

function dropScrollback(projectId: string, terminalId: string): void {
  try {
    localStorage.removeItem(`${SCROLLBACK_KEY}:${projectId}:${terminalId}`);
  } catch {
    /* */
  }
}

function readTermList(projectId: string): { terminals: TermRecord[]; activeId: string | null } | null {
  try {
    const raw = localStorage.getItem(`${TERM_LIST_KEY}:${projectId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { terminals?: unknown; activeId?: unknown };
    if (!Array.isArray(parsed.terminals)) return null;
    const terminals = parsed.terminals.filter(
      (t): t is TermRecord => !!t && typeof (t as TermRecord).id === "string"
    );
    return {
      terminals,
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null
    };
  } catch {
    return null;
  }
}

function writeTermList(projectId: string, terminals: TermRecord[], activeId: string | null): void {
  try {
    localStorage.setItem(`${TERM_LIST_KEY}:${projectId}`, JSON.stringify({ terminals, activeId }));
  } catch {
    /* quota / private mode — best effort */
  }
}

/** "main" keeps the server's default id (backward compat with a PTY that
 *  may already be running from an older build); further tabs are t2, t3… */
function nextTerminalId(existing: string[]): string {
  if (!existing.includes("main")) return "main";
  let n = 2;
  while (existing.includes(`t${n}`)) n++;
  return `t${n}`;
}

/** Tab label from the shell catalog; a second tab on the same shell gets
 *  " (2)", a third " (3)" — VS Code's naming. */
function labelFor(shellId: ShellId, shells: ShellDescriptor[], others: TermRecord[]): string {
  const base = shells.find((s) => s.id === shellId)?.label ?? "Terminal";
  const n = others.filter((t) => t.shellId === shellId).length;
  return n === 0 ? base : `${base} (${n + 1})`;
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

/** Kills one terminal's PTY on the runner (fire-and-forget — the server
 *  reaps stale records anyway). */
function stopRunnerPty(runnerUrl: string, projectId: string, terminalId: string): void {
  void fetch(`${runnerUrl}/api/terminal/stop`, {
    body: JSON.stringify({ projectId, terminalId }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  }).catch(() => undefined);
}

/** One terminal tab: its own xterm + WS + PTY + scrollback. The shellId
 *  is FIXED at birth ("" = resolve from the default when the catalog
 *  lands); the outer component owns the tab list, so this component has
 *  no shell-switch or folder-change logic — a root change remounts every
 *  instance fresh (the outer bumps `gen` in the React key). */
function TerminalInstance({ runnerUrl, runnerOnline, projectId, terminalId, shellId, defaultShellId, active, deadIds, onShellResolved }: {
  runnerUrl: string;
  runnerOnline: boolean | undefined;
  projectId: string;
  /** This tab's PTY id — the server registry key's third component. */
  terminalId: string;
  /** The shell this tab committed to ("" = use the default). */
  shellId: ShellId;
  /** The header dropdown's current pick — only consulted while shellId
   *  is still "" (the tab hasn't spawned yet). */
  defaultShellId: ShellId;
  /** True when this tab is the strip's active one (drives visibility +
   *  focus). */
  active: boolean;
  /** Shared set of tab ids being removed right now — their unmount
   *  cleanup must NOT re-save scrollback over the drop. */
  deadIds: React.RefObject<Set<string>>;
  /** Fired on the first `started` so the tab commits its shell (and
   *  label) into the persisted record. */
  onShellResolved: (terminalId: string, shellId: ShellId) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const serializeRef = useRef<SerializeAddon | null>(null);
  const handleRef = useRef<WebSocket | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  // `active` as seen from WS handlers without re-connecting on switches.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // The tab waits for a shell: an unresolved record follows the header
  // dropdown's pick until the first spawn commits it for good.
  const effectiveShellId = shellId || defaultShellId;

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
    const saved = readScrollback(projectId, terminalId);
    const raf = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0);
    raf(() => {
      try {
        fit.fit();
        if (saved) term.write(saved);
      } catch {
        dropScrollback(projectId, terminalId);
      }
    });

    // A page refresh never runs React's unmount cleanup, so the final
    // serialize below is not guaranteed — the last output could fall
    // outside the 250ms debounced save. pagehide fires reliably on
    // reload/close: save the buffer as it stands at that instant.
    const saveOnPageHide = () => {
      const addon = serializeRef.current;
      if (!addon) return;
      try {
        const data = addon.serialize();
        if (data.length > 0) writeScrollback(projectId, terminalId, data);
      } catch {
        /* addon not in a serializable state */
      }
    };
    window.addEventListener("pagehide", saveOnPageHide);

    // Keep cols/rows in sync with the panel's pixel size. Debounced: the
    // panel animates its height (maximize/restore), and resizing the PTY
    // on every animation frame makes the shell repaint its prompt over
    // and over — the "log climbs one line per click" bug. Works for
    // hidden tabs too: visibility:hidden keeps the container's size.
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
      window.removeEventListener("pagehide", saveOnPageHide);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      // Final serialize — captures output that arrived after the last
      // debounced save. Skip when this tab is being closed/replaced (the
      // outer already dropped its buffer) and skip empty buffers
      // (StrictMode double-mount would clobber the saved scrollback).
      if (!deadIds.current?.has(terminalId)) {
        try {
          const data = serialize.serialize();
          if (data.length > 0) writeScrollback(projectId, terminalId, data);
        } catch {
          /* */
        }
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      serializeRef.current = null;
    };
    // projectId+terminalId key the scrollback record — a different
    // project or tab is a different terminal identity.
  }, [projectId, terminalId, deadIds]);

  // Connect / reconnect when the runner URL, liveness, identity or
  // (still-unresolved) shell changes. Once the shell is committed, the
  // dropdown can never retrigger this effect for this tab.
  useEffect(() => {
    const term = termRef.current;
    // Empty shell = the shell catalog hasn't loaded yet — wait for it.
    if (!term || runnerOnline === false || !effectiveShellId) return;

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
          if (data.length > 0) writeScrollback(projectId, terminalId, data);
        } catch {
          /* addon not in a serializable state */
        }
      }, SCROLLBACK_SAVE_DEBOUNCE_MS);
    };

    async function connect(term: Terminal) {
      const wsUrl = `${runnerUrl.replace(/^http/, "ws")}/api/terminal/shell?projectId=${encodeURIComponent(projectId)}&terminalId=${encodeURIComponent(terminalId)}&shellId=${encodeURIComponent(effectiveShellId)}&cols=${term.cols}&rows=${term.rows}${terminalCwdParam(projectId)}`;
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
            // Commit this tab's shell on first spawn ("" records only —
            // the callback no-ops for tabs that already committed), so a
            // later dropdown change can never move this tab. Focus only
            // when this tab is the one on screen.
            onShellResolved(terminalId, effectiveShellId);
            if (activeRef.current) term.focus();
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
  }, [runnerUrl, runnerOnline, projectId, terminalId, effectiveShellId, deadIds, onShellResolved]);

  // VS Code: activating a tab focuses its terminal, so keystrokes land
  // there without a second click into the pane.
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => termRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [active]);

  return <div className="wb-term-host" ref={containerRef} />;
}

/** The whole terminal tab: strip + stacked instances. Owns the tab list
 *  (persisted per project), the [+]/✕/switch handlers, and the folder
 *  transitions (open/switch/close) that reset or stop every PTY. */
export function TerminalView({ runnerUrl, runnerOnline, defaultShellId, shells, projectId, root, onOpenFolder, opening }: {
  runnerUrl: string;
  runnerOnline: boolean | undefined;
  /** The header dropdown's pick — the shell for NEW terminals only. */
  defaultShellId: ShellId;
  /** The runner's shell catalog, for tab labels. */
  shells: ShellDescriptor[];
  /** Terminals are project-scoped: PTYs, scrollback and the tab list
   *  are keyed by project so two projects never share a session. */
  projectId: string;
  /** The open workspace's root (real disk path for agent-picked
   *  folders). A change stops every old PTY and restarts one fresh
   *  tab in the new root; null means no folder at all — the gate shows
   *  and NOTHING runs. */
  root: string | null;
  /** Opens the folder dialog (the hook's openFolder — with the agent
   *  up that is the native OS dialog). */
  onOpenFolder: () => void;
  /** True while a folder open is in flight (disables the gate's button). */
  opening: boolean;
}) {
  const offline = runnerOnline === false;
  const hasWorkspace = root !== null;

  // Browser-picked (FSA) workspaces hide their real disk path from the
  // page — Chrome's security — so the shell can't cd into them and
  // starts at the agent's default cwd (the app root) instead. The
  // explorer still shows the folder's files, which makes the terminal's
  // wrong-looking prompt mysterious. The banner below says exactly what
  // happened and how to get a true-path shell. Re-read on root changes
  // so reopening the folder (runner mode) clears it.
  const [fsaWorkspace, setFsaWorkspace] = useState(false);
  useEffect(() => {
    const saved = readSavedRoot(projectId);
    setFsaWorkspace(!!saved && saved.mode === "fsa");
  }, [projectId, root]);

  const [terminals, setTerminals] = useState<TermRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Bumped on a folder switch so every instance remounts fresh (the
   *  React key carries it — old xterms/WS never leak into the new root). */
  const [gen, setGen] = useState(0);

  // Refs mirroring state for handlers/effects that must read the CURRENT
  // list without being re-run by it (root transitions, tab mutations).
  const terminalsRef = useRef(terminals);
  const activeIdRef = useRef(activeId);
  const shellsRef = useRef(shells);
  const defaultShellRef = useRef(defaultShellId);
  useEffect(() => {
    terminalsRef.current = terminals;
    activeIdRef.current = activeId;
  }, [terminals, activeId]);
  useEffect(() => {
    shellsRef.current = shells;
  }, [shells]);
  useEffect(() => {
    defaultShellRef.current = defaultShellId;
  }, [defaultShellId]);

  // Tab ids removed in the CURRENT mutation — their instances' unmount
  // cleanup must not re-save scrollback over the buffer the mutation
  // just dropped. Cleared per mutation (ids can be reissued later).
  const deadIds = useRef<Set<string>>(new Set());

  // Restore the saved tab list (refresh parity: same tabs, same active
  // one, each reattaching to its still-running PTY) — or seed one tab.
  useEffect(() => {
    if (!hasWorkspace) return;
    const saved = readTermList(projectId);
    if (saved && saved.terminals.length > 0) {
      setTerminals(saved.terminals);
      setActiveId(
        saved.terminals.some((t) => t.id === saved.activeId)
          ? saved.activeId
          : (saved.terminals[0]?.id ?? null)
      );
    } else {
      const first: TermRecord = { id: "main", shellId: "", label: "Terminal" };
      setTerminals([first]);
      setActiveId(first.id);
      writeTermList(projectId, [first], first.id);
    }
  }, [projectId, hasWorkspace]);

  // Folder transitions — the ONE place terminal lifetimes are decided:
  //   • folder switched: every old tab's PTY stops, buffers drop, one
  //     fresh tab starts in the new root (Lattice restarts per cwd too);
  //   • folder closed: same teardown, tab list cleared (the gate shows);
  //   • first mount: nothing — a refresh must reattach, not restart.
  const prevRootRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevRootRef.current;
    prevRootRef.current = root;
    if (prev === undefined || prev === root) return;
    const oldTabs = terminalsRef.current;
    deadIds.current = new Set(oldTabs.map((t) => t.id));
    for (const t of oldTabs) {
      stopRunnerPty(runnerUrl, projectId, t.id);
      dropScrollback(projectId, t.id);
    }
    if (root === null) {
      setTerminals([]);
      setActiveId(null);
      writeTermList(projectId, [], null);
    } else {
      const first: TermRecord = { id: "main", shellId: "", label: "Terminal" };
      setTerminals([first]);
      setActiveId(first.id);
      writeTermList(projectId, [first], first.id);
      setGen((g) => g + 1);
    }
  }, [root, projectId, runnerUrl]);

  /** [+] — a new tab in the dropdown's current shell, focused at once. */
  function addTerminal() {
    const current = terminalsRef.current;
    const id = nextTerminalId(current.map((t) => t.id));
    deadIds.current.delete(id); // a reissued id must save again
    const record: TermRecord = {
      id,
      shellId: defaultShellRef.current,
      label: labelFor(defaultShellRef.current, shellsRef.current, current)
    };
    const next = [...current, record];
    setTerminals(next);
    setActiveId(id);
    writeTermList(projectId, next, id);
  }

  /** ✕ / middle-click — stop that PTY, drop its buffer, activate the
   *  neighbour (the one before, else the first; VS Code's pick). */
  function closeTerminal(id: string) {
    const current = terminalsRef.current;
    if (!current.some((t) => t.id === id)) return;
    deadIds.current.add(id);
    stopRunnerPty(runnerUrl, projectId, id);
    dropScrollback(projectId, id);
    const idx = current.findIndex((t) => t.id === id);
    const next = current.filter((t) => t.id !== id);
    const nextActive =
      activeIdRef.current === id
        ? next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null
        : activeIdRef.current;
    setTerminals(next);
    setActiveId(nextActive);
    writeTermList(projectId, next, nextActive);
  }

  /** First spawn of an unresolved tab ("") — commit the shell AND the
   *  real label into the record, so the dropdown never moves this tab. */
  const onShellResolved = useCallback((id: string, shell: ShellId) => {
    setTerminals((current) => {
      const rec = current.find((t) => t.id === id);
      if (!rec || rec.shellId === shell) return current;
      const next = current.map((t) =>
        t.id === id
          ? { ...t, shellId: shell, label: labelFor(shell, shellsRef.current, current.filter((x) => x.id !== id)) }
          : t
      );
      writeTermList(projectId, next, activeIdRef.current);
      return next;
    });
  }, [projectId]);

  if (offline) {
    return <ConnectCard runnerUrl={runnerUrl} />;
  }
  if (!hasWorkspace) {
    return <NoWorkspaceGate onOpenFolder={onOpenFolder} opening={opening} />;
  }

  return (
    <div className="wb-term">
      {fsaWorkspace ? (
        <div className="wb-term-notice">
          <Info size={12} />
          <span>
            Browser-picked workspace — Chrome hides its real path, so the shell starts at the app root.
            Reopen the folder with the server online (Open Folder) to land the shell inside it.
          </span>
        </div>
      ) : null}
      {/* The strip stays even with zero tabs (just [+]) — VS Code keeps
          its actions row too, so a closed last tab is recoverable. */}
      <div className="wb-term-tabs" role="tablist" aria-label="Terminals">
        {terminals.map((t) => (
          <div
            aria-selected={t.id === activeId}
            className={`wb-term-tab${t.id === activeId ? " active" : ""}`}
            key={t.id}
            onClick={() => setActiveId(t.id)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTerminal(t.id);
              }
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault(); // no autoscroll cursor
            }}
            role="tab"
            tabIndex={-1}
            title={t.label}
          >
            <span className="wb-term-tab-label">{t.label}</span>
            <button
              aria-label={`Close ${t.label}`}
              className="wb-term-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTerminal(t.id);
              }}
              title={`Close ${t.label}`}
              type="button"
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <button aria-label="New terminal" className="wb-term-add" onClick={addTerminal} title="New terminal" type="button">
          <Plus size={13} />
        </button>
      </div>
      {/* Every tab stays mounted; hidden ones keep visibility (never
          display:none) so xterm's char metrics stay valid for a switch. */}
      <div className="wb-term-hosts">
        {terminals.length === 0 ? (
          <div className="wb-term-empty">No terminal open — press + to start one.</div>
        ) : (
          terminals.map((t) => (
            <div
              className="wb-term-slot"
              key={`${gen}:${t.id}`}
              style={{ visibility: t.id === activeId ? "visible" : "hidden" }}
            >
              <TerminalInstance
                active={t.id === activeId}
                deadIds={deadIds}
                defaultShellId={defaultShellId}
                onShellResolved={onShellResolved}
                projectId={projectId}
                runnerOnline={runnerOnline}
                runnerUrl={runnerUrl}
                shellId={t.shellId}
                terminalId={t.id}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
