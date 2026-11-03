import { useState } from "react";
import { ChartTooltip } from "./ChartTooltip";
import { clamp, niceScale, roundedTopRect, useMeasure } from "./chartUtils";

export type ColumnPoint = { label: string; value: number };

const MARGIN = { top: 10, right: 10, bottom: 26, left: 40 };
const MAX_BAR = 24;

/**
 * Single-series columns. Nominal magnitude -> one color for every bar
 * (default: the accent). Bars cap at 24px, 4px rounded data-end, square at
 * the baseline, hairline solid gridlines, per-column hover/focus tooltip.
 */
export function ColumnChart({
  ariaLabel,
  color = "var(--chart-nominal)",
  data,
  height = 220,
  seriesLabel,
  valueFormat
}: {
  ariaLabel: string;
  color?: string;
  data: ColumnPoint[];
  height?: number;
  seriesLabel: string;
  valueFormat?: (value: number) => string;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<number | undefined>(undefined);
  const fmt = valueFormat ?? ((value: number) => Math.round(value).toLocaleString("en-US"));

  if (data.length === 0) return null;

  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  if (plotWidth <= 10) return <div ref={ref} />;

  const { ticks, max } = niceScale(Math.max(...data.map((point) => point.value)), 4);
  const band = plotWidth / data.length;
  const barWidth = Math.min(MAX_BAR, Math.max(2, band - 6));
  const xOf = (index: number) => MARGIN.left + index * band + (band - barWidth) / 2;
  const yOf = (value: number) => MARGIN.top + (1 - value / max) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  const activePoint = active !== undefined ? data[active] : undefined;

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
        {data.map((point, index) => (
          <text key={`${point.label}-${index}`} style={{ fill: "hsl(var(--muted-foreground))", font: "500 11px Inter, sans-serif", textAnchor: "middle" }} x={MARGIN.left + index * band + band / 2} y={height - 8}>
            {index % labelEvery === 0 || index === data.length - 1 ? point.label : ""}
          </text>
        ))}
        {data.map((point, index) => {
          const barHeight = Math.max(point.value > 0 ? 2 : 0, (point.value / max) * plotHeight);
          return (
            <g key={index}>
              {active === index ? (
                <rect fill="hsl(var(--foreground) / 0.05)" height={plotHeight} width={band} x={MARGIN.left + index * band} y={MARGIN.top} />
              ) : null}
              {point.value > 0 ? <path d={roundedTopRect(xOf(index), yOf(point.value), barWidth, barHeight, 4)} fill={color} /> : null}
            </g>
          );
        })}
        {data.map((point, index) => (
          <rect
            aria-label={`${point.label}: ${fmt(point.value)} ${seriesLabel}`}
            fill="transparent"
            height={plotHeight}
            key={index}
            onBlur={() => setActive(undefined)}
            onFocus={() => setActive(index)}
            onMouseLeave={() => setActive(undefined)}
            onMouseMove={() => setActive(index)}
            tabIndex={0}
            width={band}
            x={MARGIN.left + index * band}
            y={MARGIN.top}
          />
        ))}
      </svg>
      {activePoint ? (
        <ChartTooltip
          rows={[{ color, label: seriesLabel, value: fmt(activePoint.value) }]}
          title={activePoint.label}
          x={clamp(MARGIN.left + active! * band + band / 2, 80, width - 80)}
          y={MARGIN.top + 2}
        />
      ) : null}
    </div>
  );
}
