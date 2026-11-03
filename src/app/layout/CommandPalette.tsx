import { useEffect, useMemo, useRef, useState } from "react";
import { Monitor, Moon, Play, Search, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { ThemePreference } from "../providers/ThemeProvider";
import { useTheme } from "../providers/ThemeProvider";
import { useShell } from "./ShellContext";
import { primaryNavItems, secondaryNavItems } from "./navItems";

type Command = { icon: LucideIcon; id: string; keywords?: string; label: string; run: () => void };

export function CommandPalette({ onClose, onNavigate, open }: { onClose: () => void; onNavigate: (path: string) => void; open: boolean }) {
  const { t } = useT();
  const { setPreference } = useTheme();
  const { openNewRun } = useShell();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const groups = useMemo<{ id: string; items: Command[]; label: string }[]>(() => [
    {
      id: "nav",
      items: [...primaryNavItems, ...secondaryNavItems].map((item) => ({
        icon: item.icon,
        id: item.href,
        keywords: item.href,
        label: t(item.labelKey),
        run: () => onNavigate(item.href)
      })),
      label: t("command.groupNavigate")
    },
    {
      id: "actions",
      items: [
        { icon: Play, id: "new-run", keywords: "run start execute", label: t("command.startRun"), run: () => openNewRun() }
      ],
      label: t("command.groupActions")
    },
    {
      id: "theme",
      items: ([
        { icon: Monitor, id: "system", label: t("settings.appearance.system") },
        { icon: Sun, id: "light", label: t("settings.appearance.light") },
        { icon: Moon, id: "dark", label: t("settings.appearance.dark") }
      ] as { icon: LucideIcon; id: ThemePreference; label: string }[]).map((item) => ({
        ...item,
        keywords: "theme appearance",
        run: () => setPreference(item.id)
      })),
      label: t("command.groupTheme")
    }
  ], [onNavigate, openNewRun, setPreference, t]);

  const normalized = query.trim().toLowerCase();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        normalized === "" || item.label.toLowerCase().includes(normalized) || (item.keywords ?? "").toLowerCase().includes(normalized)
      )
    }))
    .filter((group) => group.items.length > 0);
  const flat = visibleGroups.flatMap((group) => group.items);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, query]);

  if (!open) return null;

  function runItem(item: Command | undefined) {
    if (!item) return;
    item.run();
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((value) => Math.min(value + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runItem(flat[selected]);
    } else if (event.key === "Escape") {
      onClose();
    }
  }

  let flatIndex = -1;

  return (
    <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
      <div aria-modal="true" className="palette" onKeyDown={onKeyDown} role="dialog">
        <div className="palette-input">
          <Search size={17} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("command.placeholder")}
            ref={inputRef}
            value={query}
          />
        </div>
        {flat.length === 0 ? (
          <p className="palette-empty">{t("command.empty")}</p>
        ) : (
          <ul className="palette-list" ref={listRef}>
            {visibleGroups.map((group) => (
              <li key={group.id}>
                <div className="sidebar-nav-label" style={{ padding: "8px 10px 2px" }}>{group.label}</div>
                <ul style={{ display: "grid", gap: 2, listStyle: "none", margin: 0, padding: 0 }}>
                  {group.items.map((item) => {
                    flatIndex++;
                    const index = flatIndex;
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <button
                          className={`palette-item${index === selected ? " selected" : ""}`}
                          data-selected={index === selected}
                          onClick={() => runItem(item)}
                          onMouseEnter={() => setSelected(index)}
                          type="button"
                        >
                          <Icon size={16} />
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <div className="palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t("command.hintNavigate")}</span>
          <span><kbd>Enter</kbd> {t("command.hintSelect")}</span>
          <span><kbd>esc</kbd> {t("command.hintClose")}</span>
        </div>
      </div>
    </div>
  );
}
