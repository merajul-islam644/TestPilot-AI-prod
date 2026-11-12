import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: ReactNode; onClick?: () => void };

/** The hierarchy trail — e.g. Issues › Blocks Data › ISS-104. Every level
 *  but the last is a clickable link back up the chain, so a user can walk
 *  out one level per click; the last crumb is where they are and stays
 *  plain text. `style` merges over the defaults — pass { marginBottom: 0 }
 *  when the trail shares a row with other controls. */
export function Breadcrumb({ items, style }: { items: Crumb[]; style?: CSSProperties }) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{ alignItems: "center", display: "flex", flexWrap: "wrap", fontSize: 13, gap: 6, marginBottom: 8, ...style }}
    >
      {items.map((item, index) => (
        <span key={index} style={{ alignItems: "center", display: "inline-flex", gap: 6 }}>
          {index > 0 ? <ChevronRight aria-hidden size={13} style={{ color: "hsl(var(--muted-foreground))" }} /> : null}
          {item.onClick ? (
            <button className="link-button" onClick={item.onClick} type="button">{item.label}</button>
          ) : (
            <span style={{ fontWeight: 600 }}>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
