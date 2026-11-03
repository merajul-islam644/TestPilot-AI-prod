import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Track an element's rendered width so SVG charts can draw at true pixel size. */
export function useMeasure<T extends HTMLElement>(): { ref: RefObject<T>; width: number } {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return { ref: ref as RefObject<T>, width };
}

/** Rounded tick step for a magnitude axis (1/2/2.5/5 × 10^n). */
export function niceScale(maxValue: number, targetTicks = 4): { ticks: number[]; max: number } {
  if (maxValue <= 0) return { ticks: [0, 1], max: 1 };
  const rawStep = maxValue / targetTicks;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((candidate) => candidate * power).find((candidate) => candidate >= rawStep) ?? 10 * power;
  const top = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 1000; value += step) ticks.push(Math.round(value * 100) / 100);
  return { ticks, max: top };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Top-only rounded rect path (4px rounded data-end, square at the baseline). */
export function roundedTopRect(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, height, width / 2);
  if (r <= 0) return `M${x},${y} h${width} v${height} h${-width} Z`;
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    "Z"
  ].join(" ");
}
