// The Source Control branch switcher — VS Code's picker, searchable.
// With dozens of remote branches (origin/…) the plain dropdown became
// a scroll hunt, so the trigger opens a small fixed-position popover:
// a search box filtering locals first, then the remotes (picking one
// lets git's DWIM checkout create the local tracking branch).
// Keyboard-first: type to filter, arrows move, Enter switches, Escape
// closes; clicking a row works too. Fixed positioning escapes the
// SCM body's overflow-y clip, like a real menu.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

type Anchor = { left: number; width: number; top?: number; bottom?: number };

export function BranchPicker({ branches, disabled, value, onChange }: {
  /** All branch names — locals first, then origin/* (git's --all order). */
  branches: string[];
  disabled: boolean;
  /** The checked-out (local) branch. */
  value: string;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Locals first (git's --all order), current branch always present.
  const names = useMemo(() => {
    const set = new Set(branches);
    if (value) set.add(value);
    return [...set];
  }, [branches, value]);

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === "" ? names : names.filter((name) => name.toLowerCase().includes(needle));
  }, [names, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setIndex(0);
  }, []);

  // Measure the trigger once on open; flip above it when the viewport
  // floor is too close for a comfortable list.
  function toggle() {
    if (open) {
      close();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const flip = rect.bottom + 320 > window.innerHeight && rect.top > 340;
      setAnchor(flip
        ? { left: rect.left, width: Math.max(rect.width, 260), bottom: window.innerHeight - rect.top + 4 }
        : { left: rect.left, width: Math.max(rect.width, 260), top: rect.bottom + 4 });
    }
    setQuery("");
    setIndex(0);
    setOpen(true);
  }

  // Outside click closes. The mousedown keeps a click inside the pop
  // (e.g. the scrollbar) from closing before the click lands.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!popRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close();
    }
    // Scrolling OUTSIDE the popover misaligns a fixed popup from its
    // trigger, so it closes — but scrolling the branch list itself (its
    // own overflow) must keep it open, so the pop's own scroll events
    // are ignored here.
    const onLayout = () => close();
    const onScroll = (event: Event) => {
      if (!popRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [index, open]);

  function pick(name: string) {
    close();
    if (name !== value) onChange(name);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((v) => Math.min(v + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((v) => Math.max(v - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[index];
      if (hit) pick(hit);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  return (
    <div className="wb-branch-picker">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="wb-scm-input wb-branch-trigger"
        disabled={disabled}
        onClick={toggle}
        ref={triggerRef}
        title="Switch branch"
        type="button"
      >
        <span className="wb-branch-value">{value}</span>
        <ChevronDown className="wb-branch-chevron" size={12} />
      </button>
      {open && anchor ? (
        <div
          aria-label="Branches"
          className="wb-branch-pop"
          ref={popRef}
          role="listbox"
          style={anchor.top !== undefined
            ? { left: anchor.left, top: anchor.top, width: anchor.width }
            : { bottom: anchor.bottom, left: anchor.left, width: anchor.width }}
        >
          <input
            aria-label="Search branches"
            autoFocus
            className="wb-scm-input"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search branches…"
            spellCheck={false}
            value={query}
          />
          <div className="wb-branch-list" ref={listRef}>
            {hits.length === 0 ? (
              <p className="wb-branch-empty">No matching branch.</p>
            ) : hits.map((name, itemIndex) => (
              <button
                className={`wb-branch-item${itemIndex === index ? " active" : ""}`}
                data-active={itemIndex === index}
                key={name}
                onClick={() => pick(name)}
                type="button"
              >
                <span className="wb-branch-name">{name}</span>
                {name === value ? <Check size={12} /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
