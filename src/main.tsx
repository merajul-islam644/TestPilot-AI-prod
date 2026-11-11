import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/styles.css";

// One-time cleanup: Source Control now runs LOCAL git through the runner
// (the machine's credential helper, like desktop VS Code) — the old
// GitHub-token and repo-input leftovers must never linger in storage.
try {
  sessionStorage.removeItem("tp-github-pat");
  localStorage.removeItem("tp-scm-repo");
  localStorage.removeItem("tp-scm-branch");
} catch {
  // Storage may be blocked (private windows); nothing to clean there.
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
