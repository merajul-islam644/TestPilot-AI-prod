// The pinned branch bar at the sidebar's foot — the branch section moved
// here out of Source Control so switching, creating and reloading live in
// ONE place, visible from every sidebar view (explorer, search, SCM, run),
// VS Code status-bar style. Hidden by the parent when the folder is not a
// git clone; the picker's popover is position:fixed, so it escapes the
// sidebar's overflow clip just like it did inside SCM.

import { useState } from "react";
import { GitBranch, Plus, RefreshCw, X } from "lucide-react";
import { BranchPicker } from "./BranchPicker";

export function BranchBar({ branches, branchesNote, busy, value, onReload, onCheckout, onCreateBranch }: {
  /** All branches of the clone — locals first, then origin/*. Owned by
   *  the shared useGitBranches hook (one fetch for the whole sidebar). */
  branches: string[];
  /** Non-empty when the branch list failed to load. */
  branchesNote: string;
  /** Saving, opening a folder or a git op in flight — disables the actions. */
  busy: boolean;
  /** The clone's current branch. */
  value: string;
  /** Re-run the branch-list fetch. */
  onReload: () => void;
  /** Switch the clone's branch; the workspace reloads afterwards. */
  onCheckout: (name: string) => Promise<void>;
  /** Create a local branch off HEAD and switch; true when created. */
  onCreateBranch: (name: string) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function create() {
    const trimmed = name.trim();
    // busy covers the in-flight create (the workspace's git op flag).
    if (!trimmed || busy) return;
    const ok = await onCreateBranch(trimmed);
    if (ok) {
      setCreating(false);
      setName("");
    }
  }

  return (
    <>
      {creating ? (
        <div className="wb-scm-branch-create">
          <input
            className="wb-scm-input"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) void create();
            }}
            placeholder="new-branch-name"
            spellCheck={false}
            value={name}
          />
          {/* Primary styling (like Commit) — this IS the form's action —
              plus the branch glyph so the button says what it creates. */}
          <button className="wb-scm-btn primary wb-scm-btn-inline" disabled={busy || !name.trim()} onClick={() => void create()} title="Create the branch and switch to it" type="button">
            <GitBranch size={12} /> {busy ? "Working…" : "Create"}
          </button>
          <button aria-label="Cancel new branch" className="wb-icon-btn" onClick={() => { setCreating(false); setName(""); }} title="Cancel" type="button">
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="wb-sidebar-branch-row">
          <BranchPicker
            branches={branches}
            disabled={busy}
            onChange={(next) => void onCheckout(next)}
            value={value}
          />
          <button aria-label="New branch" className="wb-icon-btn" disabled={busy} onClick={() => setCreating(true)} title="Create a branch and switch to it" type="button">
            <Plus size={13} />
          </button>
          <button aria-label="Reload branch list" className="wb-icon-btn" disabled={busy} onClick={onReload} title="Reload branch list" type="button">
            <RefreshCw size={13} />
          </button>
        </div>
      )}
      {branchesNote ? <p className="wb-scm-note">{branchesNote}</p> : null}
    </>
  );
}
