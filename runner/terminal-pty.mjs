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

function listShells() {
  return SHELL_CATALOG.map((s) => {
    const resolved = whichSync(s.binary);
    return { id: s.id, label: s.label, available: resolved !== null, resolvedPath: resolved };
  });
}

function resolveShellById(shellId) {
  if (shellId) {
    const entry = SHELL_CATALOG.find((s) => s.id === shellId);
    if (entry) {
      const resolved = whichSync(entry.binary);
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
  const cwd = path.resolve(opts.cwd || APP_ROOT);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`cwd is not a directory: ${cwd}`);
  }

  // Terminals are PROJECT-SCOPED: each project keeps its own shell
  // process and working directory, so two projects never share state.
  const key = `${opts.projectId || "default"}\u0000${opts.terminalId ?? "main"}`;
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

// Shell switch: the client stops the current PTY before reopening with
// the new shellId — otherwise the registry would just reattach to the
// old shell. Also usable as a plain "kill my terminal" endpoint.
function stopPersistentShell(projectId, terminalId) {
  const key = `${projectId || "default"}\u0000${terminalId ?? "main"}`;
  const rec = persistentShells.get(key);
  if (!rec) return { ok: true, pid: null };

  rec.stopRequested = true;
  const pid = rec.pid;
  console.log(`[terminal] stop key=${key} pid=${pid}`);

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
  persistentShells.delete(key);
  return { ok: true, pid };
}

// ---------------------------------------------------------------------------
// HTTP + WS wiring
// ---------------------------------------------------------------------------

export function registerTerminal(app, server) {
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
