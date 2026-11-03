// Stat-tile trend: 12-point sparkline in the de-emphasis hue with the
// current period picked out in the accent (per the stat-tile contract).
// Deliberately tiny: no axes, no tooltip -- the tile's value is the data.
export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const stepX = (width - pad * 2) / (values.length - 1);
  const points = values.map((value, index) => ({
    x: pad + index * stepX,
    y: pad + (1 - (value - min) / span) * (height - pad * 2)
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const last = points[points.length - 1]!;
  const previous = points[points.length - 2]!;

  return (
    <svg aria-hidden="true" height={height} width={width}>
      <polyline fill="none" points={line} stroke="var(--chart-context)" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      <polyline fill="none" points={`${previous.x},${previous.y} ${last.x},${last.y}`} stroke="var(--chart-nominal)" strokeLinecap="round" strokeWidth={2} />
      <circle cx={last.x} cy={last.y} fill="var(--chart-nominal)" r={3} stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}
