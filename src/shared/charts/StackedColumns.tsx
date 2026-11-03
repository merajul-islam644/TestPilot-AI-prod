import { useState } from "react";
import { ChartTooltip } from "./ChartTooltip";
import { clamp, niceScale, roundedTopRect, useMeasure } from "./chartUtils";

export type StackPoint = { label: string; base: number; top: number };

const MARGIN = { top: 10, right: 10, bottom: 26, left: 40 };
const MAX_BAR = 24;
const GAP = 2; // surface gap between stack segments

/**
 * Two-segment column chart in emphasis form: `top` (failed) is the loud
 * series in red sitting on top; `base` (passed) is recessive context gray.
 * Bars cap at 24px, 4px rounded data-end, square at the baseline, 2px
 * surface gap between segments. Crosshair + tooltip; each column is
 * focusable and reads its values to screen readers.
 */
export function StackedColumns({
  ariaLabel,
  baseLabel,
  data,
  height = 220,
  topLabel,
  valueFormat
}: {
  ariaLabel: string;
  baseLabel: string;
  data: StackPoint[];
  height?: number;
  topLabel: string;
  valueFormat?: (value: number) => string;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<number | undefined>(undefined);
  const fmt = valueFormat ?? ((value: number) => Math.round(value).toLocaleString("en-US"));

  if (data.length === 0) return null;

  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  if (plotWidth <= 10) return <div ref={ref} />;

  const { ticks, max } = niceScale(Math.max(...data.map((point) => point.base + point.top)), 4);
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
          const x = xOf(index);
          const baseHeight = Math.max(0, (point.base / max) * plotHeight - (point.top > 0 ? GAP : 0));
          const baseY = MARGIN.top + plotHeight - baseHeight;
          const topHeight = Math.max(point.top > 0 ? 2 : 0, (point.top / max) * plotHeight);
          const topY = baseY - GAP - topHeight;
          return (
            <g key={index}>
              {active === index ? (
                <rect fill="hsl(var(--foreground) / 0.05)" height={plotHeight} width={band} x={MARGIN.left + index * band} y={MARGIN.top} />
              ) : null}
              {point.base > 0 ? (
                baseHeight > 0 ? (
                  <path
                    d={point.top > 0
                      ? `M${x},${baseY + baseHeight} V${baseY} H${x + barWidth} V${baseY + baseHeight} Z`
                      : roundedTopRect(x, baseY, barWidth, baseHeight, 4)}
                    fill="var(--chart-context)"
                  />
                ) : null
              ) : null}
              {point.top > 0 ? <path d={roundedTopRect(x, topY, barWidth, topHeight, 4)} fill="var(--chart-failed)" /> : null}
            </g>
          );
        })}
        {active !== undefined ? (
          <line
            stroke="var(--chart-axis)"
            style={{ strokeWidth: 1 }}
            x1={MARGIN.left + active * band + band / 2}
            x2={MARGIN.left + active * band + band / 2}
            y1={MARGIN.top}
            y2={MARGIN.top + plotHeight}
          />
        ) : null}
        {data.map((point, index) => (
          <rect
            aria-label={`${point.label}: ${fmt(point.base)} ${baseLabel}, ${fmt(point.top)} ${topLabel}`}
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
          rows={[
            { color: "var(--chart-failed)", label: topLabel, value: fmt(activePoint.top) },
            { color: "var(--chart-context)", label: baseLabel, value: fmt(activePoint.base) }
          ]}
          title={activePoint.label}
          x={clamp(MARGIN.left + active! * band + band / 2, 80, width - 80)}
          y={MARGIN.top + 2}
        />
      ) : null}
    </div>
  );
}
