// Interactive shell bridge for the workbench Terminal panel — a port of
// Lattice's mcp-server/src/terminal.ts adapted to the TestPilot runner.
//
// Why PTY instead of per-command spawn: npm/git/ls detect stdin TTY and
// degrade (no colors, no progress, no prompt) without one. node-pty gives
// the shell a real console, so the xterm.js front-end behaves exactly
// like VS Code's integrated terminal.
//
// Protocol (newline-delimited JSON over the WebSocket):
//   browser → server: { type: "input", data: <base64> }
//                     { type: "resize", cols, rows }
//                     { type: "ping", ts }
//   server → browser: { type: "started", shell, cwd, pid, resumed }
//                     { type: "output", data: <base64> }
//                     { type: "exit", code, signal?, reason? }
//                     { type: "pong", ts }
//
// The PTY outlives its WebSocket (persistent registry keyed by
// cwd+terminalId): a refresh or closed panel reattaches to the same
// running shell; `exit`/Ctrl+C kills it for real.

import * as os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

// node-pty loads lazily so a machine without the native binary doesn't
// crash the runner at import time — the WS route reports the problem.
let ptyModule = null;
async function loadPty() {
  if (ptyModule) return ptyModule;
  ptyModule = await import("node-pty");
  return ptyModule;
}

// The session starts at the app root — the code the user is testing.
const APP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Shell catalog — the dropdown. Availability is resolved per request via a
// tiny which() (PATH scan), so the UI is honest about what can launch here.
// ---------------------------------------------------------------------------

const SHELL_CATALOG = os.platform() === "win32"
  ? [
      { id: "pwsh", binary: "pwsh.exe", args: ["-NoLogo"], label: "PowerShell 7" },
      { id: "powershell", binary: "powershell.exe", args: ["-NoLogo"], label: "Windows PowerShell" },
      { id: "cmd", binary: "cmd.exe", args: ["/q"], label: "Command Prompt" },
      { id: "git-bash", binary: "bash.exe", args: ["-l"], label: "Git Bash" },
      { id: "wsl", binary: "wsl.exe", args: [], label: "WSL (default distro)" }
    ]
  : [
      { id: "bash", binary: "bash", args: ["-l"], label: "Bash" },
      { id: "zsh", binary: "zsh", args: ["-l"], label: "Zsh" },
      { id: "sh", binary: "sh", args: ["-l"], label: "POSIX sh" }
    ];

function whichSync(cmd) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const win = os.platform() === "win32";
  const exts = win ? (process.env.PATHEXT ?? ".EXE;.BAT;.CMD").split(";").filter(Boolean) : [];
  const hasExt = win && exts.some((e) => cmd.toLowerCase().endsWith(e.toLowerCase()));
  for (const dir of dirs) {
    const tries = [cmd];
    if (win && !hasExt) for (const e of exts) tries.push(cmd + e);
    for (const name of tries) {
      const candidate = path.join(dir, name);
      try {
        if (existsSync(candidate)) {
          const st = statSync(candidate);
          if (st.isFile() || st.isSymbolicLink()) return candidate;
        }
      } catch {
        /* permission errors etc. — try next */
      }
    }
  }
  return null;
}

// Windows installers often leave shells OFF the PATH: Git for Windows adds
// only Git\cmd (git.exe), never Git\bin (bash.exe), and PowerShell 7 lives
// in its own folder unless opted in. The default PATH probe alone would
// label Git Bash "(not installed)" on exactly those machines — so fall
// back to the standard install locations (what VS Code checks) before
// declaring a shell unavailable. Evaluated per request, same as whichSync.
const KNOWN_SHELL_PATHS = {
  "git-bash": [
    "%ProgramFiles%\\Git\\bin\\bash.exe",
    "%ProgramFiles(x86)%\\Git\\bin\\bash.exe",
    "%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe",
    "%USERPROFILE%\\scoop\\apps\\git\\current\\bin\\bash.exe",
    "%ProgramFiles%\\Git\\usr\\bin\\bash.exe"
  ],
  pwsh: [
    "%ProgramFiles%\\PowerShell\\7\\pwsh.exe",
    "%ProgramFiles%\\PowerShell\\7-preview\\pwsh.exe",
    "%USERPROFILE%\\.dotnet\\tools\\pwsh.exe"
  ]
};

function expandEnvVars(p) {
  return p.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);
}

function isLaunchable(candidate) {
  try {
    if (!existsSync(candidate)) return false;
    const st = statSync(candidate);
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}

function resolveShellEntry(entry) {
  const onPath = whichSync(entry.binary);
  if (onPath) return onPath;
  for (const raw of KNOWN_SHELL_PATHS[entry.id] ?? []) {
    const candidate = expandEnvVars(raw);
    if (isLaunchable(candidate)) return candidate;
  }
  return null;
}

function listShells() {
  return SHELL_CATALOG.map((s) => {
    const resolved = resolveShellEntry(s);
    return { id: s.id, label: s.label, available: resolved !== null, resolvedPath: resolved };
  });
}

function resolveShellById(shellId) {
  if (shellId) {
    const entry = SHELL_CATALOG.find((s) => s.id === shellId);
    if (entry) {
      const resolved = resolveShellEntry(entry);
      if (resolved) return { shell: resolved, args: entry.args };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Persistent shell registry — one PTY per cwd+terminalId. WS close detaches
// the socket only; refresh reattaches to the same running shell.
// ---------------------------------------------------------------------------

const PERSISTENT_SHELL_GC_MS = 60_000;
const persistentShells = new Map();
// Serializes attaches per key: while one spawn is in flight (node-pty's
// first dynamic import is slow), later WS opens for the same terminal
// must NOT start a second shell.
const spawnsInFlight = new Map();

function safeSend(socket, payload) {
  try {
    if (socket.readyState === 1 /* OPEN */) socket.send(JSON.stringify(payload));
  } catch {
    /* socket closed mid-send */
  }
}

function base64Encode(s) {
  return Buffer.from(s, "utf8").toString("base64");
}
function base64Decode(s) {
  try {
    return Buffer.from(s, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function fanOutput(rec, payload) {
  const text = JSON.stringify(payload);
  for (const ws of rec.listeners) {
    if (ws.readyState === 1) {
      try {
        ws.send(text);
      } catch {
        /* socket closed mid-send */
      }
    }
  }
}

function wireSocketToRecord(socket, rec, resumed) {
  safeSend(socket, { type: "started", shell: rec.shell, cwd: rec.cwd, pid: rec.pid, resumed });

  socket.on("message", (raw) => {
    if (rec.exited) return;
    let frame;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      return; // malformed keystroke frame — ignore
    }
    switch (frame?.type) {
      case "input": {
        const data = typeof frame.data === "string" ? base64Decode(frame.data) : "";
        if (data) {
          try {
            rec.pty.write(data);
          } catch {
            /* PTY already gone */
          }
        }
        return;
      }
      case "resize": {
        const c = Number(frame.cols);
        const r = Number(frame.rows);
        if (Number.isFinite(c) && Number.isFinite(r) && c >= 2 && c <= 500 && r >= 2 && r <= 200) {
          try {
            rec.pty.resize(c, r);
          } catch {
            /* PTY already gone */
          }
        }
        return;
      }
      case "ping": {
        safeSend(socket, { type: "pong", ts: frame.ts });
        return;
      }
      default:
        return; // unknown frame — forward-compatible ignore
    }
  });

  const detach = () => {
    rec.listeners.delete(socket);
    try {
      socket.removeAllListeners();
    } catch {
      /* */
    }
  };
  socket.on("close", detach);
  socket.on("error", detach);
}

async function attachShellToSocket(socket, opts) {
  // The client may hint a cwd (the open workspace's disk path). If the
  // hint no longer exists (folder moved/deleted), fall back to the app
  // root instead of refusing — a stale hint shouldn't brick the shell.
  const hinted = opts.cwd ? path.resolve(opts.cwd) : null;
  const hintedOk = hinted !== null && existsSync(hinted) && statSync(hinted).isDirectory();
  if (opts.cwd && !hintedOk) console.log(`[terminal] cwd hint unusable, falling back to app root: ${opts.cwd}`);
  const cwd = hintedOk ? hinted : APP_ROOT;

  // Terminals are PROJECT-SCOPED, and the folder is part of the shell's
  // identity: keying by cwd as well (Lattice's workspaceId:cwd:terminalId
  // contract) guarantees a shell can never reattach across a folder
  // change — a new root always means a fresh spawn inside that root.
  const key = `${opts.projectId || "default"}\u0000${cwd}\u0000${opts.terminalId ?? "main"}`;
  // Serialize: wait out any spawn already running for this terminal.
  while (spawnsInFlight.has(key)) {
    await spawnsInFlight.get(key);
  }
  const existing = persistentShells.get(key);

  // Reattach: the shell survived a refresh / panel close.
  if (existing && !existing.exited && !existing.stopRequested) {
    console.log(`[terminal] attach (resumed) key=${key} shell=${existing.shell} pid=${existing.pid}`);
    existing.listeners.add(socket);
    wireSocketToRecord(socket, existing, true);
    return;
  }
  if (existing) {
    // Stale record (exited or stop-requested) — reap it before respawning.
    try {
      existing.pty.kill();
    } catch {
      /* already gone */
    }
    persistentShells.delete(key);
  }

  let release;
  const inFlight = new Promise((resolve) => {
    release = resolve;
  });
  spawnsInFlight.set(key, inFlight);
  try {
    const pty = await loadPty();
    const picked = resolveShellById(opts.shellId);
    const shellPath = picked ? picked.shell : os.platform() === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = picked ? picked.args : os.platform() === "win32" ? ["/q"] : [];
    const cols = Math.max(2, Math.min(500, Number(opts.cols) || 80));
    const rows = Math.max(2, Math.min(200, Number(opts.rows) || 24));
    console.log(`[terminal] spawn key=${key} shell=${shellPath} cols=${cols} rows=${rows}`);

    // Real terminal colors: TERM/COLORTERM make git/ls/npm emit ANSI, which
    // xterm.js renders natively — the "original terminal colors".
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      FORCE_COLOR: "1"
    };

    const handle = pty.spawn(shellPath, shellArgs, {
      cwd,
      env,
      cols,
      rows,
      useConpty: os.platform() === "win32"
    });

    const rec = {
      id: key,
      cwd,
      shell: path.basename(shellPath),
      pty: handle,
      pid: handle.pid,
      startedAt: Date.now(),
      lastOutputAt: Date.now(),
      listeners: new Set(),
      exited: false,
      exitCode: null,
      stopRequested: false
    };
    persistentShells.set(key, rec);

    handle.onData((data) => {
      rec.lastOutputAt = Date.now();
      fanOutput(rec, { type: "output", data: base64Encode(data) });
    });

    handle.onExit((e) => {
      rec.exited = true;
      rec.exitCode = e.exitCode;
      const exitFrame = { type: "exit", code: e.exitCode, reason: "pty_exit" };
      for (const ws of [...rec.listeners]) {
        safeSend(ws, exitFrame);
        try {
          ws.close(1000, "pty_exit");
        } catch {
          /* already closed */
        }
      }
      rec.listeners.clear();
      setTimeout(() => {
        if (persistentShells.get(key) === rec) persistentShells.delete(key);
      }, PERSISTENT_SHELL_GC_MS);
    });

    rec.listeners.add(socket);
    wireSocketToRecord(socket, rec, false);
  } finally {
    spawnsInFlight.delete(key);
    release();
  }
}

// Shell switch / folder switch: the client stops the current PTY before
// reopening with the new shellId or cwd — otherwise the registry would
// just reattach to the old shell. The registry keys by cwd too, so this
// stops EVERY shell of this project+terminal slot (all folders).
function stopPersistentShell(projectId, terminalId) {
  const prefix = `${projectId || "default"}\u0000`;
  const suffix = `\u0000${terminalId ?? "main"}`;
  const matches = [...persistentShells.entries()].filter(([key]) => key.startsWith(prefix) && key.endsWith(suffix));
  if (matches.length === 0) return { ok: true, pid: null };

  let pid = null;
  for (const [, rec] of matches) {
    pid = rec.pid;
    console.log(`[terminal] stop key=${rec.id} pid=${pid}`);

    for (const ws of [...rec.listeners]) {
      safeSend(ws, { type: "exit", code: null, reason: "stopped_by_user" });
      try {
        ws.close(1000, "stopped_by_user");
      } catch {
        /* already closed */
      }
    }
    rec.listeners.clear();
    try {
      rec.pty.kill();
    } catch {
      /* already gone */
    }
    rec.exited = true;
    persistentShells.delete(rec.id);
  }
  return { ok: true, pid };
}

// ---------------------------------------------------------------------------
// HTTP + WS wiring
// ---------------------------------------------------------------------------

export function registerTerminal(app, server, opts = {}) {
  const { pairCode = "" } = opts;
  app.get("/api/terminal/shells", (_req, res) => {
    res.json({ ok: true, shells: listShells(), defaultCwd: APP_ROOT });
  });

  app.post("/api/terminal/stop", (req, res) => {
    const body = req.body ?? {};
    res.json(stopPersistentShell(String(body.projectId ?? ""), String(body.terminalId ?? "main")));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/api/terminal/shell") return;
    // WebSocket has no CORS — every website in the user's browser can
    // OPEN this URL. The pairing code is the door: only the page that
    // read it from /pair (CORS-locked to the app's own origins) can.
    // No code configured → open (compat with older frontends).
    if (pairCode && url.searchParams.get("code") !== pairCode) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachShellToSocket(ws, {
        projectId: url.searchParams.get("projectId") || "",
        cwd: url.searchParams.get("cwd") || "",
        shellId: url.searchParams.get("shellId") || "",
        terminalId: url.searchParams.get("terminalId") || "main",
        cols: url.searchParams.get("cols"),
        rows: url.searchParams.get("rows")
      }).catch((error) => {
        safeSend(ws, { type: "error", message: String(error?.message || error) });
        try {
          ws.close(1011, "spawn_failed");
        } catch {
          /* */
        }
      });
    });
  });

  // Runner shutdown must not leave orphan shells behind.
  const sweep = () => {
    for (const rec of persistentShells.values()) {
      rec.stopRequested = true;
      for (const ws of [...rec.listeners]) {
        safeSend(ws, { type: "exit", code: null, reason: "server_shutdown" });
        try {
          ws.close(1000, "server_shutdown");
        } catch {
          /* */
        }
      }
      rec.listeners.clear();
      try {
        rec.pty.kill();
      } catch {
        /* already gone */
      }
    }
    persistentShells.clear();
  };
  process.on("SIGINT", sweep);
  process.on("SIGTERM", sweep);
  process.on("exit", sweep);
}
