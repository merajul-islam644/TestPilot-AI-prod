import type { ReactNode } from "react";

export function EmptyState({ action, description, icon, title }: { action?: ReactNode; description: string; icon?: ReactNode; title: string }) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
