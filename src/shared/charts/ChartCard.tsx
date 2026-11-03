import { useState } from "react";
import type { ReactNode } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import { useT } from "../../lib/i18n/LocalizationProvider";

/**
 * Chart container with the table-view twin: every chart ships an
 * alternative flat rendering of the same rows (the WCAG-clean path), plus
 * slots for page-level controls, the legend, and a footer line.
 */
export function ChartCard({
  children,
  controls,
  description,
  footer,
  legend,
  table,
  title
}: {
  children: ReactNode;
  controls?: ReactNode;
  description?: string;
  footer?: ReactNode;
  legend?: ReactNode;
  table?: { head: string[]; rows: ReactNode[][] };
  title: string;
}) {
  const { t } = useT();
  const [showTable, setShowTable] = useState(false);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{title}</h3>
          {description ? <p className="panel-desc">{description}</p> : null}
        </div>
        <div className="toolbar-actions">
          {controls}
          {table ? (
            <button
              aria-label={showTable ? t("common.showChart") : t("common.showTable")}
              aria-pressed={showTable}
              className="icon-button"
              onClick={() => setShowTable((value) => !value)}
              title={showTable ? t("common.showChart") : t("common.showTable")}
            >
              {showTable ? <ChartColumn size={16} /> : <Table2 size={16} />}
            </button>
          ) : null}
        </div>
      </div>
      {legend && !showTable ? <div className="chart-legend" style={{ marginBottom: 10 }}>{legend}</div> : null}
      {showTable && table ? (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>{table.head.map((cell) => <th key={cell}>{cell}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>{row.map((cell, cellIndex) => <td className="num-cell" key={cellIndex}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
      {footer ? <div className="panel-foot">{footer}</div> : null}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span className="lg-key" key={item.label}>
          {item.line ? <span className="lg-line" style={{ background: item.color }} /> : <span className="lg-swatch" style={{ background: item.color }} />}
          {item.label}
        </span>
      ))}
    </div>
  );
}
