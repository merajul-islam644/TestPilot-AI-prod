// Search sidebar view: case-insensitive content search across every
// in-memory workspace file, grouped by file like VS Code's results
// tree. Clicking a match opens that file in an editor tab.

import { useMemo, useState } from "react";
import { fileIconElement } from "../icons/fileIcon";
import type { WorkspaceFile } from "../../../lib/demo/store";

const MAX_FILES_SHOWN = 20;
const MAX_LINES_PER_FILE = 5;
const MAX_TOTAL_MATCHES = 60;

type FileMatches = { path: string; lines: { number: number; before: string; hit: string; after: string }[]; total: number };

function searchFiles(files: WorkspaceFile[], query: string): { groups: FileMatches[]; total: number } {
  const lower = query.toLowerCase();
  const groups: FileMatches[] = [];
  let total = 0;
  for (const file of files) {
    if (total >= MAX_TOTAL_MATCHES || groups.length >= MAX_FILES_SHOWN) break;
    const lines = [];
    let fileTotal = 0;
    const content = file.content.split("\n");
    for (let index = 0; index < content.length; index++) {
      const lineLower = (content[index] ?? "").toLowerCase();
      const at = lineLower.indexOf(lower);
      if (at === -1) continue;
      fileTotal += 1;
      if (lines.length < MAX_LINES_PER_FILE && total < MAX_TOTAL_MATCHES) {
        const line = content[index] ?? "";
        lines.push({ number: index + 1, before: line.slice(0, at), hit: line.slice(at, at + lower.length), after: line.slice(at + lower.length) });
        total += 1;
      }
    }
    if (fileTotal > 0) groups.push({ path: file.path, lines, total: fileTotal });
  }
  return { groups, total };
}

export function SearchView({ files, onOpenFile }: {
  files: WorkspaceFile[];
  onOpenFile: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const result = useMemo(
    () => (trimmed.length < 2 ? { groups: [], total: 0 } : searchFiles(files, trimmed)),
    [files, trimmed]
  );

  return (
    <div className="wb-view">
      <div className="wb-view-head">
        <span className="wb-view-title">Search</span>
      </div>
      <div className="wb-search-body">
        <input
          className="wb-search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search in workspace"
          spellCheck={false}
          value={query}
        />
        {trimmed.length < 2 ? (
          <p className="wb-search-hint muted">Type at least two characters to search file contents.</p>
        ) : result.groups.length === 0 ? (
          <p className="wb-search-hint muted">No matching lines.</p>
        ) : (
          <div className="wb-search-results">
            <p className="wb-search-summary muted">{result.total} result{result.total === 1 ? "" : "s"} in {result.groups.length} file{result.groups.length === 1 ? "" : "s"}</p>
            {result.groups.map((group) => (
              <div className="wb-search-file" key={group.path}>
                <div className="wb-search-file-head">
                  <span className="wb-tree-icon">{fileIconElement(group.path)}</span>
                  <span className="wb-search-file-path" title={group.path}>{group.path}</span>
                  <span className="wb-search-count">{group.total}</span>
                </div>
                {group.lines.map((line) => (
                  <button className="wb-search-line" key={line.number} onClick={() => onOpenFile(group.path)} type="button">
                    <span className="wb-search-line-no">{line.number}</span>
                    <span className="wb-search-line-text">
                      {line.before}
                      <mark>{line.hit}</mark>
                      {line.after}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
