export function StatusPill({ tone, children }: { tone: "good" | "warn" | "neutral"; children: string }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
