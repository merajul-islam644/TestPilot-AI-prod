// Search sidebar view: server-side content search (the workspace no
// longer holds bulk file text — lazy loading), grouped by file like
// VS Code's results tree. Debounced as you type; the runner scans the
// guarded tree and returns matching lines with numbers. Clicking a
// match opens that file in an editor tab.

import { useEffect, useMemo, useRef, useState } from "react";
import { fileIconElement } from "../icons/fileIcon";

const MAX_FILES_SHOWN = 20;
const MAX_LINES_PER_FILE = 5;
const MAX_TOTAL_MATCHES = 60;
const DEBOUNCE_MS = 250;

export function SearchView({ root, onSearch, onOpenFile }: {
  /** Workspace root, or null when no folder is open. */
  root: string | null;
  /** Runs the search server-side; resolves with raw matching lines. */
  onSearch: (query: string) => Promise<{ results: { path: string; lines: { number: number; text: string }[] }[]; truncated: boolean }>;
  onOpenFile: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<{ path: string; lines: { number: number; before: string; hit: string; after: string }[]; total: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const trimmed = query.trim();
  const searchIdRef = useRef(0);

  useEffect(() => {
    if (!root || trimmed.length < 2) {
      searchIdRef.current += 1;
      setGroups([]);
      setSearching(false);
      setTruncated(false);
      setHasSearched(false);
      return;
    }
    const id = searchIdRef.current + 1;
    searchIdRef.current = id;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await onSearch(trimmed);
        if (searchIdRef.current !== id) return; // a newer query superseded this one
        const lower = trimmed.toLowerCase();
        const mapped = response.results.slice(0, MAX_FILES_SHOWN).map((group) => {
          const lines = group.lines.slice(0, MAX_LINES_PER_FILE).map((line) => {
            const at = line.text.toLowerCase().indexOf(lower);
            if (at === -1) return { number: line.number, before: line.text, hit: "", after: "" };
            return {
              number: line.number,
              before: line.text.slice(0, at),
              hit: line.text.slice(at, at + trimmed.length),
              after: line.text.slice(at + trimmed.length)
            };
          });
          return { path: group.path, lines, total: group.lines.length };
        });
        setGroups(mapped);
        setTruncated(response.truncated);
        setHasSearched(true);
      } catch {
        if (searchIdRef.current === id) setGroups([]);
      } finally {
        if (searchIdRef.current === id) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [root, trimmed, onSearch]);

  const total = useMemo(() => groups.reduce((sum, group) => sum + group.total, 0), [groups]);

  return (
    <div className="wb-view">
      <div className="wb-view-head">
        <span className="wb-view-title">Search</span>
      </div>
      <div className="wb-search-body">
        <input
          className="wb-search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={root ? "Search in workspace" : "Open a folder to search"}
          spellCheck={false}
          value={query}
        />
        {!root ? (
          <p className="wb-search-hint muted">Open a workspace folder first — search scans the real files on disk.</p>
        ) : trimmed.length < 2 ? (
          <p className="wb-search-hint muted">Type at least two characters to search file contents.</p>
        ) : searching ? (
          <p className="wb-search-hint muted">Searching…</p>
        ) : groups.length === 0 ? (
          <p className="wb-search-hint muted">{hasSearched ? "No matching lines." : "Searching…"}</p>
        ) : (
          <div className="wb-search-results">
            <p className="wb-search-summary muted">
              {total} result{total === 1 ? "" : "s"} in {groups.length} file{groups.length === 1 ? "" : "s"}
              {truncated ? " · results capped" : ""}
            </p>
            {groups.map((group) => (
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
                      {line.hit ? <mark>{line.hit}</mark> : null}
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
