import { formatNumber } from "../../lib/format";

/**
 * Ranked horizontal bars for nominal categories (identity -> one color for
 * every row). Values sit in their own right-aligned column, so nothing is
 * ever clipped by a too-short bar.
 */
export function BarList({ color = "var(--chart-nominal)", max, rows }: {
  color?: string;
  max?: number;
  rows: { display?: string; label: string; value: number }[];
}) {
  const top = max ?? Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="barlist">
      {rows.map((row) => (
        <div className="barlist-row" key={row.label}>
          <span className="barlist-name" title={row.label}>{row.label}</span>
          <div className="barlist-track">
            <div className="barlist-fill" style={{ background: color, width: `${Math.max(2, (row.value / top) * 100)}%` }} />
          </div>
          <span className="barlist-val">{row.display ?? formatNumber(row.value)}</span>
        </div>
      ))}
    </div>
  );
}
