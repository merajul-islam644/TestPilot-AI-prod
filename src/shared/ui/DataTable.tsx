import type { ReactNode } from "react";

export type Column<T> = { align?: "start" | "end"; header: ReactNode; key: string; render: (row: T) => ReactNode };

/**
 * The one table used everywhere. Rows key off itemId/id; optional row click
 * for drill-downs, and a loading shape that mimics real rows instead of a
 * spinner. `tailLoadingRows` renders skeleton rows after the real ones —
 * used by in-flight runs to show completed cases streaming in.
 */
export function DataTable<T>({ columns, loading = false, loadingRows = 6, onRowClick, rows, tailLoadingRows = 0 }: {
  columns: Column<T>[];
  loading?: boolean;
  loadingRows?: number;
  onRowClick?: (row: T) => void;
  rows: T[];
  tailLoadingRows?: number;
}) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={column.align === "end" ? "num-cell" : undefined} key={column.key} scope="col">{column.header}</th>
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
                    <td className={column.align === "end" ? "num-cell" : undefined} key={column.key}>{column.render(row)}</td>
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
