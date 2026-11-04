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

import { runnerUrl } from "../runner/client";

/** One entry of the server's recursive tree walk (Lattice FileNode). */
export type FolderNode = {
  name: string;
  /** Path relative to the picked root, forward slashes. */
  path: string;
  kind: "file" | "dir";
  children?: FolderNode[];
};

export type PickFolderResult =
  | { path: string }
  | { cancelled: true; reason: "cancelled" | "no_gui" | "spawn_failed" };

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
  async pickFolder(): Promise<PickFolderResult> {
    return postJson<PickFolderResult>("/api/workbench/pick-folder", {});
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
  }
};
