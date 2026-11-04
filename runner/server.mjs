import express from "express";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { prepareWorkspace } from "./workspace-prepare.mjs";
import { registerTerminal } from "./terminal-pty.mjs";

// TestPilot AI runner v0.1 -- the piece that actually executes Playwright.
// The SPA cannot run browsers, so it hands spec files to this service over
// HTTP; we materialize a throwaway Playwright project in the OS temp dir,
// run the suite with the JSON reporter, and return a compact, app-shaped
// result set. One run at a time keeps v1 predictable.

const execFileAsync = promisify(execFile);
const RUNNER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT_CLI = path.join(RUNNER_ROOT, "node_modules", "@playwright", "test", "cli.js");
const PORT = Number(process.env.PORT || 9090);
const MAX_FILES = 20;
const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 4_000_000;
const RUN_TIMEOUT_MS = 150_000;

const ALLOWED_ORIGINS = new Set([
  "https://dbycry.slsblx.com:5173",
  "https://localhost:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

let activeRuns = 0;

app.get("/health", (_req, res) => {
  res.json({ ok: true, runner: "testpilot-runner", version: "0.1.0", busy: activeRuns > 0 });
});

// ─────────────────────────────────────────────────────────────────────
//  Workbench folder workspace — VS Code-style "Open Folder" on the
//  user's real disk, the same model the Lattice workspace uses: the
//  editor edits files in place, so there is no upload step, no stored
//  copy and nothing a refresh can lose. Routes mirror Lattice's
//  mcp-server user-folder API (list/read/write/delete/rename/mkdir)
//  with the same guards; every target resolves through
//  safeResolveUserFolder against the picked root.
// ─────────────────────────────────────────────────────────────────────

const FOLDER_MAX_TREE_DEPTH = 8;
const FOLDER_MAX_TREE_ENTRIES = 5_000;
const FOLDER_MAX_WRITE_BYTES = 1_000_000;
const HIDDEN_DIRS = new Set(["node_modules", ".git"]);

function isPlainRoot(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && path.isAbsolute(value);
}

function isRelPath(value) {
  return typeof value === "string" && value.length <= 2048 && !value.includes("\0");
}

// Reject paths that escape `root` via `..` or separator tricks; returns
// the resolved absolute path or null (Lattice devServer.ts:178).
function safeResolveUserFolder(root, target) {
  if (!isRelPath(target) || target.includes("..") || target.includes("\\")) return null;
  const absRoot = path.resolve(root);
  const full = path.resolve(absRoot, target);
  if (!(full === absRoot || full.startsWith(absRoot + path.sep) || full.startsWith(absRoot + "/"))) return null;
  return full;
}

// Recursive walk of the picked folder, directories first, alphabetical,
// hidden dirs skipped, depth/entry capped (Lattice devServer.ts:205).
async function walkTree(root, maxDepth = FOLDER_MAX_TREE_DEPTH) {
  const absRoot = path.resolve(root);
  const rootStat = await stat(absRoot).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) return [];
  const visited = new Set();
  let entryCount = 0;
  async function walk(dir, relBase, depth) {
    if (depth >= maxDepth) return [];
    const real = await realpath(dir).catch(() => dir);
    if (visited.has(real)) return [];
    visited.add(real);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const out = [];
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (entryCount >= FOLDER_MAX_TREE_ENTRIES) break;
      if (entry.isDirectory() && HIDDEN_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      entryCount += 1;
      if (entry.isDirectory()) {
        out.push({ name: entry.name, path: rel, kind: "dir", children: await walk(abs, rel, depth + 1) });
      } else if (entry.isFile()) {
        out.push({ name: entry.name, path: rel, kind: "file" });
      }
    }
    return out;
  }
  return walk(absRoot, "", 0);
}

// Classic OS folder dialog — PowerShell FolderBrowserDialog on Windows,
// osascript on macOS, zenity/kdialog on Linux. On Windows this script is
// the FALLBACK only: the modern Explorer-style picker (WIN_DIALOG_PS +
// wb-dialog.dll below) runs whenever its boot-compiled DLL exists. A
// failed shim answers { cancelled, reason } so the UI shows an error
// toast instead of throwing (Lattice devServer.ts:pickNativeFolder).
const WIN_PICKER_PS = [
  "Add-Type -AssemblyName System.Windows.Forms | Out-Null;",
  "$f = New-Object System.Windows.Forms.FolderBrowserDialog;",
  "$f.Description = 'Select a folder to open in TestPilot';",
  "$f.ShowNewFolderButton = $false;",
  // The picker spawns as a background process behind the maximized
  // browser/editor, and neither an (invisible or even shown) TopMost
  // owner nor plain ownership reliably lifts the dialog into the
  // topmost band on this machine. The only pin that held in testing is
  // SetWindowPos(HWND_TOPMOST) on the dialog window itself — done by
  // the precompiled WbPin helper (WB_PIN_DLL, compiled once at runner
  // boot; NO runtime C# compilation, which under Defender load once
  // took 3-6 minutes). PinAsync polls on a background thread while the
  // modal loop pumps, then pins the dialog the moment it exists.
  "$ow = New-Object System.Windows.Forms.Form;",
  "$ow.TopMost = $true; $ow.ShowInTaskbar = $false; $ow.Size = New-Object System.Drawing.Size(1,1); $ow.Show();",
  "if ($env:WB_PIN_DLL -and (Test-Path -LiteralPath $env:WB_PIN_DLL)) { [Reflection.Assembly]::LoadFrom($env:WB_PIN_DLL) | Out-Null; [WbPin]::PinAsync('Browse For Folder'); }",
  "$r = $f.ShowDialog($ow);",
  "$ow.Dispose();",
  // Result goes to the WB_PICK_OUT temp file, not stdout — the runner
  // keeps stdio ignored on Windows, so nothing can block on a pipe.
  "$out = if ($r -eq [System.Windows.Forms.DialogResult]::OK) { $f.SelectedPath } else { '' };",
  "Set-Content -LiteralPath $env:WB_PICK_OUT -Value $out -Encoding Unicode;"
].join(" ");

// Modern Explorer-style dialog (the Vista+ IFileDialog — the same window
// Chrome and VS Code show for Open/Save). Folder mode sets
// FOS_PICKFOLDERS, file mode behaves as a plain Open File. Like
// wb-pin.dll, the COM interop is compiled ONCE at runner boot
// (wb-dialog.cs → wb-dialog.dll): a pick must never wait on the C#
// compiler (the 06:57 incident), and PowerShell 5.1 only ships the
// ancient FolderBrowserDialog tree, which the user asked to replace.
const DIALOG_CS_SRC = `
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

// IFileDialog wrapper for the workbench picker — all COM interop lives
// here so the PowerShell side stays a five-liner. Pick runs on the
// PowerShell main thread, which the spawn flags make STA (the classic
// FolderBrowserDialog flow proved it on this machine).
public class WbDialog {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialogRCW {}

  // The dialog's vtable, declared in exact slot order (a wrong order
  // corrupts memory). The IID is IFileOpenDialog's, VERIFIED against
  // this machine (the widely-copied "D57B7FA4" snippet GUID is a myth
  // and QIs E_NOINTERFACE): IFileOpenDialog extends IFileDialog, so
  // this IFileDialog method prefix is its vtable prologue — valid.
  [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr hwndOwner);
    [PreserveSig] int SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    [PreserveSig] int SetFileTypeIndex(uint iFileType);
    [PreserveSig] int GetFileTypeIndex(out uint piFileType);
    [PreserveSig] int Advise(IntPtr pfde, out uint pdwCookie);
    [PreserveSig] int Unadvise(uint dwCookie);
    [PreserveSig] int SetOptions(uint dwFOS);
    [PreserveSig] int GetOptions(out uint pdwFOS);
    [PreserveSig] int SetDefaultFolder(IShellItem psi);
    [PreserveSig] int SetFolder(IShellItem psi);
    [PreserveSig] int GetFolder(out IShellItem ppsi);
    [PreserveSig] int GetCurrentSelection(out IShellItem ppsi);
    [PreserveSig] int SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    [PreserveSig] int GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    [PreserveSig] int SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    [PreserveSig] int SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    [PreserveSig] int SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    [PreserveSig] int GetResult(out IShellItem ppsi);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    [PreserveSig] int BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    [PreserveSig] int GetParent(out IShellItem ppsi);
    [PreserveSig] int GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);

  [DllImport("user32.dll")]
  private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr hwnd, [Out] StringBuilder name, int max);
  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr l);
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  private static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")]
  private static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("kernel32.dll")]
  private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  private const uint FOS_PICKFOLDERS = 0x20;
  private const uint FOS_FORCEFILESYSTEM = 0x40;
  private const uint FOS_PATHMUSTEXIST = 0x800;
  private const uint FOS_FILEMUSTEXIST = 0x1000;
  private const uint SIGDN_FILESYSPATH = 0x80058000;

  // Two lifts work together so the dialog appears where the user
  // clicked, not as a taskbar entry behind the browser:
  //   1. FOREGROUND OWNER — a background process cannot activate its
  //      windows, so before Show() this thread ATTACHES its input
  //      queue to the current foreground window's thread
  //      (AttachThreadInput — the classic, legal foreground-lock
  //      bypass), then SetForegroundWindow + BringWindowToTop on the
  //      tiny owner form. Show() places an owned dialog directly
  //      ABOVE its owner, so with the owner now the top window the
  //      dialog opens in front, over the browser, with focus.
  //      (Proven on this machine: an owned dialog whose owner sat
  //      BEHIND the maximized browser opened visibly-but-behind, with
  //      no taskbar button and immune to external topmost
  //      SetWindowPos — the invisible-picker bug. A dialog can also
  //      never leave its owner's z-band, so fixing the OWNER is the
  //      only fix.)
  //   2. THE PIN — only the fallback when there is no foreground
  //      window to attach to: SetWindowPos(HWND_TOPMOST) on the
  //      dialog window, polled from a background thread, only once
  //      the dialog is actually VISIBLE, and without SWP_SHOWWINDOW
  //      (pinning the hidden, half-initialized window broke Show()
  //      once).
  // Diagnostics: what the pin thread actually did, reported verbatim on
  // a pick that never surfaces.
  private static string pinStatus = "n/a";

  private static void Pin() {
    pinStatus = "searching";
    uint pid = (uint)Process.GetCurrentProcess().Id;
    for (int i = 0; i < 100; i++) {
      IntPtr found = IntPtr.Zero;
      EnumWindows(delegate(IntPtr hwnd, IntPtr l) {
        uint windowPid;
        GetWindowThreadProcessId(hwnd, out windowPid);
        if (windowPid != pid) return true;
        StringBuilder name = new StringBuilder(32);
        GetClassName(hwnd, name, 32);
        if (name.ToString() == "#32770" && IsWindowVisible(hwnd)) { found = hwnd; return false; }
        return true;
      }, IntPtr.Zero);
      if (found != IntPtr.Zero) {
        // HWND_TOPMOST(-1), SWP_NOMOVE|SWP_NOSIZE (0x3).
        SetWindowPos(found, (IntPtr)(-1), 0, 0, 0, 0, 0x3);
        pinStatus = "pinned";
        return;
      }
      Thread.Sleep(100);
    }
    pinStatus = "no-dialog-window";
  }

  // The foreground lift: share input state with whoever owns the
  // foreground right now (the user's browser, at click time), then the
  // owner form can legally take foreground + the top of the z-order.
  // Best-effort — any failure just falls back to the pin.
  private static bool LiftOwnerToForeground(IntPtr owner) {
    try {
      IntPtr fg = GetForegroundWindow();
      if (fg == IntPtr.Zero || fg == owner) return false;
      uint fgPid;
      uint fgTid = GetWindowThreadProcessId(fg, out fgPid);
      uint myTid = GetCurrentThreadId();
      if (fgTid == 0 || fgTid == myTid) return false;
      if (!AttachThreadInput(fgTid, myTid, true)) return false;
      SetForegroundWindow(owner);
      BringWindowToTop(owner);
      AttachThreadInput(fgTid, myTid, false);
      return true;
    } catch {
      return false;
    }
  }

  // Diagnostics watchdog: for 20s after Pick starts, append what the
  // background machinery actually sees to WB_PICK_LOG — so a pick that
  // never surfaces leaves a timeline behind, not silence.
  private static void Watch() {
    try {
      string logPath = Environment.GetEnvironmentVariable("WB_PICK_LOG");
      if (string.IsNullOrEmpty(logPath)) return;
      uint pid = (uint)Process.GetCurrentProcess().Id;
      for (int i = 1; i <= 5; i++) {
        Thread.Sleep(4000);
        IntPtr dlg = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr l) {
          uint wpid;
          GetWindowThreadProcessId(hwnd, out wpid);
          if (wpid != pid) return true;
          StringBuilder name = new StringBuilder(32);
          GetClassName(hwnd, name, 32);
          if (name.ToString() == "#32770" && IsWindowVisible(hwnd)) { dlg = hwnd; return false; }
          return true;
        }, IntPtr.Zero);
        string line = DateTime.Now.ToString("HH:mm:ss.fff") + " watch t+" + (i * 4) + "s pin=" + pinStatus +
                      " dialog=" + (dlg == IntPtr.Zero ? "none" : dlg.ToString());
        System.IO.File.AppendAllText(logPath, line + "\\r\\n");
      }
    } catch { /* diagnostics must never break the pick */ }
  }

  // mode "folder" | "file"; returns the picked path, "" on a clean user
  // cancel, or an "ERR:..." diagnostic string on any failure (Show
  // HRESULT + pin outcome + apartment state, or the exception) so the
  // logs show WHY nothing opened instead of a silent no-op.
  public static string Pick(string mode, string title, string startDir, IntPtr owner) {
    try {
      return PickCore(mode, title, startDir, owner);
    } catch (Exception ex) {
      return "ERR:com=" + ex.GetType().Name + ":" + ex.Message;
    }
  }

  private static string PickCore(string mode, string title, string startDir, IntPtr owner) {
    if (mode != "folder") mode = "file";
    bool lifted = LiftOwnerToForeground(owner);
    pinStatus = lifted ? "foreground-owner" : "pin-fallback";
    if (!lifted) Task.Run(() => Pin());
    Task.Run(() => Watch());
    IFileDialog dialog = (IFileDialog)new FileOpenDialogRCW();
    uint options;
    dialog.GetOptions(out options);
    options |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
    if (mode == "folder") options |= FOS_PICKFOLDERS; else options |= FOS_FILEMUSTEXIST;
    dialog.SetOptions(options);
    dialog.SetTitle(title);
    if (!string.IsNullOrEmpty(startDir)) {
      try {
        Guid iid = typeof(IShellItem).GUID;
        IShellItem folder;
        SHCreateItemFromParsingName(startDir, IntPtr.Zero, ref iid, out folder);
        if (folder != null) dialog.SetFolder(folder);
      } catch { /* a vanished start dir is not a failure */ }
    }
    int hr = dialog.Show(owner);
    if (hr != 0) {
      // ERROR_CANCELLED (0x800704C7) = the user closed it — quiet.
      // Anything else is a real failure: report the exact code.
      if (hr != unchecked((int)0x800704C7)) {
        return "ERR:show=0x" + hr.ToString("X8") + " pin=" + pinStatus +
               " apt=" + Thread.CurrentThread.GetApartmentState();
      }
      return "";
    }
    IShellItem item;
    dialog.GetResult(out item);
    if (item == null) return "";
    string path;
    item.GetDisplayName(SIGDN_FILESYSPATH, out path);
    return path ?? "";
  }

  // Boot-time sanity check with NO window: the QI plus the option calls
  // probe the interface layout, and a real shell-item round trip probes
  // the IShellItem side — everything a pick needs except Show() itself.
  public static bool SelfTest() {
    try {
      IFileDialog dialog = (IFileDialog)new FileOpenDialogRCW();
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
      Guid iid = typeof(IShellItem).GUID;
      IShellItem item;
      SHCreateItemFromParsingName(Environment.SystemDirectory, IntPtr.Zero, ref iid, out item);
      if (item == null) return false;
      string name;
      item.GetDisplayName(SIGDN_FILESYSPATH, out name);
      return !string.IsNullOrEmpty(name);
    } catch {
      return false;
    }
  }
}
`;

const WIN_DIALOG_PS = [
  "$ErrorActionPreference = 'Stop';",
  // Every step lands in WB_PICK_LOG (a temp file the runner KEEPS), so
  // a pick that never surfaces leaves the exact reason behind instead
  // of a silent no-op.
  "function L([string]$m) { try { Add-Content -LiteralPath $env:WB_PICK_LOG -Value ((Get-Date -Format 'HH:mm:ss.fff') + ' ' + $m) -Encoding Unicode } catch {} }",
  "L ('start mode=' + $env:WB_PICK_MODE + ' apt=' + [System.Threading.Thread]::CurrentThread.GetApartmentState().ToString());",
  "Add-Type -AssemblyName System.Windows.Forms | Out-Null;",
  // The tiny topmost OWNER form is what lifts the dialog over the
  // maximized browser: an owned dialog activates with its owner chain
  // and stays out of the taskbar (the classic FolderBrowserDialog
  // script's proven recipe).
  "$ow = New-Object System.Windows.Forms.Form;",
  "$ow.TopMost = $true; $ow.ShowInTaskbar = $false; $ow.Size = New-Object System.Drawing.Size(1,1); $ow.Show();",
  "L ('owner=' + $ow.Handle.ToString());",
  "[void][Reflection.Assembly]::LoadFrom($env:WB_DIALOG_DLL);",
  "L 'dll-loaded';",
  // Pick owns the topmost pin (see DIALOG_CS_SRC); the owner handle
  // makes the dialog OWNED so it opens in front, where the user
  // clicked.
  "$r = '';",
  "try { $r = [WbDialog]::Pick($env:WB_PICK_MODE, $env:WB_PICK_TITLE, $env:WB_PICK_START, $ow.Handle); } catch { L ('ps-ex ' + $_.Exception.GetType().Name + ': ' + $_.Exception.Message); }",
  "L ('result=' + $r);",
  "$ow.Dispose();",
  // Result goes to the WB_PICK_OUT temp file, not stdout — the runner
  // keeps stdio ignored on Windows, so nothing can block on a pipe.
  "Set-Content -LiteralPath $env:WB_PICK_OUT -Value $r -Encoding Unicode;",
  "L 'done';"
].join(" ");

// Sources for the WbPin helper — compiled once at boot by the runner so
// a folder pick never waits on the C# compiler (the 06:57 incident).
const PIN_CS_SRC = `
using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
public class WbPin {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")]
  private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  private static void Pin(string title) {
    for (int i = 0; i < 100; i++) {
      IntPtr h = FindWindow(null, title);
      if (h != IntPtr.Zero) {
        // HWND_TOPMOST(-1), SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW (0x43).
        SetWindowPos(h, (IntPtr)(-1), 0, 0, 0, 0, 0x43);
        return;
      }
      System.Threading.Thread.Sleep(100);
    }
  }
  public static void PinAsync(string title) { Task.Run(() => Pin(title)); }
}
`;

// Compile the pin helper at boot (Windows only). Best effort: if csc is
// missing or the compile fails, picks still work — the dialog just may
// open behind the browser until the helper exists.
async function compileWbPin() {
  if (process.platform !== "win32") return;
  const csPath = path.join(RUNNER_ROOT, "wb-pin.cs");
  const dllPath = path.join(RUNNER_ROOT, "wb-pin.dll");
  try {
    await writeFile(csPath, PIN_CS_SRC.trimStart(), "utf8");
    const windir = process.env.WINDIR ?? "C:\\Windows";
    const csc = path.join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    if (!existsSync(csc)) return;
    await new Promise((resolve) => {
      execFile(csc, ["/nologo", "/target:library", "/optimize+", `/out:${dllPath}`, csPath], (error) => {
        if (error) console.warn("[TestPilot] wb-pin.dll compile failed:", String(error));
        resolve();
      });
    });
    if (existsSync(dllPath)) console.log("[TestPilot] wb-pin.dll compiled");
  } catch (error) {
    console.warn("[TestPilot] wb-pin compile setup failed:", String(error));
  }
}
void compileWbPin();

// Compile the modern dialog interop at boot, then run its no-window
// self-test so a broken build says so NOW — not the first time the user
// clicks Open Folder. If anything here fails, picks silently fall back
// to the classic FolderBrowserDialog script.
async function compileWbDialog() {
  if (process.platform !== "win32") return;
  const csPath = path.join(RUNNER_ROOT, "wb-dialog.cs");
  const dllPath = path.join(RUNNER_ROOT, "wb-dialog.dll");
  try {
    await writeFile(csPath, DIALOG_CS_SRC.trimStart(), "utf8");
    const windir = process.env.WINDIR ?? "C:\\Windows";
    const csc = path.join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    if (!existsSync(csc)) {
      console.warn("[TestPilot] csc.exe missing — picks fall back to the classic folder dialog");
      return;
    }
    let compileFailed = false;
    await new Promise((resolve) => {
      execFile(csc, ["/nologo", "/target:library", "/optimize+", `/out:${dllPath}`, csPath], (error) => {
        if (error) {
          compileFailed = true;
          console.warn("[TestPilot] wb-dialog.dll compile failed:", String(error));
        }
        resolve();
      });
    });
    if (!existsSync(dllPath)) return;
    console.log(compileFailed
      ? "[TestPilot] wb-dialog.dll STALE — compile failed (a stuck picker process may still hold the file lock)"
      : "[TestPilot] wb-dialog.dll compiled");
    const selfTest =
      "[void][Reflection.Assembly]::LoadFrom('" + dllPath.replace(/'/g, "''") + "'); " +
      "if ([WbDialog]::SelfTest()) { 'OK' } else { 'FAIL' }";
    await new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", selfTest], (error, stdout) => {
        if (error || String(stdout).trim() !== "OK") console.warn("[TestPilot] wb-dialog self-test failed — classic dialog will be used");
        else console.log("[TestPilot] wb-dialog self-test OK");
        resolve();
      });
    });
  } catch (error) {
    console.warn("[TestPilot] wb-dialog compile setup failed:", String(error));
  }
}
void compileWbDialog();

// The in-flight dialog child, if any. Each new pick request kills the
// previous one — a stale hidden dialog must never pile up (the tab can
// only show one picker, so the newest click is the user's intent).
let activePicker = null;

// Where the last successful pick happened — the next dialog starts
// there (VS Code remembers its last folder the same way). In-memory
// only: a runner restart simply forgets it.
let lastPickDir = null;

// kind "folder" (workspace root) | "file" (open one file).
async function pickNative(kind) {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  if (activePicker) {
    try { activePicker.kill(); } catch { /* already gone */ }
    activePicker = null;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let cmd;
    let args;
    const dialogDll = path.join(RUNNER_ROOT, "wb-dialog.dll");
    const useModern = isWin && existsSync(dialogDll);
    const title = kind === "folder" ? "Open Folder - TestPilot" : "Open File - TestPilot";
    if (isWin) {
      cmd = "powershell.exe";
      args = [
        "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
        useModern ? WIN_DIALOG_PS : WIN_PICKER_PS
      ];
    } else if (isMac) {
      cmd = "osascript";
      args = kind === "folder"
        ? ["-e", 'set chosenFolder to choose folder with prompt "Select a folder to open in TestPilot"\nPOSIX path of chosenFolder']
        : ["-e", 'set chosenFile to choose file with prompt "Select a file to open in TestPilot"\nPOSIX path of chosenFile'];
    } else {
      cmd = "zenity";
      args = kind === "folder"
        ? ["--file-selection", "--directory", "--title=Open Folder in TestPilot"]
        : ["--file-selection", "--title=Open File in TestPilot"];
    }
    // Windows: stdio fully ignored, the picked path comes back through
    // the WB_PICK_OUT temp file — an unread stdout/stderr pipe can fill
    // and freeze the child mid-dialog. macOS/Linux keep stdout pipes.
    const outPath = isWin ? path.join(os.tmpdir(), `wb-pick-${Date.now()}.out`) : null;
    let child;
    try {
      const env = { ...process.env };
      if (outPath) env.WB_PICK_OUT = outPath;
      const pinDll = path.join(RUNNER_ROOT, "wb-pin.dll");
      if (isWin && existsSync(pinDll)) env.WB_PIN_DLL = pinDll;
      if (useModern) {
        env.WB_DIALOG_DLL = dialogDll;
        env.WB_PICK_MODE = kind;
        env.WB_PICK_TITLE = title;
        env.WB_PICK_START = lastPickDir ?? "";
        // Persistent diagnostic log — survives the pick, never unlinked.
        env.WB_PICK_LOG = path.join(os.tmpdir(), "wb-dialog-debug.log");
      }
      child = spawn(cmd, args, {
        stdio: isWin ? "ignore" : ["ignore", "pipe", "pipe"],
        env
      });
    } catch {
      finish({ picked: null, reason: "spawn_failed" });
      return;
    }
    activePicker = child;
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", () => {
      if (!isWin && !isMac) {
        const kd = spawn("kdialog", ["--getopenfilename", "."], { stdio: ["ignore", "pipe", "pipe"] });
        let kdOut = "";
        let kdSettled = false;
        kd.stdout?.on("data", (chunk) => { kdOut += chunk.toString("utf8"); });
        kd.on("error", () => { if (!kdSettled) { kdSettled = true; finish({ picked: null, reason: "no_gui" }); } });
        kd.on("close", (code) => {
          if (kdSettled) return;
          kdSettled = true;
          finish(code === 0 && kdOut.trim().length > 0 ? { picked: kdOut.trim() } : { picked: null, reason: code === 0 ? "cancelled" : "no_gui" });
        });
      } else {
        finish({ picked: null, reason: "spawn_failed" });
      }
    });
    child.on("close", async (code) => {
      if (activePicker === child) activePicker = null;
      if (settled) return;
      if (isWin) {
        // Set-Content -Encoding Unicode writes UTF-16LE with a BOM.
        const text = await readFile(outPath, "utf16le").catch(() => null);
        unlink(outPath).catch(() => { /* already gone */ });
        const picked = text ? text.replace(/^﻿/, "").trim() : "";
        if (picked.startsWith("ERR:")) {
          // A real dialog failure, not a user cancel — keep it loud in
          // the runner log (the browser side still no-ops silently).
          console.warn("[TestPilot] picker failed:", picked);
          finish({ picked: null, reason: "cancelled" });
        } else if (picked.length > 0) {
          lastPickDir = path.dirname(picked);
          finish({ picked });
        } else finish({ picked: null, reason: "cancelled" });
        return;
      }
      const out = stdout.trim();
      if (code === 0 && out.length > 0) {
        lastPickDir = path.dirname(out);
        finish({ picked: out });
      } else finish({ picked: null, reason: code === 0 ? "cancelled" : "no_gui" });
    });
  });
}

app.post("/api/workbench/pick-folder", async (_req, res) => {
  const result = await pickNative("folder");
  if (result.picked) {
    res.json({ path: result.picked });
    return;
  }
  res.json({ cancelled: true, reason: result.reason ?? "cancelled" });
});

// Pick ONE file: the response adds its folder + a workspace-relative
// path (forward slashes, matching the tree) so the client opens the
// file's folder as the root and reveals the file with no path surgery
// in the browser.
app.post("/api/workbench/pick-file", async (_req, res) => {
  const result = await pickNative("file");
  if (result.picked) {
    const folder = path.dirname(result.picked);
    const rel = path.relative(folder, result.picked).split(path.sep).join("/");
    res.json({ path: result.picked, folder, rel });
    return;
  }
  res.json({ cancelled: true, reason: result.reason ?? "cancelled" });
});

app.post("/api/workbench/list", async (req, res) => {
  const root = req.body?.root;
  if (!isPlainRoot(root)) {
    res.status(400).json({ error: "root must be an absolute path" });
    return;
  }
  const maxDepth = Number.isInteger(req.body?.maxDepth) ? Math.min(Math.max(req.body.maxDepth, 1), 16) : undefined;
  try {
    const rootStat = await stat(path.resolve(root)).catch(() => null);
    if (!rootStat || !rootStat.isDirectory()) {
      // `exists: false` — the client must NOT store this path as a
      // workspace root (Lattice inspect-package contract).
      res.json({ tree: [], exists: false });
      return;
    }
    const tree = await walkTree(root, maxDepth);
    res.json({ tree, exists: true });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

// Content search behind the Search sidebar. The SPA no longer holds every
// file's text (lazy per-tab reads), so the scan lives here: walk the same
// guarded tree as /list, skip the same junk (build dirs, binaries, secrets)
// plus oversize files, scan line-by-line case-insensitively. Hard caps keep
// a pathological workspace from flooding the response.
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_MAX_FILES_SCANNED = 800;
const SEARCH_MAX_LINES_PER_FILE = 20;
const SEARCH_MAX_TOTAL_LINES = 600;
const SEARCH_SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "build", "out", ".next", ".nuxt",
  ".output", ".cache", ".parcel-cache", ".turbo", "coverage", ".nyc_output",
  "venv", ".venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache",
  ".idea", ".vscode", "vendor", "target", "obj", ".gradle", ".terraform",
  ".serverless", "tmp", "temp", "logs", ".angular", ".svelte-kit",
  "test-results", "playwright-report"
]);
const SEARCH_BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tif", "tiff",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp4", "webm", "mov", "avi", "mkv", "mp3", "wav", "ogg", "flac",
  "zip", "gz", "tgz", "rar", "7z", "tar", "bz2", "xz",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "exe", "dll", "so", "dylib", "bin", "dat", "iso", "dmg", "msi", "appimage",
  "jar", "class", "pyc", "pyd", "wasm", "db", "sqlite", "sqlite3", "pdb", "node"
]);
const SEARCH_SECRET_RES = [
  /^\.env/i,
  /\.(pem|p12|pfx|key)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)/i,
  /(^|\/)(credentials|secrets?)\./i,
  /\.npmrc$/i,
  /serviceaccount[^/]*\.json$/i
];

app.post("/api/workbench/search", async (req, res) => {
  const root = req.body?.root;
  const query = typeof req.body?.query === "string" ? req.body.query.trim().toLowerCase() : "";
  if (!isPlainRoot(root)) {
    res.status(400).json({ error: "root must be an absolute path" });
    return;
  }
  if (query.length < 2) {
    res.json({ results: [], truncated: false });
    return;
  }
  try {
    const rootStat = await stat(path.resolve(root)).catch(() => null);
    if (!rootStat || !rootStat.isDirectory()) {
      res.json({ results: [], truncated: false, exists: false });
      return;
    }
    const tree = await walkTree(root);
    const files = [];
    const flatten = (nodes) => {
      for (const node of nodes) {
        if (node.kind === "dir") flatten(node.children ?? []);
        else files.push(node.path);
      }
    };
    flatten(tree);
    const results = [];
    let scanned = 0;
    let totalLines = 0;
    let truncated = false;
    for (const rel of files) {
      if (scanned >= SEARCH_MAX_FILES_SCANNED || totalLines >= SEARCH_MAX_TOTAL_LINES) {
        truncated = true;
        break;
      }
      const segments = rel.split("/");
      if (segments.some((segment) => SEARCH_SKIP_DIRS.has(segment))) continue;
      const base = segments[segments.length - 1].toLowerCase();
      if (SEARCH_SECRET_RES.some((pattern) => pattern.test(base))) continue;
      const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
      if (SEARCH_BINARY_EXT.has(ext)) continue;
      const abs = safeResolveUserFolder(root, rel);
      if (!abs) continue;
      const fileStat = await stat(abs).catch(() => null);
      if (!fileStat || !fileStat.isFile() || fileStat.size > SEARCH_MAX_FILE_BYTES) continue;
      const text = await readFile(abs, "utf8").catch(() => null);
      if (text === null || text.includes("\u0000")) continue; // binary
      scanned += 1;
      const textLines = text.split("\n");
      const lines = [];
      for (let index = 0; index < textLines.length; index++) {
        if (textLines[index].toLowerCase().indexOf(query) === -1) continue;
        totalLines += 1;
        if (lines.length < SEARCH_MAX_LINES_PER_FILE && totalLines <= SEARCH_MAX_TOTAL_LINES) {
          lines.push({ number: index + 1, text: (textLines[index] ?? "").slice(0, 300) });
        }
        if (totalLines >= SEARCH_MAX_TOTAL_LINES) {
          truncated = true;
          break;
        }
      }
      if (lines.length > 0) results.push({ path: rel, lines });
    }
    res.json({ results, truncated });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

app.post("/api/workbench/read", async (req, res) => {
  const { root, path: target } = req.body ?? {};
  if (!isPlainRoot(root) || !isRelPath(target) || target.length === 0) {
    res.status(400).json({ error: "root and path are required" });
    return;
  }
  const safe = safeResolveUserFolder(root, target);
  if (!safe) {
    res.status(403).json({ error: "bad path" });
    return;
  }
  try {
    const content = await readFile(safe, "utf8");
    res.json({ content });
  } catch (error) {
    if (error?.code === "ENOENT") {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(500).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

app.post("/api/workbench/write", async (req, res) => {
  const { root, path: target, content } = req.body ?? {};
  if (!isPlainRoot(root) || !isRelPath(target) || target.length === 0 || typeof content !== "string") {
    res.status(400).json({ error: "root, path and content are required" });
    return;
  }
  if (Buffer.byteLength(content, "utf8") > FOLDER_MAX_WRITE_BYTES) {
    res.status(400).json({ error: `content too large (max ${FOLDER_MAX_WRITE_BYTES} bytes)` });
    return;
  }
  const safe = safeResolveUserFolder(root, target);
  if (!safe) {
    res.status(403).json({ error: "bad path" });
    return;
  }
  try {
    await mkdir(path.dirname(safe), { recursive: true });
    await writeFile(safe, content, "utf8");
    res.json({ ok: true, size: content.length });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

app.post("/api/workbench/delete", async (req, res) => {
  const { root, path: target } = req.body ?? {};
  if (!isPlainRoot(root) || !isRelPath(target) || target.length === 0) {
    res.status(400).json({ error: "root and path are required" });
    return;
  }
  const safe = safeResolveUserFolder(root, target);
  if (!safe) {
    res.status(403).json({ error: "bad path" });
    return;
  }
  try {
    const targetStat = await stat(safe).catch(() => null);
    if (!targetStat) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (targetStat.isDirectory()) await rm(safe, { recursive: true, force: false });
    else await unlink(safe);
    res.json({ ok: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(500).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

app.post("/api/workbench/rename", async (req, res) => {
  const { root, oldPath, newPath } = req.body ?? {};
  if (!isPlainRoot(root) || !isRelPath(oldPath) || oldPath.length === 0 || !isRelPath(newPath) || newPath.length === 0) {
    res.status(400).json({ error: "root, oldPath and newPath are required" });
    return;
  }
  const safeOld = safeResolveUserFolder(root, oldPath);
  const safeNew = safeResolveUserFolder(root, newPath);
  if (!safeOld || !safeNew) {
    res.status(403).json({ error: "bad path" });
    return;
  }
  try {
    const exists = await stat(safeNew).catch(() => null);
    if (exists) {
      res.status(409).json({ error: "destination exists" });
      return;
    }
    await mkdir(path.dirname(safeNew), { recursive: true });
    await rename(safeOld, safeNew);
    res.json({ ok: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(500).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

app.post("/api/workbench/mkdir", async (req, res) => {
  const { root, path: target } = req.body ?? {};
  if (!isPlainRoot(root) || !isRelPath(target) || target.length === 0) {
    res.status(400).json({ error: "root and path are required" });
    return;
  }
  const safe = safeResolveUserFolder(root, target);
  if (!safe) {
    res.status(403).json({ error: "bad path" });
    return;
  }
  try {
    await mkdir(safe, { recursive: true });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

// Workspace file paths must stay inside the throwaway project: forward
// slashes only, no drive letters, no backslashes, no empty/"."/".."
// segments. Only spec-shaped files get executed (Playwright's default
// testMatch); the rest exist as import targets so specs can pull in
// workspace helpers via relative imports.
const WORKSPACE_PATH = /^[\w.-]+(\/[\w.-]+)*$/;
function validWorkspacePath(name) {
  if (typeof name !== "string" || name.includes("\\") || !WORKSPACE_PATH.test(name)) return false;
  return name.split("/").every((segment) => segment !== "." && segment !== "..");
}

app.post("/run", async (req, res) => {
  if (activeRuns > 0) {
    res.status(409).json({ ok: false, error: "A run is already in progress" });
    return;
  }
  const body = req.body ?? {};
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) {
    res.status(400).json({ ok: false, error: "files[] is required (at least one spec)" });
    return;
  }
  if (files.length > MAX_FILES) {
    res.status(400).json({ ok: false, error: `Too many files (max ${MAX_FILES})` });
    return;
  }
  let totalBytes = 0;
  for (const file of files) {
    if (!validWorkspacePath(file?.name)) {
      res.status(400).json({ ok: false, error: `Invalid workspace path: ${String(file?.name).slice(0, 80)}` });
      return;
    }
    if (typeof file?.content !== "string" || file.content.length === 0) {
      res.status(400).json({ ok: false, error: `Empty spec content: ${file.name}` });
      return;
    }
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      res.status(400).json({ ok: false, error: `Spec too large (max ${MAX_FILE_BYTES} bytes): ${file.name}` });
      return;
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      res.status(400).json({ ok: false, error: `Specs too large in total (max ${MAX_TOTAL_BYTES} bytes)` });
      return;
    }
  }

  activeRuns += 1;
  const startedAt = Date.now();
  // Temp project lives UNDER the runner root so spec imports of
  // "@playwright/test" resolve up the tree to runner/node_modules (an OS
  // temp dir has no parent node_modules and every import fails).
  const runsRoot = path.join(RUNNER_ROOT, ".runs");
  await mkdir(runsRoot, { recursive: true });
  const dir = await mkdtemp(path.join(runsRoot, "run-"));
  try {
    const baseURL = typeof body.baseURL === "string" && body.baseURL.length > 0 ? body.baseURL : "https://example.com";
    await writeFile(path.join(dir, "playwright.config.mjs"), buildConfig(baseURL), "utf8");
    // Write with folder structure preserved, then make native-ESM imports
    // resolvable: compile TS helpers to sibling .mjs files and rewrite
    // relative import specifiers to exact paths (see workspace-prepare.mjs).
    for (const file of files) {
      const target = path.join(dir, ...file.name.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    await prepareWorkspace(dir, files.map((file) => file.name));

    let cliError = "";
    try {
      // The bundled CLI (node_modules/@playwright/test/cli.js) avoids the
      // npx/.cmd dance on Windows. Non-zero exit just means failed tests --
      // the JSON report is still written and parsed below.
      await execFileAsync(process.execPath, [PLAYWRIGHT_CLI, "test", "--workers=2"], {
        cwd: dir,
        timeout: RUN_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, CI: "1" }
      });
    } catch (error) {
      cliError = String(error.stderr || error.message || "").slice(-4000);
    }

    const reportPath = path.join(dir, "report.json");
    const report = existsSync(reportPath) ? JSON.parse(await readFile(reportPath, "utf8")) : null;
    if (!report) {
      res.status(500).json({ ok: false, error: "Playwright produced no report", stderr: cliError });
      return;
    }

    const cases = collectCases(report.suites ?? []);
    if (cases.length === 0 && (report.errors?.length ?? 0) > 0) {
      // Playwright itself failed (bad import, syntax error) -- never answer
      // a silent "0 tests" when we know the suite did not even load.
      const detail = report.errors.map((e) => e.message).filter(Boolean).join("\n").slice(0, 4000);
      res.status(422).json({ ok: false, error: "Playwright could not load the specs", detail, stderr: cliError });
      return;
    }
    const summary = {
      total: cases.length,
      passed: cases.filter((c) => c.status === "passed").length,
      failed: cases.filter((c) => c.status === "failed").length,
      skipped: cases.filter((c) => c.status === "skipped").length,
      durationMs: Date.now() - startedAt
    };
    res.json({ ok: true, name: body.name ?? "Playwright run", summary, cases });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error).slice(0, 2000) });
  } finally {
    activeRuns -= 1;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function buildConfig(baseURL) {
  return `export default {
  testDir: ".",
  timeout: 30000,
  workers: 2,
  fullyParallel: true,
  use: {
    baseURL: ${JSON.stringify(baseURL)},
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "off"
  },
  reporter: [["json", { outputFile: "report.json" }]]
};
`;
}

// Playwright's JSON report nests suites inside suites; flatten every spec's
// first test result into the shape the app's Run/CaseResult UI already uses.
function collectCases(suites) {
  const cases = [];
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      const test = spec.tests?.[0];
      const result = test?.results?.[0];
      const status = result?.status === "timedOut" ? "failed" : result?.status ?? "failed";
      const error =
        result?.error?.message ??
        result?.errors?.map((e) => e.message).filter(Boolean).join("\n") ??
        (status === "passed" ? undefined : "Test failed (no error text reported)");
      cases.push({
        title: spec.title,
        file: spec.file,
        status,
        durationMs: Math.round(result?.duration ?? 0),
        error: error ? String(error).slice(0, 4000) : undefined
      });
    }
    if (suite.suites?.length) cases.push(...collectCases(suite.suites));
  }
  return cases;
}

const server = app.listen(PORT, () => {
  console.log(`[testpilot-runner] listening on http://localhost:${PORT}`);
});

// Terminal panel: a real PTY (node-pty) streamed to xterm.js over the
// /api/terminal/shell WebSocket — see terminal-pty.mjs.
registerTerminal(app, server);

