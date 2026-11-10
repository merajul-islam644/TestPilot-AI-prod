// Backend-facing methods for the folder-backed workbench workspace.
//
// Follows the Lattice workspace contract exactly (src/services/
// devServerApi.ts user-folder section): a folder picked from the user's
// machine IS the workspace — the editor reads and writes its files in
// place through the local runner (`runner/server.mjs` /api/workbench/*),
// so there is no upload step and nothing a refresh can lose.
//
// The runner already serves the terminal and the Playwright runs from
// http://localhost:9090 (loopback is exempt from mixed-content rules),
// so these routes ride the same origin — no Vite proxy involved.

import { isWorkspaceRootName } from "./importFiles";
import { runnerUrl } from "../runner/client";

/** One entry of the server's recursive tree walk (Lattice FileNode). */
export type FolderNode = {
  name: string;
  /** Path relative to the picked root, forward slashes. */
  path: string;
  kind: "file" | "dir";
  children?: FolderNode[];
};

/** A native dialog answer: the picked path (for pick-file the runner
 *  adds its parent `folder` + workspace-relative `rel`) or a refusal
 *  the UI can toast instead of throwing. */
export type PickResult =
  | { path: string; folder?: string; rel?: string }
  | { cancelled: true; reason: "cancelled" | "no_gui" | "spawn_failed" };

/** @deprecated legacy alias — use PickResult. */
export type PickFolderResult = PickResult;

async function postJson<T>(route: string, body: unknown): Promise<T> {
  const response = await fetch(`${runnerUrl()}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `${route} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export const localFolder = {
  /** Native OS folder dialog; the server answers picked / cancelled /
   *  no_gui so the UI can fall back to the typed-path input. */
  async pickFolder(): Promise<PickResult> {
    return postJson<PickResult>("/api/workbench/pick-folder", {});
  },

  /** Native OS open-file dialog (the same Explorer-style window, file
   *  mode). The response carries the file's `folder` and workspace-
   *  relative `rel` so the caller can open that folder as the root and
   *  reveal the file in one step. */
  async pickFile(): Promise<PickResult> {
    return postJson<PickResult>("/api/workbench/pick-file", {});
  },

  /** Recursive tree of the picked folder. Hides node_modules/.git;
   *  capped at 5,000 entries + 8 levels server-side. `exists: false`
   *  marks a dead root — callers must refuse to store it. */
  async listTree(opts: { root: string; maxDepth?: number }): Promise<{ tree: FolderNode[]; exists: boolean }> {
    return postJson<{ tree: FolderNode[]; exists: boolean }>("/api/workbench/list", {
      root: opts.root,
      maxDepth: opts.maxDepth
    });
  },

  /** Workspace-root validation (runner edition of fsaWorkspace's
   *  resolveWorkspaceRoot): `rootPath` itself when its name is
   *  e2e/playwright (case-insensitive), else the shallowest
   *  e2e/playwright folder inside it (breadth-first over the
   *  server-capped walk — node_modules/.git already hidden), as an
   *  absolute path. null → the caller refuses the pick with an error. */
  async resolveRoot(rootPath: string): Promise<string | null> {
    const leaf = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? "";
    if (isWorkspaceRootName(leaf)) return rootPath;
    const { tree } = await this.listTree({ root: rootPath });
    if (!tree || tree.length === 0) return null;
    type Level = { name: string; path: string; dirs: FolderNode[] };
    let level: Level[] = tree
      .filter((node) => node.kind === "dir")
      .map((node) => ({ name: node.name, path: node.path, dirs: node.children?.filter((child) => child.kind === "dir") ?? [] }));
    while (level.length > 0) {
      for (const node of level) {
        if (isWorkspaceRootName(node.name)) return `${rootPath}/${node.path}`;
      }
      level = level
        .flatMap((node) => node.dirs.map((child) => ({ name: child.name, path: child.path, dirs: child.children?.filter((grand) => grand.kind === "dir") ?? [] })))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return null;
  },

  /** Read one text file in the folder. `null` on 404 (deleted out from
   *  under the editor). UTF-8 only — binaries are filtered client-side. */
  async readUserFile(opts: { root: string; path: string }): Promise<string | null> {
    try {
      const data = await postJson<{ content: string }>("/api/workbench/read", { root: opts.root, path: opts.path });
      return data.content;
    } catch (error) {
      // 404 means the file is gone — a normal state for a workspace
      // others (git, another editor) can touch; callers re-list.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found") || message.includes("(404)")) return null;
      throw error;
    }
  },

  /** Write one text file; missing parents are created (mkdir -p). */
  async writeUserFile(opts: { root: string; path: string; content: string }): Promise<void> {
    await postJson("/api/workbench/write", { root: opts.root, path: opts.path, content: opts.content });
  },

  /** Delete a file or directory (recursive). Throws on ENOENT — callers
   *  decide whether a vanished path is worth an error. */
  async deleteUserPath(opts: { root: string; path: string }): Promise<void> {
    await postJson("/api/workbench/delete", { root: opts.root, path: opts.path });
  },

  /** Rename or move a file/directory; refuses if newPath exists (409). */
  async renameUserPath(opts: { root: string; oldPath: string; newPath: string }): Promise<void> {
    await postJson("/api/workbench/rename", { root: opts.root, oldPath: opts.oldPath, newPath: opts.newPath });
  },

  /** Make a directory (mkdir -p). */
  async mkdirUserPath(opts: { root: string; path: string }): Promise<void> {
    await postJson("/api/workbench/mkdir", { root: opts.root, path: opts.path });
  },

  /** Server-side content search: walks the guarded tree, skips build
   *  dirs/binaries/secrets/oversize files, scans case-insensitively.
   *  Line `text` is the raw line (≤300 chars); the sidebar splits the
   *  highlight around the query. */
  async search(opts: { root: string; query: string }): Promise<SearchResponse> {
    return postJson<SearchResponse>("/api/workbench/search", { root: opts.root, query: opts.query });
  },

  /** One allowlisted git op on the workspace clone (stash, blame,
   *  status) — the runner builds the argv, the client only names the op.
   *  Git's non-zero exit arrives as `code`, NOT as a throw, so callers
   *  branch on it (conflict vs transport error). */
  async runGit(opts: { root: string } & GitOp): Promise<GitOpResult> {
    return postJson<GitOpResult>("/api/git", opts);
  }
};

export type SearchLine = { number: number; text: string };
export type SearchGroup = { path: string; lines: SearchLine[] };
export type SearchResponse = { results: SearchGroup[]; truncated: boolean; exists?: boolean };

/** One `git stash list` row: the ref (stash@{0}), its subject line. */
export type GitStashRow = { ref: string; subject: string };

/** Result of one allowlisted git op on the workspace clone. `code` is
 *  git's OWN exit status — non-zero (e.g. a conflicted stash pop) is a
 *  normal answer, not a throw; stdout/stderr carry the diagnosis. */
export type GitOpResult = { ok: true; op: string; code: number; stdout: string; stderr: string };

export type GitOp =
  | { op: "status" }
  | { op: "stash-list" }
  | { op: "stash-push"; message?: string; paths?: string[] }
  | { op: "stash-pop"; index?: number }
  | { op: "stash-drop"; index: number }
  | { op: "blame"; path: string };
