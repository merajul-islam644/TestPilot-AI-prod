export type TooltipRow = { color?: string; label: string; value: string };

/** The single tooltip style every chart uses: dark surface, swatch + value rows. */
export function ChartTooltip({ rows, title, x, y }: { rows: TooltipRow[]; title: string; x: number; y: number }) {
  return (
    <div className="chart-tooltip" role="status" style={{ left: x, top: y, transform: "translateX(-50%)" }}>
      <div className="tt-title">{title}</div>
      {rows.map((row) => (
        <div className="tt-row" key={row.label}>
          {row.color ? <span className="tt-key" style={{ background: row.color }} /> : null}
          <span>{row.label}</span>
          <span className="tt-val">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
