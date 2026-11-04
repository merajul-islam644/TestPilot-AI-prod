// Pure helpers over the flat workspace file list -- tree building,
// language detection and path shapes. No React, no store access, so
// the explorer, tabs and search views all speak the same vocabulary.

export type TreeNode = { name: string; path: string; children?: TreeNode[] };

/** Nest flat workspace paths into folder/file nodes (folders sort first). */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const path of [...paths].sort()) {
    const segments = path.split("/");
    let node = root;
    segments.forEach((segment, index) => {
      const leaf = index === segments.length - 1;
      const nodePath = segments.slice(0, index + 1).join("/");
      node.children ??= [];
      let next = node.children.find((child) => child.name === segment && (child.children !== undefined) === !leaf);
      if (!next) {
        next = leaf ? { name: segment, path: nodePath } : { name: segment, path: nodePath, children: [] };
        node.children.push(next);
      }
      node = next;
    });
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.children !== undefined) !== (b.children !== undefined)
      ? a.children !== undefined ? -1 : 1
      : a.name.localeCompare(b.name));
    for (const node of nodes) if (node.children) sortNodes(node.children);
  };
  sortNodes(root.children!);
  return root.children!;
}

/** Monaco language id for a workspace path (plaintext when unknown). */
export function languageOf(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript", json: "json", md: "markdown",
    css: "css", scss: "scss", html: "html", htm: "html", py: "python",
    rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", cs: "csharp",
    php: "php", sh: "shell", bash: "shell", yml: "yaml", yaml: "yaml",
    sql: "sql", xml: "xml", svg: "xml"
  };
  return map[ext] ?? "plaintext";
}

export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Path segments for the editor breadcrumbs (file name last). */
export function breadcrumbsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** The folder paths that should start expanded for a fresh workspace:
 * the root and its first level, so an imported repo opens readable. */
export function defaultExpanded(paths: string[]): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    for (let depth = 1; depth < Math.min(segments.length, 3); depth++) {
      folders.add(segments.slice(0, depth).join("/"));
    }
  }
  return [...folders];
}
