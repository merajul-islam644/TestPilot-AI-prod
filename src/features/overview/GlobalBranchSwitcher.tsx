// Global branch control + batch test runs for the Overview page — one
// section that shows EVERY project's open runner-mode folder as its own
// card, realigns branches from a single picker, and runs every project's
// Playwright suite in one go with live per-card progress.
//
// Cards (one per DISTINCT folder root):
//   • name = the PROJECT name (folder leaves are always "e2e"/"playwright",
//     so they can't tell cards apart) — the disk path stays in the tooltip.
//   • branch pill: same (muted) / diverged (outlined primary) / not a repo
//     (red) vs. the picker's current value.
//   • during a batch run each card animates its own striped progress bar
//     with live %, passed/failed counts from the runner's 2 s polling, and
//     a pulse; the most recent FINISHED run shows permanently (status
//     word + counts) — results never vanish when a run ends or reloads.
//   • a live run gets a card-level cancel; a queued card gets a skip;
//     non-local cards (bound by another browser) can't dispatch here.
//
// Batch runs queue instead of firing in parallel: the runner executes a
// single suite at a time, so projects run one after another and each
// folder is enumerated + dispatched only when its turn comes — the specs
// it reads are always the branch's CURRENT content. Runs target the
// folder's first project (two projects sharing one clone would just
// duplicate the same suite). Only folders opened on THIS machine can
// dispatch.
//
// The queue lives in a MODULE-level store persisted to sessionStorage,
// and the dispatch loop RESUMES itself: navigating away unmounts the
// Overview component and a full reload wipes JS memory, but in both
// cases the next mount finds the persisted queue and restarts the loop —
// waiting out the run that was in flight when the page died, then
// dispatching the still-queued folders. Interrupted runs are never
// re-dispatched (their adopted records show the real outcome); only
// never-started folders continue.
//
// The workbench's per-project switcher stays authoritative for its own
// clone; collisions with it are handled by: one checkout per distinct
// root, a confirm dialog listing every current → target move, per-root
// partial failure (a refusing folder fails alone, the rest still move),
// and never switching browser-local (FSA) or unbound workspaces.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CircleCheck, CircleSlash, CircleX, Clock, GitBranch, Loader2, Play, RefreshCw, Square, X } from "lucide-react";
import { toast } from "sonner";
import "../workbench/workbench.css"; // the BranchPicker's .wb-branch-* styles live there
import { BranchPicker } from "../workbench/components/BranchPicker";
import { DEFAULT_BASE_URL, readSavedRoot, readSavedSettings } from "../workbench/data/useTestWorkspace";
import { cancelRun, loadWorkspaceSettings, runPlaywrightTests, useActiveRunnerRun, useDemoState } from "../../lib/demo/store";
import { projects } from "../../lib/demo/data";
import { runTrigger } from "../../lib/demo/data";
import type { Run } from "../../lib/demo/data";
import { localFolder } from "../../lib/workspace/localFolder";
import type { FolderNode } from "../../lib/workspace/localFolder";
import { collectImportedHelpers, isRunnableSpecPath, pathSkipReason, workbenchPathFilter } from "../../lib/workspace/importFiles";
import { RUNNER_MAX_FILES, runnerBusy } from "../../lib/runner/client";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { getDefaultEnvironment } from "../../shared/useWorkspaceName";
import { formatRelative } from "../../lib/format";

type RootGroup = {
  root: string;
  /** True when THIS browser saved the root (dispatch is possible); false
   *  when it came from a gateway binding published by another browser. */
  local: boolean;
  projects: { id: string; name: string }[];
  /** Current HEAD of this clone, null when the folder is not a git repo. */
  branch: string | null;
  branches: string[];
  note: string;
};

type CardRunState = "queued" | "running" | "passed" | "failed" | "cancelled";
type CardRun = { state: CardRunState; detail?: string; at?: number };
type BatchQueue = { done: number; current: string; total: number };
/** Everything the dispatch loop needs per folder — persisted so a reload
 *  can resume the queue without the component that started it. */
type BatchCandidate = { root: string; leadId: string; label: string };
type BatchState = {
  queue: BatchQueue | null;
  runStates: Record<string, CardRun>;
  candidates: BatchCandidate[];
  /** When the current batch started. Cards only show finished runs from
   *  at or after this moment — starting a batch wipes every card's
   *  previous result, and the display refills from THIS run alone. */
  startedAt: number | null;
};

// ---------------------------------------------------------------------------
// Module-level batch store — survives Overview unmount/remount AND a full
// reload (sessionStorage). Restored before first render so a remounting
// component sees the queue immediately.
// ---------------------------------------------------------------------------
const BATCH_KEY = "tp.overview.batch";
let batchState: BatchState = { queue: null, runStates: {}, candidates: [], startedAt: null };
try {
  const raw = sessionStorage.getItem(BATCH_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as BatchState;
    if (parsed && typeof parsed === "object" && typeof parsed.runStates === "object") {
      batchState = { queue: parsed.queue ?? null, runStates: parsed.runStates, candidates: parsed.candidates ?? [], startedAt: parsed.startedAt ?? null };
    }
  }
} catch {
  // Corrupt or unavailable storage — start clean.
}

const batchStop = { stop: false, skip: new Set<string>() };
/** True while a dispatch loop is executing in THIS page. A mount finds
 *  queue set + flag false only after a reload — that's the resume case. */
let batchLoopRunning = false;
const batchListeners = new Set<() => void>();

function persistBatch(): void {
  try {
    sessionStorage.setItem(BATCH_KEY, JSON.stringify(batchState));
  } catch {
    // Storage full/blocked — the in-memory store still drives this page.
  }
}

function patchBatch(patch: Partial<BatchState>): void {
  batchState = { ...batchState, ...patch };
  persistBatch();
  for (const listener of batchListeners) listener();
}

/** Set or clear one card's batch state (null clears). */
function setCardRun(root: string, card: CardRun | null): void {
  const runStates = { ...batchState.runStates };
  if (card) runStates[root] = card;
  else delete runStates[root];
  patchBatch({ runStates });
}

function subscribeBatch(listener: () => void): () => void {
  batchListeners.add(listener);
  return () => batchListeners.delete(listener);
}

function useBatch(): { queue: BatchQueue | null; runStates: Record<string, CardRun>; startedAt: number | null } {
  return useSyncExternalStore(subscribeBatch, () => batchState);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The runner refuses files over its per-file cap (mirrors NewRunModal
 *  and the project page's direct dispatch). */
const RUNNER_FILE_CAP = 200_000;

// Labels show the PROJECT name, never the folder's leaf: the workbench
// folder scope means every open folder is named "e2e"/"playwright"/…, so
// folder names can't tell groups apart. Multiple projects on one folder
// collapse to "Name +2"; the full list stays in the card tooltip.
const groupLabel = (group: RootGroup) => {
  const first = group.projects[0];
  if (!first) return "?";
  return group.projects.length === 1 ? first.name : `${first.name} +${group.projects.length - 1}`;
};

const walkFiles = (nodes: FolderNode[]): string[] =>
  nodes.flatMap((node) => (node.kind === "dir" && node.children ? walkFiles(node.children) : [node.path]));

const leadId = (group: RootGroup) => group.projects[0]?.id ?? null;

/** The live runner run for a card's project, if one is executing now.
 *  Runs arrive newest-first, so the first hit is the current one. Trigger
 *  resolves through runTrigger(): gateway-loaded rows (every post-reload
 *  read) carry no trigger field — reading it directly never matched, and
 *  the cards rendered blank mid-run after a refresh. */
function liveRunOf(runs: Run[], group: RootGroup): Run | null {
  const id = leadId(group);
  if (!id) return null;
  return runs.find((run) => run.projectId === id && runTrigger(run) === "runner" && run.status === "running") ?? null;
}

function lastRunOf(runs: Run[], group: RootGroup, since?: number | null): Run | null {
  const id = leadId(group);
  if (!id) return null;
  return [...runs].sort((a, b) => b.startedAt - a.startedAt)
    .find((run) => run.projectId === id
      && (run.status === "passed" || run.status === "failed" || run.status === "cancelled")
      && (since == null || run.startedAt >= since)) ?? null;
}

/** Percent for the live bar: the runner's own % when it has a total,
 *  otherwise derived from finished tests. */
const progressPct = (run: Run) =>
  run.progress ?? (run.total > 0 ? Math.min(99, Math.round(((run.passed + run.failed) / run.total) * 100)) : 0);

/** Waits until the runner has no suite executing — the suite that was in
 *  flight when a page reload happened must finish (or die with a runner
 *  restart) before the next dispatch.
 *  Unreachable is NEVER idle: a restarting runner answers null, and the
 *  old null-as-idle read dispatched straight into the void — every card
 *  then wore a red "Failed to fetch". Instead the loop keeps polling so
 *  the queue self-resumes when the runner comes back (a restart takes
 *  seconds), and gives up honestly after ~10 min down / ~50 min busy. */
async function waitForRunnerIdle(): Promise<"idle" | "busy" | "unreachable"> {
  const busyLimit = 50 * 60_000; // just past the runner's own 45-min run leash
  const downLimit = 10 * 60_000; // restarting runner — resume if it returns
  const startedAt = Date.now();
  let downSince: number | null = null;
  for (;;) {
    let busy: boolean | null;
    try {
      busy = await runnerBusy();
    } catch {
      busy = null;
    }
    if (busy === false) return "idle";
    const now = Date.now();
    if (busy === null) {
      if (downSince === null) downSince = now;
      if (now - downSince >= downLimit) return "unreachable";
    } else {
      downSince = null; // a busy answer proves the runner is back
      if (now - startedAt >= busyLimit) return "busy";
    }
    await wait(2_000);
  }
}

/** Enumerates + dispatches ONE folder's suite and settles its card state.
 *  Shared by the live batch loop and the post-reload resume loop. */
async function dispatchCandidate(candidate: BatchCandidate): Promise<{ ok: boolean; detail: string }> {
  setCardRun(candidate.root, { state: "running" });
  try {
    // Specs are enumerated FRESH from the folder (same filters the
    // editor applies), so each queued project reads its branch's
    // current content — not a registry snapshot from open time.
    const root = candidate.root;
    const { tree } = await localFolder.listTree({ root });
    const specPaths = workbenchPathFilter(walkFiles(tree))
      .filter((path) => pathSkipReason(path) === null && isRunnableSpecPath(path));
    const selected = specPaths.slice(0, RUNNER_MAX_FILES);
    const files: { name: string; content: string }[] = [];
    for (const path of selected) {
      const content = await localFolder.readUserFile({ root, path });
      if (content !== null) files.push({ name: path, content });
    }
    // Specs share the file budget with the helpers they import — the
    // same import-following dispatch the project page sends, so a
    // spec's "../../support/test-base" resolves inside the sandbox.
    const helperBudget = Math.max(0, RUNNER_MAX_FILES - files.length);
    if (helperBudget > 0) {
      const helperPaths = await collectImportedHelpers({
        specPaths: selected,
        knownPaths: walkFiles(tree),
        budget: helperBudget,
        read: (path) => localFolder.readUserFile({ root, path })
      });
      for (const path of helperPaths) {
        const content = await localFolder.readUserFile({ root, path });
        if (content && content.length > 0 && content.length <= RUNNER_FILE_CAP) files.push({ name: path, content });
      }
    }
    const sendable = files.filter((file) => file.content.length <= RUNNER_FILE_CAP);
    if (sendable.length === 0) {
      setCardRun(candidate.root, { state: "failed", detail: "no runnable specs found" });
      return { ok: false, detail: "no runnable specs found" };
    }
    const baseURL = readSavedSettings(candidate.leadId)?.baseURL || DEFAULT_BASE_URL;
    // A card-level cancel has two shapes: one landing before the dispatch
    // finishes resolves with status "cancelled"; one landing while the POST
    // is in flight makes the runner reject it with its own "Run cancelled"
    // error — handled in the catch below. Both just drop the card's batch
    // state and let the queue move on; only Stop kills the whole queue.
    const send = (): ReturnType<typeof runPlaywrightTests> => runPlaywrightTests({
      projectId: candidate.leadId,
      environment: getDefaultEnvironment(),
      baseURL,
      root,
      files: sendable
    });
    let outcome;
    try {
      outcome = await send();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A cancel pressed while the POST is in flight reaches here as the
      // runner's own "Run cancelled" rejection. The store already parked the
      // record and stayed quiet — a cancel is not a failure, so the card
      // falls back to its cancelled record instead of wearing a red error
      // (same policy as the workbench console's cancel branch).
      if (/\bcancel/i.test(message)) {
        setCardRun(candidate.root, null);
        return { ok: false, detail: "cancelled" };
      }
      // A connection-refused POST never reached the runner — no suite
      // started, so one clean retry after a short gap is safe. A run that
      // DID start answers with the runner's own JSON error instead and is
      // never retried (a blind second POST would just collide with it).
      if (!/failed to fetch/i.test(message)) throw error;
      await wait(5_000);
      if (await waitForRunnerIdle() !== "idle") throw error;
      outcome = await send();
    }
    if (outcome.run.status === "cancelled") {
      setCardRun(candidate.root, null);
      return { ok: false, detail: "cancelled" };
    }
    if (outcome.run.status === "passed") {
      setCardRun(candidate.root, { state: "passed" });
      return { ok: true, detail: "" };
    }
    setCardRun(candidate.root, { state: "failed", detail: "run failed — see the Runs page" });
    return { ok: false, detail: "run failed" };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // "Failed to fetch" = the runner never answered — say what to do about
    // it instead of showing a bare transport error on the card.
    const detail = /failed to fetch/i.test(raw)
      ? `Runner is unreachable — start the runner, then press ▶ on this card (${raw.slice(0, 80)})`
      : raw.slice(0, 160);
    setCardRun(candidate.root, { state: "failed", detail });
    return { ok: false, detail };
  }
}

/** Shared end-of-queue: settle transient card states, then summarize.
 *  Queued cards that never got their turn are marked cancelled with the
 *  stop time — a stopped batch must leave a visible "not run" state,
 *  not blanks. */
function finishBatch(outcomes: { label: string; ok: boolean; detail: string }[]): void {
  const settled: Record<string, CardRun> = {};
  const stoppedAt = Date.now();
  for (const [root, card] of Object.entries(batchState.runStates)) {
    settled[root] = card.state === "queued" || card.state === "running" ? { state: "cancelled", at: stoppedAt } : card;
  }
  patchBatch({ queue: null, runStates: settled, candidates: [] });
  if (outcomes.length === 0) return;
  const failed = outcomes.filter((entry) => !entry.ok);
  if (failed.length === 0) {
    toast.success(`${outcomes.length} project${outcomes.length === 1 ? "" : "s"} finished`, {
      description: "See each card below — and the Runs page — for results."
    });
  } else {
    toast.warning(`${outcomes.length - failed.length} finished, ${failed.length} failed`, {
      description: failed.map((entry) => `${entry.label}: ${entry.detail}`).join(" · ").slice(0, 300)
    });
  }
}

/** Restarts the dispatch loop after a page reload. The interrupted run
 *  itself is never re-dispatched — the store's boot reconcile adopts it
 *  and its record shows the real outcome on the card; this loop waits it
 *  out, then continues with the never-started folders. */
async function resumeBatchIfNeeded(): Promise<void> {
  if (batchLoopRunning || !batchState.queue) return;
  const candidates = batchState.candidates;
  if (candidates.length === 0) {
    patchBatch({ queue: null, runStates: {}, candidates: [] });
    return;
  }
  batchLoopRunning = true;
  batchStop.stop = false;
  batchStop.skip = new Set();
  const outcomes: { label: string; ok: boolean; detail: string }[] = [];
  let done = 0;
  for (const candidate of candidates) {
    if (batchStop.stop) break;
    const state = batchState.runStates[candidate.root]?.state;
    // Finished (or already stopped) before the reload — keep it counted, move on.
    if (state === "passed" || state === "failed" || state === "cancelled") {
      done += 1;
      continue;
    }
    patchBatch({ queue: { done, current: candidate.label, total: candidates.length } });
    // The suite that was executing when the page died: wait it out, then
    // drop the stale card state — the adopted record displays the result.
    if (state === "running") {
      await waitForRunnerIdle();
      setCardRun(candidate.root, null);
      done += 1;
      continue;
    }
    if (batchStop.skip.has(candidate.root)) continue;
    // Never dispatch into an offline or occupied runner: wait for a
    // genuinely idle runner first (a restarting one self-resumes the
    // queue when it answers again), and fail the card honestly when the
    // wait gives up.
    const idle = await waitForRunnerIdle();
    if (idle !== "idle") {
      const detail = idle === "busy"
        ? "The runner stayed busy for ~50 min — stop the other run, then press ▶ on this card"
        : "Runner unreachable for ~10 min — start the runner, then press ▶ on this card";
      setCardRun(candidate.root, { state: "failed", detail });
      outcomes.push({ label: candidate.label, ok: false, detail: idle === "busy" ? "runner stayed busy" : "runner unreachable" });
      done += 1;
      continue;
    }
    const outcome = await dispatchCandidate(candidate);
    outcomes.push({ label: candidate.label, ok: outcome.ok, detail: outcome.detail });
    done += 1;
  }
  finishBatch(outcomes);
  batchLoopRunning = false;
}

export function GlobalBranchSwitcher() {
  const { runs } = useDemoState();
  const { queue, runStates, startedAt: batchStartedAt } = useBatch();
  const [groups, setGroups] = useState<RootGroup[]>([]);
  const [unbound, setUnbound] = useState<{ id: string; name: string }[]>([]);
  const [probing, setProbing] = useState(true);
  const [switching, setSwitching] = useState(false);
  /** The branch picked in the global picker, pending confirm. */
  const [target, setTarget] = useState<string | null>(null);
  /** The folders queued for a run, pending confirm. */
  const [runTargets, setRunTargets] = useState<RootGroup[] | null>(null);
  const activeRunnerRun = useActiveRunnerRun();
  // Probe sequence — only the newest probe may commit its results.
  const probeTickRef = useRef(0);

  const probe = useCallback(async () => {
    const probeTick = ++probeTickRef.current;
    setProbing(true);
    // Resolve each project's runner-mode folder: this browser's saved
    // root first (the live truth — and the only dispatchable kind), else
    // the gateway binding another browser published (display-only). FSA
    // roots and unbound projects are counted but never touched — the
    // runner cannot see their disk.
    const byRoot = new Map<string, { id: string; name: string }[]>();
    const unboundList: { id: string; name: string }[] = [];
    const localRoots = new Set<string>();
    await Promise.all(projects.map(async (project) => {
      const saved = readSavedRoot(project.id);
      let root: string | null = null;
      let local = false;
      if (saved) {
        if (saved.mode === "runner") {
          root = saved.root;
          local = true;
        }
      } else {
        try {
          const binding = await loadWorkspaceSettings(project.id);
          if (binding?.root && binding.mode === "runner") root = binding.root;
        } catch {
          // No gateway row — the project simply has no folder here.
        }
      }
      if (!root) {
        unboundList.push({ id: project.id, name: project.name });
        return;
      }
      if (local) localRoots.add(root);
      const key = root.replace(/[\\/]+$/, "");
      const list = byRoot.get(key) ?? [];
      list.push({ id: project.id, name: project.name });
      byRoot.set(key, list);
    }));
    const nextGroups = await Promise.all([...byRoot.entries()].map(async ([root, list]): Promise<RootGroup> => {
      const group: RootGroup = { root, local: localRoots.has(root), projects: list, branch: null, branches: [], note: "" };
      try {
        const [cur, listRes] = await Promise.all([
          localFolder.runGit({ root, op: "current-branch" }),
          localFolder.runGit({ root, op: "branch-list" })
        ]);
        if (cur.code === 0) group.branch = cur.stdout.trim() || null;
        else group.note = ((cur.stderr || cur.stdout).trim() || "git failed").slice(0, 160);
        if (listRes.code === 0) {
          group.branches = listRes.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
            .filter((line) => line !== "origin" && !line.startsWith("origin/HEAD"));
        } else if (!group.note) {
          group.note = ((listRes.stderr || listRes.stdout).trim() || "git branch failed").slice(0, 160);
        }
      } catch (error) {
        group.note = error instanceof Error ? error.message : String(error);
      }
      return group;
    }));
    // Only the newest probe wins — an older in-flight probe finishing
    // after a newer one would resurrect stale branches.
    if (probeTick !== probeTickRef.current) return;
    setGroups(nextGroups);
    setUnbound(unboundList);
    setProbing(false);
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  // After a reload this page's dispatch loop is gone while the persisted
  // queue still stands — restart it once on mount.
  useEffect(() => {
    void resumeBatchIfNeeded();
  }, []);

  const clones = useMemo(() => groups.filter((group) => group.branch), [groups]);
  /** Folders this machine can actually dispatch (saved runner roots). */
  const runCandidates = useMemo(() => groups.filter((group) => group.local), [groups]);
  /** Locals first, then origin/*, alphabetical inside each half. */
  const allBranches = useMemo(() => {
    const set = new Set<string>();
    for (const group of groups) for (const name of group.branches) set.add(name);
    return [...set].sort((a, b) => {
      if (a.startsWith("origin/") !== b.startsWith("origin/")) return a.startsWith("origin/") ? 1 : -1;
      return a.localeCompare(b);
    });
  }, [groups]);
  // The picker shows the first clone's branch; cards compare against it,
  // so diverged folders light up as outlined pills on their own.
  const pickerValue = clones[0]?.branch ?? "";

  function requestSwitch(name: string) {
    if (switching || probing || queue) return;
    if (clones.every((group) => group.branch === name)) return;
    setTarget(name);
  }

  async function confirmSwitch() {
    const name = target;
    setTarget(null);
    if (!name || switching) return;
    setSwitching(true);
    try {
      const results = await Promise.all(clones.map(async (group): Promise<{ group: RootGroup; moved: boolean; error: string }> => {
        if (group.branch === name) return { group, moved: false, error: "" };
        try {
          const res = await localFolder.runGit({ root: group.root, op: "checkout", name });
          if (res.code !== 0) {
            return { group, moved: false, error: ((res.stderr || res.stdout).trim() || "checkout failed").slice(0, 160) };
          }
          return { group, moved: true, error: "" };
        } catch (error) {
          return { group, moved: false, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      const failed = results.filter((entry) => entry.error);
      const moved = results.filter((entry) => entry.moved);
      if (failed.length === 0) {
        toast.success(moved.length > 0 ? `All folders on ${name}` : `Already on ${name}`, {
          description: `${moved.length} folder${moved.length === 1 ? "" : "s"} switched across ${projects.length} project${projects.length === 1 ? "" : "s"}.`
        });
      } else {
        toast.warning(`${moved.length} folder${moved.length === 1 ? "" : "s"} switched, ${failed.length} failed`, {
          description: failed.map((entry) => `${groupLabel(entry.group)}: ${entry.error}`).join(" · ").slice(0, 300)
        });
      }
      await probe();
    } finally {
      setSwitching(false);
    }
  }

  /** Stops the queue after the project currently running, cancelling its
   *  run through the same path the Runs page uses (record + runner). */
  function stopQueue() {
    batchStop.stop = true;
    if (activeRunnerRun) cancelRun(activeRunnerRun.runId);
  }

  async function confirmRunAll() {
    const targets = runTargets;
    setRunTargets(null);
    if (!targets || targets.length === 0 || queue) return;
    // The runner takes one suite at a time; dispatching into a busy runner
    // would fail per project and burn the whole queue on one occupied slot.
    const busy = await runnerBusy();
    if (busy === null) {
      toast.error("Runner is unreachable — start it, then try again.");
      return;
    }
    if (busy) {
      toast.error("The runner is busy with another run — wait for it to finish first.");
      return;
    }
    const candidates: BatchCandidate[] = targets
      .filter((group) => group.projects[0])
      .map((group) => ({ root: group.root, leadId: group.projects[0]!.id, label: groupLabel(group) }));
    if (candidates.length === 0) return;
    batchStop.stop = false;
    batchStop.skip = new Set();
    batchLoopRunning = true;
    // The batch-start marker resets every card's previous result — the
    // display refills from THIS run alone (see the card's finishedRun).
    patchBatch({
      queue: { done: 0, current: candidates[0]!.label, total: candidates.length },
      runStates: Object.fromEntries(candidates.map((candidate) => [candidate.root, { state: "queued" as const }])),
      candidates,
      startedAt: Date.now()
    });
    const outcomes: { label: string; ok: boolean; detail: string }[] = [];
    let done = 0;
    for (const candidate of candidates) {
      if (batchStop.stop) break;
      // The user ✕-ed this card out of the queue while it was waiting.
      if (batchStop.skip.has(candidate.root)) continue;
      patchBatch({ queue: { done, current: candidate.label, total: candidates.length } });
      const outcome = await dispatchCandidate(candidate);
      outcomes.push({ label: candidate.label, ok: outcome.ok, detail: outcome.detail });
      done += 1;
    }
    finishBatch(outcomes);
    batchLoopRunning = false;
  }

  const moving = target ? clones.filter((group) => group.branch !== target) : [];
  const runLabels = runTargets ? runTargets.map(groupLabel) : [];
  const skippedCount = runTargets ? Math.max(0, projects.length - runTargets.reduce((sum, group) => sum + group.projects.length, 0) - unbound.length) : 0;
  // Any live runner run — batch-dispatched, card-dispatched, started from
  // a project page, or adopted after a reload — blocks a new batch and
  // gets a header stop control, even when the batch queue itself is gone.
  const runnerActive = Boolean(activeRunnerRun);

  return (
    <div aria-label="Global branch control and batch runs" className="gb-section" role="region">
      <div className="gb-head">
        <span className="gb-title"><GitBranch size={13} /> Branch &amp; runs</span>
        {!probing && clones.length > 0 ? (
          <div className="gb-picker">
            <BranchPicker
              branches={allBranches}
              disabled={switching || probing || Boolean(queue)}
              onChange={requestSwitch}
              value={pickerValue}
            />
          </div>
        ) : null}
        <span className="gb-spacer" />
        {queue ? (
          <span className="gb-overall">
            <Loader2 className="gb-spin" size={12} />
            {queue.done + 1}/{queue.total} — {queue.current}
          </span>
        ) : runnerActive ? (
          <span className="gb-overall"><Loader2 className="gb-spin" size={12} /> Runner busy</span>
        ) : null}
        {/* Hidden entirely while anything executes — a re-check mid-run
            would only confuse the counters shown on the cards. */}
        {!queue && !runnerActive ? (
          <button aria-label="Re-check folders" className="gb-refresh" disabled={probing || switching} onClick={() => void probe()} title="Re-check every folder's branch" type="button">
            <RefreshCw size={13} />
          </button>
        ) : null}
        {queue ? (
          <button className="gb-stop secondary-button" onClick={stopQueue} title="Stop the whole batch after the project currently running" type="button">
            <Square size={11} /> Stop
          </button>
        ) : runnerActive ? (
          <button
            className="gb-stop secondary-button"
            onClick={() => { if (activeRunnerRun) cancelRun(activeRunnerRun.runId); }}
            title="Cancel the run currently executing on the runner"
            type="button"
          >
            <Square size={11} /> Stop run
          </button>
        ) : (
          <button
            className="gb-run primary-button"
            disabled={runCandidates.length === 0 || switching || runnerActive}
            onClick={() => setRunTargets(runCandidates)}
            title={runCandidates.length === 0
              ? "No project folder is open on this machine — open one from its Tests tab first"
              : runnerActive
                ? "A run is currently executing — stop it first or wait for it to finish"
                : `Runs Playwright for ${runCandidates.length} folder${runCandidates.length === 1 ? "" : "s"}, one after another`}
            type="button"
          >
            <Play size={12} /> Run all projects
          </button>
        )}
      </div>

      {probing ? (
        <div className="gb-grid">
          {[0, 1, 2].map((index) => (
            <div className="gb-card gb-skel" key={index} style={{ animationDelay: `${index * 70}ms` }}>
              <div className="gb-skel-line w-60" />
              <div className="gb-skel-line w-40" />
              <div className="gb-skel-line w-80" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="gb-empty">
          No project folder is open yet — open one from a project's Tests tab to control branches or run tests from here.
          {unbound.length > 0 ? ` ${unbound.length} project${unbound.length === 1 ? " has" : "s have"} no folder at all.` : ""}
        </div>
      ) : (
        <div className="gb-grid">
          {groups.map((group, index) => {
            const cardRun = runStates[group.root];
            // Any live runner run for this project — batch-dispatched or
            // started from the project page — drives the progress bar and
            // gets a card-level cancel button.
            const live = liveRunOf(runs, group);
            const isRunning = cardRun?.state === "running" || (!cardRun && Boolean(live));
            // The most recent FINISHED run shows permanently on the card
            // (status word + counts), so results never vanish when a run
            // ends — or after a reload. Only runs from the CURRENT batch
            // count: starting a batch resets every card's previous data,
            // and the display refills from this run alone. Cancelled runs
            // are labelled too.
            const finishedRun = !live ? lastRunOf(runs, group, batchStartedAt) : null;
            const pct = live ? progressPct(live) : 0;
            const branchClass = group.branch ? (group.branch === pickerValue ? "same" : "diverged") : "broken";
            return (
              <div
                className={`gb-card${isRunning ? " is-running" : cardRun ? ` is-${cardRun.state}` : ""}`}
                key={group.root}
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                title={[
                  group.root,
                  group.projects.map((project) => project.name).join(", "),
                  group.note
                ].filter(Boolean).join("\n")}
              >
                <div className="gb-card-top">
                  <span className="gb-card-name">{groupLabel(group)}</span>
                  <span className="gb-card-side">
                    {isRunning ? <Loader2 className="gb-spin gb-dim" size={13} /> : null}
                    {cardRun?.state === "queued" ? <Clock className="gb-dim" size={12} /> : null}
                    {cardRun?.state === "cancelled" ? <CircleSlash className="gb-dim" size={13} /> : null}
                    {cardRun?.state === "passed" ? <CircleCheck className="gb-ok" size={13} /> : null}
                    {cardRun?.state === "failed" ? <CircleX className="gb-bad" size={13} /> : null}
                    {live ? (
                      <button
                        className="gb-card-cancel"
                        onClick={() => cancelRun(live.id)}
                        title="Cancel this run — a batch queue continues with the next project; the header Stop stops everything"
                        type="button"
                      >
                        <Square size={10} />
                      </button>
                    ) : null}
                    {cardRun?.state === "queued" ? (
                      <button
                        className="gb-card-cancel"
                        onClick={() => {
                          batchStop.skip.add(group.root);
                          setCardRun(group.root, null);
                        }}
                        title="Skip this project — remove it from the queue"
                        type="button"
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                    {group.local ? (
                      <button
                        className="gb-card-run"
                        disabled={Boolean(queue) || switching}
                        onClick={() => setRunTargets([group])}
                        title={`Run this folder's specs now`}
                        type="button"
                      >
                        <Play size={11} />
                      </button>
                    ) : (
                      <span className="gb-remote" title="Bound from another browser — open the folder here (project → Tests tab) to run it">
                        not local
                      </span>
                    )}
                  </span>
                </div>
                <div className="gb-card-branch">
                  <span
                    className={`gb-pill is-${branchClass}`}
                    title={group.branch && group.branch !== pickerValue ? `Differs from the picker (${pickerValue}) — realign from the picker above` : undefined}
                  >
                    <GitBranch size={10} /> {group.branch ?? "not a repo"}
                  </span>
                </div>
                {cardRun?.state === "queued" ? (
                  <div className="gb-wait" title="Waiting for its turn — the runner takes one suite at a time">
                    <span /><span /><span />
                  </div>
                ) : null}
                {cardRun?.state === "cancelled" ? (
                  <div className="gb-progress" title="Stopped before its turn — press ▶ to run just this folder">
                    <div className="gb-progress-meta">
                      <span className="gb-pct gb-dim">Cancelled</span>
                      <span className="gb-counts">
                        <span className="gb-ok">✓ 0</span>
                        <span className="gb-dim">✗ 0</span>
                        <span className="gb-dim">{cardRun.at ? formatRelative(cardRun.at) : ""}</span>
                      </span>
                    </div>
                  </div>
                ) : null}
                {live ? (
                  <div className="gb-progress">
                    <div className="gb-track">
                      <div className="gb-fill is-run" style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                    <div className="gb-progress-meta">
                      <span className="gb-pct">{pct}%</span>
                      <span className="gb-counts">
                        <span className="gb-ok">✓ {live.passed}</span>
                        <span className={live.failed > 0 ? "gb-bad" : "gb-dim"}>✗ {live.failed}</span>
                      </span>
                    </div>
                  </div>
                ) : null}
                {finishedRun ? (
                  <div className="gb-progress" title={`${finishedRun.name} · ${formatRelative(finishedRun.startedAt)}`}>
                    <div className="gb-progress-meta">
                      <span className={`gb-pct ${finishedRun.status === "passed" ? "gb-ok" : finishedRun.status === "failed" ? "gb-bad" : "gb-dim"}`}>
                        {finishedRun.status === "passed" ? "✓ Finished" : finishedRun.status === "failed" ? "✗ Failed" : "Cancelled"}
                      </span>
                      <span className="gb-counts">
                        <span className="gb-ok">✓ {finishedRun.passed}</span>
                        <span className={finishedRun.failed > 0 ? "gb-bad" : "gb-dim"}>✗ {finishedRun.failed}</span>
                        <span className="gb-dim">{formatRelative(finishedRun.startedAt)}</span>
                      </span>
                    </div>
                  </div>
                ) : null}
                {cardRun?.state === "failed" && cardRun.detail ? (
                  <div className="gb-err" title={cardRun.detail}>{cardRun.detail}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {!probing && unbound.length > 0 && groups.length > 0 ? (
        <div className="gb-foot" title={unbound.map((project) => project.name).join(", ")}>
          {unbound.length} project{unbound.length === 1 ? " has" : "s have"} no open folder here — {unbound.slice(0, 3).map((project) => project.name).join(", ")}{unbound.length > 3 ? ` +${unbound.length - 3}` : ""}
        </div>
      ) : null}

      {target ? (
        <ConfirmDialog
          confirmLabel={`Switch to ${target}`}
          message={`${moving.map((group) =>
            `${groupLabel(group)}: ${group.branch} → ${target}${group.projects.length > 1 ? ` (${group.projects.length} projects)` : ""}`
          ).join(" · ")} — save unsaved editor changes first; a folder that refuses (dirty tree, conflicts) fails alone, the rest still move.`}
          onCancel={() => setTarget(null)}
          onConfirm={() => void confirmSwitch()}
          title="Switch branches across projects?"
        />
      ) : null}
      {runTargets ? (
        <ConfirmDialog
          confirmLabel={`Run ${runTargets.length} project${runTargets.length === 1 ? "" : "s"}`}
          message={`${runLabels.slice(0, 8).join(" · ")}${runLabels.length > 8 ? ` +${runLabels.length - 8} more` : ""} — one after another (the runner takes a single suite at a time); each project's current branch is used.${skippedCount > 0 ? ` ${skippedCount} project${skippedCount === 1 ? "" : "s"} with a folder nobody opened on this machine are skipped.` : ""}`}
          onCancel={() => setRunTargets(null)}
          onConfirm={() => void confirmRunAll()}
          title="Run Playwright tests for all projects?"
        />
      ) : null}
    </div>
  );
}
