import type { ReactNode } from "react";

export type Column<T> = { align?: "start" | "end"; /** Extra class for both header and body cells (spacing tweaks per column). */ className?: string; header: ReactNode; key: string; render: (row: T) => ReactNode; /** Width hint applied to the header cell — under `fixed` layout it lands exactly, under auto layout the browser may still let content expand. */ width?: number | string };

/**
 * The one table used everywhere. Rows key off itemId/id; optional row click
 * for drill-downs, and a loading shape that mimics real rows instead of a
 * spinner. `tailLoadingRows` renders skeleton rows after the real ones —
 * used by in-flight runs to show completed cases streaming in.
 *
 * `fixed` switches the table to `table-layout: fixed`, so every column's
 * width hint lands exactly and inter-column gaps stay even — auto layout
 * re-measures per row and quietly lets voids drift between columns. Only
 * safe when EVERY column carries a width hint (the run-stats set does;
 * text tables like Users/Issues rely on auto sizing and must not pass it).
 */
export function DataTable<T>({ columns, fixed = false, loading = false, loadingRows = 6, onRowClick, rows, tailLoadingRows = 0 }: {
  columns: Column<T>[];
  fixed?: boolean;
  loading?: boolean;
  loadingRows?: number;
  onRowClick?: (row: T) => void;
  rows: T[];
  tailLoadingRows?: number;
}) {
  return (
    <div className="table-shell">
      <table className={fixed ? "table-fixed" : undefined}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={[column.align === "end" ? "num-cell" : "", column.className ?? ""].join(" ").trim() || undefined} key={column.key} scope="col" style={column.width !== undefined ? { width: column.width } : undefined}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: loadingRows }, (_, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <span className="skeleton skeleton-line" style={{ width: "70%" }} />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, index) => (
                <tr
                  className={onRowClick ? "row-link" : undefined}
                  key={String((row as Record<string, unknown>).itemId ?? (row as Record<string, unknown>).id ?? index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td className={[column.align === "end" ? "num-cell" : "", column.className ?? ""].join(" ").trim() || undefined} key={column.key}>{column.render(row)}</td>
                  ))}
                </tr>
              )).concat(Array.from({ length: tailLoadingRows }, (_, index) => (
                <tr key={`tail-${index}`}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <span className="skeleton skeleton-line" style={{ width: "70%" }} />
                    </td>
                  ))}
                </tr>
              )))}
        </tbody>
      </table>
    </div>
  );
}
