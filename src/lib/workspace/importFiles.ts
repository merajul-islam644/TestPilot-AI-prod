// Client-side codebase import: turns a <input webkitdirectory> FileList into
// a bounded, text-only workspace file set. Everything that could leak secrets
// or blow past the gateway's per-record limits is filtered BEFORE any network
// call, and the report counts what was skipped so the UI can show an honest
// summary instead of a silent partial import.

export type ImportedFile = { path: string; content: string };
export type ImportReport = {
  files: ImportedFile[];
  skipped: { dirs: number; binaries: number; large: number; secrets: number; cap: number };
  rootFolder: string;
};

export const IMPORT_MAX_FILES = 300;
export const IMPORT_MAX_FILE_BYTES = 100_000;
export const IMPORT_MAX_TOTAL_BYTES = 6_000_000;

/** Generated code, VCS internals and build output never belong in the workspace.
 *  Exported for tree walkers that need the same dir filter per segment
 *  (the FSA backend's handle walk). */
export const SKIP_DIR_NAMES = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "build", "out", ".next", ".nuxt",
  ".output", ".cache", ".parcel-cache", ".turbo", "coverage", ".nyc_output",
  "venv", ".venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache",
  ".idea", ".vscode", "vendor", "target", "obj", ".gradle", ".terraform",
  ".serverless", "tmp", "temp", "logs", ".angular", ".svelte-kit",
  "test-results", "playwright-report"
]);

/** A valid TestPilot workspace root must BE an e2e/playwright folder — or
 *  any folder that CONTAINS one (that inner folder becomes the root).
 *  Case-insensitive; shared by the FSA and runner open flows. */
export const WORKSPACE_ROOT_NAMES: readonly string[] = ["e2e", "playwright"];
export function isWorkspaceRootName(name: string): boolean {
  return WORKSPACE_ROOT_NAMES.includes(name.toLowerCase());
}

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tif", "tiff",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp4", "webm", "mov", "avi", "mkv", "mp3", "wav", "ogg", "flac",
  "zip", "gz", "tgz", "rar", "7z", "tar", "bz2", "xz",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "exe", "dll", "so", "dylib", "bin", "dat", "iso", "dmg", "msi", "appimage",
  "jar", "class", "pyc", "pyd", "wasm", "db", "sqlite", "sqlite3", "pdb", "node"
]);

// Anything that plausibly holds credentials never leaves the browser -- the
// same rule that keeps .env out of git applies to the gateway tenant.
const SECRET_PATTERNS = [
  /^\.env/i,
  /\.(pem|p12|pfx|key)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)/i,
  /(^|\/)(credentials|secrets?)\./i,
  /\.npmrc$/i,
  /serviceaccount[^/]*\.json$/i
];

function isSecretPath(path: string): boolean {
  const lower = path.toLowerCase();
  const basename = lower.slice(lower.lastIndexOf("/") + 1);
  return SECRET_PATTERNS.some((pattern) => pattern.test(basename));
}

export function isBinaryPath(path: string): boolean {
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");
  if (lastDot <= lastSlash) return false; // no extension (or dot inside a folder name)
  const ext = path.slice(lastDot + 1).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/** Why a path must not enter the workspace. Shared by every importer that
 * enumerates a tree (folder picker, GitHub pull) instead of reading local
 * files, so folder import and remote pull filter identically. */
export type PathSkipReason = "dir" | "binary" | "secret";
export function pathSkipReason(path: string): PathSkipReason | null {
  const segments = path.split("/");
  if (segments.some((segment) => SKIP_DIR_NAMES.has(segment))) return "dir";
  if (isBinaryPath(path)) return "binary";
  if (isSecretPath(path)) return "secret";
  return null;
}

/** NUL bytes survive text decoding only in binary content. */
function looksBinary(text: string): boolean {
  return text.includes("\u0000");
}

/**
 * A path the runner will accept: workspace-relative, forward slashes, no
 * whitespace/backslash segments, and shaped like a Playwright spec. Mirrors
 * the workspace path rule in runner/server.mjs.
 */
export function isRunnableSpecPath(path: string): boolean {
  return !/[\s\\]/.test(path) && /^[\w.-]+(\/[\w.-]+)*\.(spec|test)\.(mjs|js|ts)$/.test(path);
}

/** First-level workspace folders the Playwright workbench shows. The editor
 *  is a TEST workbench: app-source trees that happen to sit beside the suite
 *  (client/, server/, .github, npm-cache, …) never belong in it — the user
 *  asked for exactly this scoping ("no folder opens other than e2e- and
 *  playwright-style folders"). Root-level loose files (playwright.config.ts,
 *  package.json, …) always stay; deeper levels are untouched, so tests/,
 *  support/, fixtures/ all show. The runner's run-dir asset copy mirrors
 *  this list (WORKBENCH_RUN_DIRS in runner/server.mjs). */
export const WORKBENCH_FOLDER_NAMES = new Set([
  "e2e", "playwright", "tests", "test", "specs", "spec",
  "support", "pages", "components", "fixtures", "helpers"
]);

/** Keep only paths inside the workbench folder scope (or at the root level). */
export function workbenchPathFilter(paths: string[]): string[] {
  return paths.filter((path) => {
    const slash = path.indexOf("/");
    if (slash === -1) return true;
    return WORKBENCH_FOLDER_NAMES.has(path.slice(0, slash).toLowerCase());
  });
}

/** Code files ride along with a run: specs may import them via relative paths. */
export const CODE_FILE_EXTENSIONS = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts|json)$/;

/** Resolution suffixes for an extensionless relative import, Node order. */
const IMPORT_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs", "/index.cjs", "/index.json"];

/** Static import / require specifiers in a source file (dynamic import() included). */
export function importSpecifiersOf(content: string): string[] {
  const out: string[] = [];
  const pattern = /(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s+|\bimport\s*\(\s*)["']([^"']+)["']/g;
  for (const match of content.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier) out.push(specifier);
  }
  return out;
}

/** "tests/auth/../support" -> "support"; dot segments collapse, empties drop. */
function resolveRelative(fromDir: string, specifier: string): string {
  const segments = `${fromDir}/${specifier}`.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/**
 * Follow the selected specs' relative imports transitively and return the
 * helper files they actually need, bounded by the run's file budget. This
 * replaces the old "first N code files alphabetically" fill — a branch
 * switch that adds directories sorting before `support/` starved the real
 * helpers and the run died with "Cannot find module '../../support/test-base'".
 * Unresolvable names (bare packages) are skipped; a missing/unreadable file
 * simply ends that branch of the walk.
 */
export async function collectImportedHelpers({ specPaths, knownPaths, budget, read }: {
  specPaths: string[];
  /** Every file path the workspace currently has — the existence check. */
  knownPaths: string[];
  budget: number;
  read: (path: string) => Promise<string | null>;
}): Promise<string[]> {
  const exists = new Set(knownPaths);
  const cache = new Map<string, string | null>();
  const seen = new Set(specPaths);
  const helpers: string[] = [];
  const queue = [...specPaths];
  while (queue.length > 0 && helpers.length < budget) {
    const path = queue.shift() as string;
    let content = cache.get(path);
    if (content === undefined) {
      content = await read(path);
      cache.set(path, content);
    }
    if (content === null) continue;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    for (const specifier of importSpecifiersOf(content)) {
      if (!specifier.startsWith(".")) continue;
      const base = resolveRelative(dir, specifier);
      const hit = IMPORT_SUFFIXES.map((suffix) => `${base}${suffix}`).find((candidate) => exists.has(candidate));
      if (!hit || seen.has(hit)) continue;
      seen.add(hit);
      if (isRunnableSpecPath(hit)) continue;
      if (helpers.length < budget) helpers.push(hit);
      queue.push(hit);
    }
  }
  return helpers;
}

/** Common first segment across every file = the imported folder's own name. */
export function workspaceRootOf(paths: string[]): string {
  const first = paths[0]?.split("/")[0] ?? "";
  return first && paths.every((entry) => entry.split("/")[0] === first) ? first : "";
}

export async function importFromFileDialog(fileList: File[]): Promise<ImportReport> {
  const all = fileList;
  const skipped = { dirs: 0, binaries: 0, large: 0, secrets: 0, cap: 0 };
  const candidates: { path: string; file: File }[] = [];
  let rootFolder = "";

  for (const file of all) {
    const segments = (file.webkitRelativePath || file.name).split("/");
    if (!rootFolder) rootFolder = segments[0] ?? "";
    if (segments.slice(0, -1).some((segment) => SKIP_DIR_NAMES.has(segment))) {
      skipped.dirs += 1;
      continue;
    }
    const path = segments.join("/");
    if (isSecretPath(path)) {
      skipped.secrets += 1;
      continue;
    }
    if (isBinaryPath(path)) {
      skipped.binaries += 1;
      continue;
    }
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      skipped.large += 1;
      continue;
    }
    candidates.push({ path, file });
  }

  const files: ImportedFile[] = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    if (files.length >= IMPORT_MAX_FILES || totalBytes + candidate.file.size > IMPORT_MAX_TOTAL_BYTES) {
      skipped.cap = candidates.length - files.length;
      break;
    }
    const text = await candidate.file.text();
    if (looksBinary(text)) {
      skipped.binaries += 1;
      continue;
    }
    totalBytes += candidate.file.size;
    files.push({ path: candidate.path, content: text });
  }
  return { files, skipped, rootFolder };
}
