// GitHub REST client for the Source Control view: PULL a repository's
// text files into the workspace, PUSH the changed files back as one
// commit. Everything runs in the browser against api.github.com -- no
// proxy, no server-side copy -- and the personal access token lives in
// sessionStorage only (per-tab, gone when the tab closes), never in
// the gateway or any log.
//
// Pull reuses the folder importer's exact guards (binary / secret /
// skip-dir / size caps) through pathSkipReason, so a GitHub pull and a
// local folder import always produce the same bounded workspace.

import {
  IMPORT_MAX_FILES,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_TOTAL_BYTES,
  pathSkipReason
} from "../../../lib/workspace/importFiles";

const API = "https://api.github.com";

// ── token (session-scoped) ────────────────────────────────

const TOKEN_KEY = "tp-github-pat";

export function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private windows may block storage; the field stays in memory.
  }
}

// ── repo parsing ──────────────────────────────────────────

export type RepoRef = { owner: string; repo: string };

/** Accepts "owner/name" or a full github.com URL (with or without .git). */
export function parseRepoInput(input: string): RepoRef | null {
  const trimmed = input.trim().replace(/\.git$/i, "");
  const url = /^https?:\/\/[^/]+\/([^/]+)\/([^/?#]+)/i.exec(trimmed);
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
  const match = url ?? short;
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}

// ── low-level request helper ──────────────────────────────

async function gh(path: string, token: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API}${path}`, { ...init, headers });
}

/** Human-readable message from a GitHub error response. */
async function ghError(response: Response, fallback: string): Promise<string> {
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 403 || response.status === 429) {
    if (remaining === "0") return "GitHub rate limit reached — add a personal access token to keep going.";
    return `GitHub refused the request (${response.status}). Check the token's scopes (repo access required).`;
  }
  if (response.status === 401) return "GitHub rejected the token (401). Check that it is valid and not expired.";
  if (response.status === 404) return fallback;
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ? `GitHub: ${body.message}` : fallback;
  } catch {
    return fallback;
  }
}

// ── base64 ↔ UTF-8 ────────────────────────────────────────

function decodeBase64(data: string): string {
  const bytes = Uint8Array.from(atob(data.replace(/\n/g, "")), (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

// ── pull ──────────────────────────────────────────────────

export type PullReport = {
  repo: RepoRef;
  branch: string;
  files: { path: string; content: string }[];
  skipped: { dirs: number; binaries: number; large: number; secrets: number; cap: number };
  truncatedTree: boolean;
  rateCapped: boolean;
};

/**
 * Fetch a repository's text files (same bounds as a folder import).
 * Without a token GitHub allows 60 requests/hour, so anonymous pulls
 * stop at 50 files and say so instead of dying mid-flight.
 */
export async function pullRepo(input: { repoInput: string; branch: string; token: string }): Promise<PullReport> {
  const ref = parseRepoInput(input.repoInput);
  if (!ref) throw new Error("Repository must be “owner/name” or a github.com URL");

  let branch = input.branch.trim();
  if (!branch) {
    const info = await gh(`/repos/${ref.owner}/${ref.repo}`, input.token);
    if (!info.ok) throw new Error(await ghError(info, "Repository not found or inaccessible"));
    const body = (await info.json()) as { default_branch?: string };
    branch = body.default_branch || "main";
  }

  const treeResponse = await gh(
    `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    input.token
  );
  if (!treeResponse.ok) throw new Error(await ghError(treeResponse, `Branch “${branch}” not found`));
  const tree = (await treeResponse.json()) as {
    tree?: { path?: string; type?: string; size?: number; sha?: string }[];
    truncated?: boolean;
  };

  const anonymousCap = input.token ? Number.POSITIVE_INFINITY : 50;
  const skipped = { dirs: 0, binaries: 0, large: 0, secrets: 0, cap: 0 };
  const selected: { path: string; sha: string }[] = [];
  let totalBytes = 0;
  let rateCapped = false;

  for (const entry of tree.tree ?? []) {
    if (entry.type !== "blob" || !entry.path || !entry.sha) continue;
    const reason = pathSkipReason(entry.path);
    if (reason === "dir") { skipped.dirs += 1; continue; }
    if (reason === "binary") { skipped.binaries += 1; continue; }
    if (reason === "secret") { skipped.secrets += 1; continue; }
    const size = entry.size ?? 0;
    if (size > IMPORT_MAX_FILE_BYTES) { skipped.large += 1; continue; }
    if (selected.length >= IMPORT_MAX_FILES || totalBytes + size > IMPORT_MAX_TOTAL_BYTES || selected.length >= anonymousCap) {
      skipped.cap += 1;
      if (selected.length >= anonymousCap) rateCapped = true;
      continue;
    }
    selected.push({ path: entry.path, sha: entry.sha });
    totalBytes += size;
  }

  // Fetch blob contents with modest concurrency.
  const files: { path: string; content: string }[] = [];
  const CHUNK = 8;
  for (let offset = 0; offset < selected.length; offset += CHUNK) {
    const batch = selected.slice(offset, offset + CHUNK);
    const contents = await Promise.all(batch.map(async (entry) => {
      const response = await gh(`/repos/${ref.owner}/${ref.repo}/git/blobs/${entry.sha}`, input.token);
      if (!response.ok) throw new Error(await ghError(response, `Could not read ${entry.path}`));
      const body = (await response.json()) as { content?: string; encoding?: string };
      if (body.encoding !== "base64") throw new Error(`GitHub returned ${entry.path} in an unexpected encoding`);
      return { path: entry.path, content: decodeBase64(body.content ?? "") };
    }));
    files.push(...contents);
  }

  return {
    repo: ref,
    branch,
    files,
    skipped,
    truncatedTree: tree.truncated === true,
    rateCapped
  };
}

// ── push ──────────────────────────────────────────────────

export type PushReport = { commitUrl: string; sha: string; branch: string; pushed: string[] };

/**
 * Commit the given files to `branch` as ONE commit via the Git data
 * API: blobs → tree (based on the branch's current tree) → commit →
 * ref update. Requires a token with write access to the repository.
 */
export async function pushChanges(input: {
  repoInput: string;
  branch: string;
  token: string;
  message: string;
  files: { path: string; content: string }[];
}): Promise<PushReport> {
  const ref = parseRepoInput(input.repoInput);
  if (!ref) throw new Error("Repository must be “owner/name” or a github.com URL");
  if (!input.token.trim()) throw new Error("Pushing needs a GitHub token with repo write access");
  if (input.files.length === 0) throw new Error("No changed files to push");

  const base = `/repos/${ref.owner}/${ref.repo}`;

  // An empty branch means "the repository's default branch" (same as pull).
  let branch = input.branch.trim();
  if (!branch) {
    const info = await gh(base, input.token);
    if (!info.ok) throw new Error(await ghError(info, "Repository not found or inaccessible"));
    const body = (await info.json()) as { default_branch?: string };
    branch = body.default_branch || "main";
  }

  // 1) Blobs for every changed file, modest concurrency.
  const treeItems: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  const CHUNK = 8;
  for (let offset = 0; offset < input.files.length; offset += CHUNK) {
    const batch = input.files.slice(offset, offset + CHUNK);
    const shas = await Promise.all(batch.map(async (file) => {
      const response = await gh(`${base}/git/blobs`, input.token, {
        method: "POST",
        body: JSON.stringify({ content: encodeBase64(file.content), encoding: "base64" })
      });
      if (!response.ok) throw new Error(await ghError(response, `Could not upload ${file.path}`));
      const body = (await response.json()) as { sha?: string };
      if (!body.sha) throw new Error(`GitHub did not return a blob for ${file.path}`);
      return body.sha;
    }));
    batch.forEach((file, index) => {
      const sha = shas[index];
      if (sha) treeItems.push({ path: file.path, mode: "100644", type: "blob", sha });
    });
  }

  // 2) The branch's current head commit.
  const refResponse = await gh(`${base}/git/ref/heads/${encodeURIComponent(branch)}`, input.token);
  if (!refResponse.ok) throw new Error(await ghError(refResponse, `Branch “${branch}” not found`));
  const refBody = (await refResponse.json()) as { object?: { sha?: string } };
  const headSha = refBody.object?.sha;
  if (!headSha) throw new Error(`Branch “${input.branch}” has no head commit`);

  // 3) Its tree, so unchanged paths survive the commit.
  const headResponse = await gh(`${base}/git/commits/${headSha}`, input.token);
  if (!headResponse.ok) throw new Error(await ghError(headResponse, "Could not read the branch head commit"));
  const headBody = (await headResponse.json()) as { tree?: { sha?: string } };
  const baseTree = headBody.tree?.sha;

  // 4) New tree → 5) commit → 6) move the branch ref.
  const treeResponse = await gh(`${base}/git/trees`, input.token, {
    method: "POST",
    body: JSON.stringify(baseTree ? { base_tree: baseTree, tree: treeItems } : { tree: treeItems })
  });
  if (!treeResponse.ok) throw new Error(await ghError(treeResponse, "Could not create the commit tree"));
  const treeBody = (await treeResponse.json()) as { sha?: string };
  if (!treeBody.sha) throw new Error("GitHub did not return the new tree");

  const commitResponse = await gh(`${base}/git/commits`, input.token, {
    method: "POST",
    body: JSON.stringify({ message: input.message, tree: treeBody.sha, parents: [headSha] })
  });
  if (!commitResponse.ok) throw new Error(await ghError(commitResponse, "Could not create the commit"));
  const commitBody = (await commitResponse.json()) as { sha?: string; html_url?: string };
  if (!commitBody.sha) throw new Error("GitHub did not return the new commit");

  const updateResponse = await gh(`${base}/git/refs/heads/${encodeURIComponent(branch)}`, input.token, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitBody.sha, force: false })
  });
  if (!updateResponse.ok) throw new Error(await ghError(updateResponse, "Could not move the branch to the new commit"));

  return {
    commitUrl: commitBody.html_url ?? `https://github.com/${ref.owner}/${ref.repo}/commit/${commitBody.sha}`,
    sha: commitBody.sha,
    branch,
    pushed: input.files.map((file) => file.path)
  };
}

// ── branches / identity / history ─────────────────────────

/** The repository's default branch (e.g. "main") — the "" fallback. */
export async function defaultBranchOf(input: { repoInput: string; token: string }): Promise<string> {
  const ref = parseRepoInput(input.repoInput);
  if (!ref) throw new Error("Repository must be “owner/name” or a github.com URL");
  const info = await gh(`/repos/${ref.owner}/${ref.repo}`, input.token);
  if (!info.ok) throw new Error(await ghError(info, "Repository not found or inaccessible"));
  const body = (await info.json()) as { default_branch?: string };
  return body.default_branch || "main";
}

/** Up to 100 branch names, for the SCM branch picker. */
export async function listBranches(input: { repoInput: string; token: string }): Promise<string[]> {
  const ref = parseRepoInput(input.repoInput);
  if (!ref) throw new Error("Repository must be “owner/name” or a github.com URL");
  const response = await gh(`/repos/${ref.owner}/${ref.repo}/branches?per_page=100`, input.token);
  if (!response.ok) throw new Error(await ghError(response, "Could not list branches"));
  const body = (await response.json()) as { name?: string }[];
  const names = body.map((branch) => branch.name ?? "").filter(Boolean);
  if (names.length === 0) throw new Error("This repository has no branches");
  return names;
}

/**
 * Create `name` off `from` (default branch when empty) via the Git data
 * API. Requires a token with push access; GitHub answers 422 when the
 * branch already exists.
 */
export async function createBranch(input: { repoInput: string; token: string; name: string; from?: string }): Promise<{ url: string }> {
  const ref = parseRepoInput(input.repoInput);
  if (!ref) throw new Error("Repository must be “owner/name” or a github.com URL");
  const name = input.name.trim();
  if (!name || /[\s~^:?*\[\\]/.test(name)) throw new Error("Branch name has invalid characters or is empty");
  const base = `/repos/${ref.owner}/${ref.repo}`;
  const fromBranch = input.from?.trim() || (await defaultBranchOf({ repoInput: input.repoInput, token: input.token }));
  const refResponse = await gh(`${base}/git/ref/heads/${encodeURIComponent(fromBranch)}`, input.token);
  if (!refResponse.ok) throw new Error(await ghError(refResponse, `Could not read “${fromBranch}” to branch from`));
  const refBody = (await refResponse.json()) as { object?: { sha?: string } };
  const sha = refBody.object?.sha;
  if (!sha) throw new Error(`Branch “${fromBranch}” has no head commit`);
  const create = await gh(`${base}/git/refs`, input.token, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha })
  });
  if (!create.ok) {
    if (create.status === 422) throw new Error(`Branch “${name}” already exists`);
    throw new Error(await ghError(create, `Could not create “${name}”`));
  }
  return { url: `https://github.com/${ref.owner}/${ref.repo}/tree/${encodeURIComponent(name)}` };
}

/** The login the token belongs to — the SCM "signed in" chip. */
export async function whoAmI(token: string): Promise<string> {
  const response = await gh("/user", token);
  if (!response.ok) throw new Error(await ghError(response, "GitHub rejected the token"));
  const body = (await response.json()) as { login?: string };
  if (!body.login) throw new Error("GitHub did not return the account name");
  return body.login;
}

export type CommitInfo = { sha: string; message: string; author: string; date: string; url: string };

/** The branch's recent commits, for the SCM history list. */
export async function listCommits(input: { repoInput: string; branch: string; token: string; limit?: number }): Promise<CommitInfo[]> {
  const ref = parseRepoInput(input.repoInput);
  if (!ref) throw new Error("Repository must be “owner/name” or a github.com URL");
  const branch = input.branch.trim() || (await defaultBranchOf({ repoInput: input.repoInput, token: input.token }));
  const response = await gh(
    `/repos/${ref.owner}/${ref.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${input.limit ?? 8}`,
    input.token
  );
  if (!response.ok) throw new Error(await ghError(response, "Could not list commits"));
  const body = (await response.json()) as {
    sha?: string;
    html_url?: string;
    commit?: { message?: string; author?: { name?: string; date?: string } };
  }[];
  return body.map((entry) => ({
    sha: entry.sha ?? "",
    message: (entry.commit?.message ?? "").split("\n")[0] ?? "",
    author: entry.commit?.author?.name ?? "",
    date: entry.commit?.author?.date ?? "",
    url: entry.html_url ?? `https://github.com/${ref.owner}/${ref.repo}/commit/${entry.sha ?? ""}`
  })).filter((entry) => entry.sha !== "");
}
