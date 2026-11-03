import type { CSSProperties } from "react";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={["skeleton", className].filter(Boolean).join(" ")} style={style} />;
}
