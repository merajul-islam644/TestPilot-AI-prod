import type { ReactNode } from "react";
import { Ban, Circle, CircleAlert, CircleCheck, CircleDot, CircleMinus, CircleX, LoaderCircle, OctagonAlert, PencilLine, Archive, TriangleAlert } from "lucide-react";
import type { IssueSeverity, IssueStatus, RunStatus, SuiteStatus } from "../../lib/demo/data";

type Tone = "passed" | "failed" | "running" | "pending" | "cancelled" | "critical" | "high" | "medium" | "low" | "neutral" | "accent";

const ICONS: Record<Tone, ReactNode> = {
  passed: <CircleCheck size={13} />,
  failed: <CircleX size={13} />,
  running: <LoaderCircle className="spin" size={13} />,
  pending: <Circle size={13} />,
  cancelled: <Ban size={13} />,
  critical: <OctagonAlert size={13} />,
  high: <TriangleAlert size={13} />,
  medium: <CircleAlert size={13} />,
  low: <CircleMinus size={13} />,
  neutral: <CircleDot size={13} />,
  accent: <CircleDot size={13} />
};

/**
 * Status always reads through text + icon + color together -- never color
 * alone. Severity tones (critical/high) share the red family with failed on
 * purpose: they mean the same "needs someone" thing.
 */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      {ICONS[tone]}
      {children}
    </span>
  );
}

export function RunStatusBadge({ status, label }: { status: RunStatus; label: string }) {
  return <StatusBadge tone={status === "pending" ? "neutral" : status}>{label}</StatusBadge>;
}

export function IssueStatusBadge({ status, label }: { status: IssueStatus; label: string }) {
  const tone = status === "open" ? "neutral" : status === "in_progress" ? "running" : "passed";
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

export function SeverityBadge({ severity, label }: { severity: IssueSeverity; label: string }) {
  return <StatusBadge tone={severity}>{label}</StatusBadge>;
}

export function SuiteStatusBadge({ status, label }: { status: SuiteStatus; label: string }) {
  const tone = status === "active" ? "accent" : status === "draft" ? "neutral" : "cancelled";
  const icon = status === "active" ? <CircleCheck size={13} /> : status === "draft" ? <PencilLine size={13} /> : <Archive size={13} />;
  return <span className={`badge badge-${tone}`}>{icon}{label}</span>;
}
