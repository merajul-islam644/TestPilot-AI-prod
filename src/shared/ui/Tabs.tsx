import type { ReactNode } from "react";

export type TabItem<T extends string> = { id: T; label: string };

export function Tabs<T extends string>({ active, onChange, tabs, actions }: { active: T; onChange: (id: T) => void; tabs: TabItem<T>[]; actions?: ReactNode }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={tab.id === active}
          className={tab.id === active ? "on" : ""}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
      {/* Right-side slot on the tab row (e.g. a page's primary action at
          tab level instead of floating in the page header). */}
      {actions ? <span className="tabs-actions">{actions}</span> : null}
    </div>
  );
}
