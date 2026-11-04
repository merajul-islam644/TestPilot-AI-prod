// Launcher for the `testpilot-runner://` protocol handler (see
// registerProtocolHandler in server.mjs). Windows runs this when the user
// presses "Start server" in the app — so the one command (npm start) is
// only needed the FIRST time, to write the registry entry.
//
// Behavior: if an agent is already serving on the port, do nothing;
// otherwise spawn one fully detached — it must outlive this launcher,
// which exits the moment Windows stops caring about it.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 9090);
const here = path.dirname(fileURLToPath(import.meta.url));

let running = false;
try {
  const res = await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(1500) });
  running = res.ok;
} catch {
  running = false; // nothing on the port — we're the ones who start it
}

if (!running) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: here,
    detached: true, // survives this launcher's exit
    stdio: "ignore", // no parent to log to anyway
    env: process.env
  });
  child.unref();
  // Give the health endpoint a moment before exiting, so the app's 3s
  // liveness probe catches the fresh agent on its very next tick.
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
