// Shared Source Control context -- the repository input and branch the
// SCM view is pointed at. Lives in localStorage (repo + branch are not
// secrets; the token deliberately stays in sessionStorage, see
// github.ts) so the status bar can show the current branch like VS
// Code's status bar without threading new props through Workbench.
// Same-tab subscribers are notified through a window event because the
// DOM "storage" event only fires in OTHER tabs.

const REPO_KEY = "tp-scm-repo";
const BRANCH_KEY = "tp-scm-branch";
const EVENT = "tp-scm-context";

export type ScmContext = { repoInput: string; branch: string };

function readKey(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function readScmContext(): ScmContext {
  return { repoInput: readKey(REPO_KEY), branch: readKey(BRANCH_KEY) };
}

export function writeScmContext(patch: Partial<ScmContext>): void {
  try {
    if (patch.repoInput !== undefined) {
      if (patch.repoInput) localStorage.setItem(REPO_KEY, patch.repoInput);
      else localStorage.removeItem(REPO_KEY);
    }
    if (patch.branch !== undefined) {
      if (patch.branch) localStorage.setItem(BRANCH_KEY, patch.branch);
      else localStorage.removeItem(BRANCH_KEY);
    }
  } catch {
    // Storage may be blocked (private windows); the view keeps its own state.
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Non-browser environment; nothing to notify.
  }
}

/** Subscribe to same-tab context changes; returns the unsubscribe fn. */
export function onScmChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
