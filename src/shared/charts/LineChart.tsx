import { useState } from "react";
import { ChartTooltip } from "./ChartTooltip";
import { clamp, niceScale, useMeasure } from "./chartUtils";

export type LinePoint = { label: string; value: number };

const MARGIN = { top: 10, right: 14, bottom: 26, left: 44 };

/**
 * Single-series line: 2px round-capped stroke, ~10% area wash, hairline
 * solid gridlines, crosshair + tooltip, focusable per-point hit bands (the
 * keyboard route shows the same tooltip as hover). One series, so no legend
 * box -- the card title names it.
 */
export function LineChart({
  ariaLabel,
  formatValue,
  height = 200,
  points,
  seriesLabel,
  unit = "%"
}: {
  ariaLabel: string;
  formatValue?: (value: number) => string;
  height?: number;
  points: LinePoint[];
  seriesLabel: string;
  unit?: string;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<number | undefined>(undefined);
  const fmt = formatValue ?? ((value: number) => `${Math.round(value)}${unit}`);

  if (points.length === 0) return null;

  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  if (plotWidth <= 10) return <div ref={ref} />;

  const { ticks, max } = niceScale(Math.max(...points.map((point) => point.value)), 4);
  const stepX = plotWidth / Math.max(1, points.length - 1);
  const xOf = (index: number) => MARGIN.left + index * stepX;
  const yOf = (value: number) => MARGIN.top + (1 - value / max) * plotHeight;
  const coords = points.map((point, index) => ({ ...point, x: xOf(index), y: yOf(point.value) }));
  const firstPoint = coords[0]!;
  const lastPoint = coords[coords.length - 1]!;
  const linePath = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const areaPath = `${linePath} L${lastPoint.x},${MARGIN.top + plotHeight} L${firstPoint.x},${MARGIN.top + plotHeight} Z`;
  const activeCoord = active !== undefined ? coords[active] : undefined;

  // Sparse x labels: at most ~6, from the ends inward.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="chart-box" ref={ref}>
      <svg aria-label={ariaLabel} height={height} role="img" width={width}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
              style={{ strokeWidth: 1 }}
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={yOf(tick)}
              y2={yOf(tick)}
            />
            <text style={{ fill: "hsl(var(--muted-foreground))", font: "500 11px Inter, sans-serif" }} x={MARGIN.left - 8} y={yOf(tick) + 4}>
              {fmt(tick)}
            </text>
          </g>
        ))}
        {coords.map((point, index) => (
          <text key={`${point.label}-${index}`} style={{ fill: "hsl(var(--muted-foreground))", font: "500 11px Inter, sans-serif", textAnchor: "middle" }} x={point.x} y={height - 8}>
            {index % labelEvery === 0 || index === points.length - 1 ? point.label : ""}
          </text>
        ))}
        <path d={areaPath} fill="var(--chart-line-ok)" opacity={0.08} />
        <path d={linePath} fill="none" stroke="var(--chart-line-ok)" strokeLinecap="round" strokeLinejoin="round" style={{ strokeWidth: 2 }} />
        {activeCoord ? (
          <line stroke="var(--chart-axis)" style={{ strokeWidth: 1 }} x1={activeCoord.x} x2={activeCoord.x} y1={MARGIN.top} y2={MARGIN.top + plotHeight} />
        ) : null}
        {activeCoord ? (
          <circle cx={activeCoord.x} cy={activeCoord.y} fill="var(--chart-line-ok)" r={4.5} stroke="var(--card)" style={{ strokeWidth: 2 }} />
        ) : null}
        <circle cx={lastPoint.x} cy={lastPoint.y} fill="var(--chart-line-ok)" r={4.5} stroke="var(--card)" style={{ strokeWidth: 2 }} />
        {/* Hit bands: full-height, one per point -- bigger than the 2px mark */}
        {coords.map((point, index) => (
          <rect
            aria-label={`${point.label}: ${fmt(point.value)}`}
            fill="transparent"
            key={index}
            onBlur={() => setActive(undefined)}
            onFocus={() => setActive(index)}
            onMouseLeave={() => setActive(undefined)}
            onMouseMove={() => setActive(index)}
            tabIndex={0}
            x={xOf(index) - stepX / 2}
            y={MARGIN.top}
            height={plotHeight}
            width={stepX}
          />
        ))}
      </svg>
      {activeCoord ? (
        <ChartTooltip
          rows={[{ color: "var(--chart-line-ok)", label: seriesLabel, value: fmt(activeCoord.value) }]}
          title={activeCoord.label}
          x={clamp(activeCoord.x, 90, width - 90)}
          y={MARGIN.top + 4}
        />
      ) : null}
    </div>
  );
}
