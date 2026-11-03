import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { deltaClass } from "../../lib/format";
import { Sparkline } from "../charts/Sparkline";

export type KpiDelta = { direction: "up" | "down" | "flat"; goodWhenUp: boolean; text: string };

/**
 * Stat tile per the dataviz contract: sentence-case label, proportional
 * figures for the value (no tabular-nums on display numbers), optional
 * signed delta vs a named period, optional 12-point trend sparkline.
 */
export function KpiCard({
  delta,
  icon,
  label,
  spark,
  tone,
  value
}: {
  delta?: KpiDelta;
  icon?: ReactNode;
  label: string;
  spark?: number[];
  tone?: "ok" | "bad";
  value: string;
}) {
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;

  return (
    <div className={`kpi${tone ? ` kpi--${tone}` : ""}`}>
      <div className="kpi-head">
        <span>{label}</span>
        {icon}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">
        {delta ? (
          <span className={`delta ${deltaClass(delta.direction, delta.goodWhenUp)}`}>
            <DeltaIcon size={13} />
            {delta.text}
          </span>
        ) : null}
        {spark && spark.length >= 2 ? <span style={{ marginLeft: "auto", opacity: 0.9 }}><Sparkline values={spark} /></span> : null}
      </div>
    </div>
  );
}
